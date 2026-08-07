import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db, portalUsersTable, type PortalUser } from "@workspace/db";

/**
 * Task #505: shared portal_users upsert keyed by lower(email) so the
 * CSV-grant ghost row + first-Clerk-signin row cannot diverge into two
 * separate portal_users records. Mirrors the behaviour the
 * `middlewares/requireAuth.ts` shell-claim path already implements,
 * exposed as a helper so every other Clerk-auth-resolving route uses
 * one consistent flow.
 *
 * Resolution order:
 *   1. SELECT by clerk_id - return as-is (caller can still update fields).
 *   2. SELECT by lower(email) - attach clerk_id to that row, return it.
 *   3. INSERT a fresh row.
 *
 * After 0049_t505_portal_users_email_unique landed, the lower(email)
 * unique index makes step 3 fail fast if a duplicate slipped past steps
 * 1 and 2 - that's the desired loud-failure mode.
 */
export async function ensurePortalUserForClerk(opts: {
  clerkId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  portalKey: string;
  isAdmin?: boolean;
}): Promise<PortalUser> {
  const { clerkId, email, firstName, lastName, portalKey, isAdmin } = opts;
  const normalisedEmail = email.trim();

  const [byClerk] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.clerkId, clerkId));
  if (byClerk) return byClerk;

  const [byEmail] = await db
    .select()
    .from(portalUsersTable)
    .where(sql`lower(${portalUsersTable.email}) = lower(${normalisedEmail})`)
    .limit(1);
  if (byEmail) {
    // Task #745: claiming a pre-existing row by email means a buyer
    // who already has a portal_users record (created by a paid-path
    // webhook, admin grant, or operator resend) is now signing into
    // Clerk for the first time. If the upstream row landed with
    // is_active=false (schema default, or the pre-Task-#745 GHL
    // webhook insert), requireActive in routes/portal.ts would 403
    // every subsequent /api/portal/* request even though Clerk auth
    // succeeded. Force isActive=true on claim - the matching Clerk
    // identity proves they are a real buyer at this point.
    const [claimed] = await db
      .update(portalUsersTable)
      .set({
        clerkId,
        firstName: byEmail.firstName ?? firstName ?? null,
        lastName: byEmail.lastName ?? lastName ?? null,
        lastLoginAt: new Date(),
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(portalUsersTable.id, byEmail.id))
      .returning();
    return claimed ?? byEmail;
  }

  const [inserted] = await db
    .insert(portalUsersTable)
    .values({
      clerkId,
      email: normalisedEmail,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      role: isAdmin ? "admin" : "user",
      portalKey,
      isActive: isAdmin ? true : false,
      isAList: isAdmin ? true : false,
      aListJoinedAt: isAdmin ? new Date() : null,
      lastLoginAt: new Date(),
    })
    .onConflictDoUpdate({
      target: portalUsersTable.clerkId,
      set: { lastLoginAt: new Date() },
    })
    .returning();
  // Task #643: mirror the brand-new portal member into the internal
  // Sales CRM so first-time Clerk sign-ups land in `crm_contacts` at
  // stage "New" without waiting for the next manual backfill. Fires
  // only on the INSERT path - re-signing in or claiming an existing
  if (inserted) {
    void (async () => {
      try {
        const { enqueueCrmContact } = await import("./crm-ingest");
        await enqueueCrmContact({
          email: inserted.email,
          firstName: inserted.firstName ?? null,
          lastName: inserted.lastName ?? null,
          source: "portal-user",
          properties: {
            portal_user_id: inserted.id,
            portal_key: inserted.portalKey,
            clerk_id: inserted.clerkId,
          },
        });
      } catch {
        // already logged inside enqueueCrmContact
      }
    })();
  }
  return inserted!;
}
