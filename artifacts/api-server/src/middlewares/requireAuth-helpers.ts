// Pure helpers extracted from requireAuth so the Task #501 regression
// cases can be exercised without spinning up a Postgres + Clerk harness.
// Keep these dependency-free.

export interface PortalUserShellRow {
  id: number;
  email: string;
  clerkId: string | null;
  portalKey: string;
  firstName: string | null;
  lastName: string | null;
}

export interface CrossPortalCheckInput {
  /** The portalUser row already attached to this clerkId, if any. */
  portalUser: { email: string | null; portalKey: string } | null;
  /** The Clerk-resolved email for the live request (used to detect admins
   *  whose portal_users.email may not match the current Clerk email). */
  requestEmail: string | null;
  /** What `getPortalKey(req)` returned for this request. */
  requestedPortalKey: string;
  /** Set of admin email addresses (lowercased). */
  adminEmails: ReadonlySet<string>;
}

/**
 * Decide whether requireAuth should fire the cross-portal 403 denial.
 *
 * Mirrors the original inline check in requireAuth.ts: a row whose
 * portalKey diverges from the request's portalKey is denied for any
 * non-admin caller. Admins (env-pinned ADMIN_EMAILS, matched against
 * either the row's email or the request's Clerk email) are allowed
 * through for cross-portal admin work.
 */
export function shouldDenyCrossPortal({
  portalUser,
  requestEmail,
  requestedPortalKey,
  adminEmails,
}: CrossPortalCheckInput): boolean {
  if (!portalUser) return false;
  if (portalUser.portalKey === requestedPortalKey) return false;
  // Task #558: the project is single-tenant since Task #491 - the only
  // portal that exists is "room30". Legacy rows still carry the historical
  // default portal_key='main' (or any other stale value), and getPortalKey()
  // unconditionally returns "room30". Denying these would 403 every legacy
  // Room30 buyer for no protective reason. Treat any row as belonging to
  // the room30 portal when room30 is what's being requested; requireAuth
  // heals the row to portal_key='room30' on the same request so the drift
  // doesn't persist.
  if (requestedPortalKey === "room30") return false;
  const candidates = [portalUser.email, requestEmail];
  for (const c of candidates) {
    if (c && adminEmails.has(c.toLowerCase())) return false;
  }
  return true;
}

/**
 * Of the candidate shell rows (clerk_id IS NULL, same portalKey as the
 * request), pick the one to claim by email. Returns null when nothing
 * is claimable. Mirrors the SELECT ... LIMIT 2 logic in requireAuth so
 * the "exactly one match" rule is unambiguous.
 *
 * Why "exactly one"? Two parked shell rows with the same email + portal
 * is a data anomaly (Emma's case was a single row). Claiming an
 * arbitrary one of multiple would silently merge accounts; in that
 * scenario we fall through to the insert path and let support resolve
 * the duplicate manually.
 */
export function pickClaimableShellRow(
  shellRows: ReadonlyArray<PortalUserShellRow>,
  requestedPortalKey: string,
  email: string | null,
): PortalUserShellRow | null {
  if (!email) return null;
  const lower = email.trim().toLowerCase();
  if (!lower) return null;
  const eligible = shellRows.filter(
    (r) =>
      r.clerkId === null &&
      r.portalKey === requestedPortalKey &&
      (r.email || "").trim().toLowerCase() === lower,
  );
  if (eligible.length !== 1) return null;
  return eligible[0]!;
}
