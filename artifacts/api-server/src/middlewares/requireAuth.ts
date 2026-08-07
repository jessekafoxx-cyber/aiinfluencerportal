import { getAuth, clerkClient } from "../lib/auth-compat";
import { getPortalKey } from "../lib/portal-key.js";
import type { Request, Response, NextFunction } from "express";
import { db, appUsers, portalUsersTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import {
  pickClaimableShellRow,
  shouldDenyCrossPortal,
} from "./requireAuth-helpers.js";
import {
  resolveImpersonationContext,
  shouldBlockImpersonatedWrite,
  ImpersonationForbiddenError,
} from "../lib/impersonation.js";
import { hasCapability } from "../lib/capabilities.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      appUser?: any;
      portalUser?: any;
    }
  }
}

const TEST_BYPASS_ENABLED =
  process.env.MT_TEST_BYPASS === "1" &&
  (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test");

if (TEST_BYPASS_ENABLED) {
  // eslint-disable-next-line no-console
  console.warn(
    "[requireAuth] MT_TEST_BYPASS=1 is ACTIVE — X-Test-Clerk-Id headers will be honored. " +
      "This must NEVER run in production or shared environments.",
  );
}

const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "greg@cookemedia.io")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

function isAdminEmail(email?: string | null) {
  return !!email && ADMIN_EMAILS.has(email.toLowerCase());
}

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Test-only bypass: when the server is started with MT_TEST_BYPASS=1
  // (never set in production) and the request carries an X-Test-Clerk-Id
  // header, treat that header value as the authenticated clerkId. Used by
  // the marketing-tool isolation smoke test; ignored otherwise.
  let clerkId: string | undefined;
  let auth: ReturnType<typeof getAuth> | undefined;
  if (TEST_BYPASS_ENABLED) {
    const h = req.headers["x-test-clerk-id"];
    if (typeof h === "string" && h) clerkId = h;
  }
  if (!clerkId) {
    auth = getAuth(req);
    const fromAuth = auth?.sessionClaims?.userId || auth?.userId;
    if (typeof fromAuth === "string" && fromAuth) clerkId = fromAuth;
  }
  if (!clerkId) {
    // Task #774: structured 401 logging so desktop login dead-ends are
    // diagnosable. No clerkId means Clerk never resolved a session for
    // this request (expired/missing token, cookie blocked, JWT template
    // missing userId). We have no email here, so log the path + UA + IP
    // so support can correlate a customer "I can't log in" report.
    logger.warn(
      {
        reason: "no_session",
        path: req.originalUrl || req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.headers["user-agent"] || null,
        hasAuthHeader: !!req.headers["authorization"],
      },
      "[requireAuth] 401 unauthorized (no Clerk session)",
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.userId = clerkId;

  const claims = auth?.sessionClaims as any;
  let email: string | null =
    claims?.email || claims?.email_address || claims?.primary_email_address || null;
  let firstName: string | null = claims?.firstName || claims?.first_name || null;
  let lastName: string | null = claims?.lastName || claims?.last_name || null;

  if (!email) {
    try {
      const client = clerkClient;
      const u = await client.users.getUser(clerkId);
      email = u.emailAddresses?.[0]?.emailAddress || null;
      firstName ||= u.firstName || null;
      lastName ||= u.lastName || null;
    } catch {}
  }

  // Upsert appUsers row (used by source marketing-tool routes for `req.appUser`)
  try {
    let [appUser] = await db.select().from(appUsers).where(eq(appUsers.clerkId, clerkId));
    if (!appUser) {
      const adminUser = isAdminEmail(email);
      [appUser] = await db
        .insert(appUsers)
        .values({
          clerkId,
          email,
          name: [firstName, lastName].filter(Boolean).join(" ") || null,
          role: adminUser ? "super_admin" : "user",
          isSuperAdmin: adminUser,
        })
        .returning();
    } else {
      // Heal stale rows. Greg loaded /admin/influencer-generations and
      // got a silently-empty page because his app_users row had been
      // created previously with `email=null` (Clerk's session claims
      // omit email when the JWT template doesn't include it, and the
      // clerkClient fallback can transiently 5xx). Once `email` is
      // null, `requireInfluencerAdmin`'s ADMIN_EMAILS check can never
      // pass, so the admin endpoint returned 403 forever even though
      // his Clerk identity is the canonical super-admin. We now (a)
      // backfill email/name whenever Clerk has them and the row does
      // not, and (b) flip `is_super_admin` true when the (newly known)
      // email matches ADMIN_EMAILS. Both updates are idempotent.
      const patch: Partial<typeof appUser> = {};
      if (!appUser.email && email) patch.email = email;
      const composedName =
        [firstName, lastName].filter(Boolean).join(" ") || null;
      if (!appUser.name && composedName) patch.name = composedName;
      const effectiveEmail = (patch.email ?? appUser.email) as
        | string
        | null
        | undefined;
      if (!appUser.isSuperAdmin && isAdminEmail(effectiveEmail)) {
        patch.isSuperAdmin = true;
        patch.role = "super_admin";
      }
      if (Object.keys(patch).length > 0) {
        const [healed] = await db
          .update(appUsers)
          .set(patch)
          .where(eq(appUsers.id, appUser.id))
          .returning();
        if (healed) appUser = healed;
      }
    }
    req.appUser = appUser;
  } catch {}

  // Look up portalUser (used by entitlement gate). Scoped by both
  // clerkId AND the request's portalKey so a user with an existing
  // row on one portal cannot be silently attached to a different
  // portal's request and inherit the wrong portalKey, branding, or
  // entitlements. The portal_users.clerk_id column carries a unique
  // constraint today, so a single Clerk identity is bound to one
  // portal; on cross-portal access we deny non-admins and let admins
  // (env-pinned ADMIN_EMAILS) through for cross-portal admin work.
  const requestedPortalKey = getPortalKey(req as any);
  try {
    let [portalUser] = await db
      .select()
      .from(portalUsersTable)
      .where(eq(portalUsersTable.clerkId, clerkId));

    // Task #558: heal legacy portal_key drift on first sign-in. Since the
    // project is single-tenant (only "room30" exists per Task #491) any
    // row whose portalKey is not already "room30" was created under the
    // historical default of "main" and would otherwise trip the
    // cross-portal denial. shouldDenyCrossPortal() now treats those rows
    // as belonging to room30; we transparently update the row so admin
    // dashboards and downstream queries see a single consistent value
    // and the drift cannot keep re-surfacing.
    if (
      portalUser &&
      requestedPortalKey === "room30" &&
      (portalUser.portalKey == null ||
        portalUser.portalKey === "" ||
        portalUser.portalKey !== "room30")
    ) {
      try {
        const [healed] = await db
          .update(portalUsersTable)
          .set({ portalKey: "room30" })
          .where(eq(portalUsersTable.id, portalUser.id))
          .returning();
        if (healed) {
          logger.info(
            {
              clerkId,
              portalUserId: portalUser.id,
              previousPortalKey: portalUser.portalKey,
            },
            "[requireAuth] healed legacy portalKey to room30",
          );
          portalUser = healed;
        }
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), clerkId },
          "[requireAuth] portalKey heal failed",
        );
      }
    }

    // Task #725 follow-up: detect duplicate/legacy shell rows. A buyer
    // with an additional clerk_id=NULL portal_users row carrying the same
    // email + room30 portalKey is a data anomaly that historically caused
    // entitlement queries keyed on portal_user_id to miss orders attached
    // to the shell row. The unique constraint on clerk_id blocks us from
    // re-pointing the shell row at this Clerk identity automatically, so
    // we log it as a structured warning so support can reconcile it via
    // tooling. Ownership checks in our new code paths (influencer-jobs,
    // brain, angles) all key off app_users.id (1:1 per Clerk identity),
    // so they are not affected; this is purely a forward-looking
    // detection signal for the legacy portal_user_id-keyed surfaces.
    if (portalUser && email && requestedPortalKey === "room30") {
      try {
        const lowerEmail = email.trim().toLowerCase();
        const duplicates = await db
          .select({
            id: portalUsersTable.id,
            email: portalUsersTable.email,
          })
          .from(portalUsersTable)
          .where(
            and(
              isNull(portalUsersTable.clerkId),
              eq(portalUsersTable.portalKey, "room30"),
              sql`lower(${portalUsersTable.email}) = ${lowerEmail}`,
            ),
          )
          .limit(5);
        if (duplicates.length > 0) {
          logger.warn(
            {
              clerkId,
              canonicalPortalUserId: portalUser.id,
              duplicateShellRowIds: duplicates.map((d) => d.id),
              email: lowerEmail,
            },
            "[requireAuth] duplicate shell portal_users rows detected; ownership lookups by portal_user_id may miss orders",
          );
        }
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), clerkId },
          "[requireAuth] duplicate-row detection failed",
        );
      }
    }

    if (
      shouldDenyCrossPortal({
        portalUser: portalUser ?? null,
        requestEmail: email,
        requestedPortalKey,
        adminEmails: ADMIN_EMAILS,
      })
    ) {
      // Non-admin trying to access a portal they don't belong to.
      // Refuse rather than silently attaching their other-portal row
      // (which is the cross-portal leak the brand-aware audit flagged).
      logger.warn(
        {
          clerkId,
          userPortalKey: portalUser!.portalKey,
          requestedPortalKey,
        },
        "[requireAuth] cross-portal access denied",
      );
      res
        .status(403)
        .json({ error: "Forbidden -- account does not belong to this portal" });
      return;
    }

    if (!portalUser) {
      const fallbackEmail = email || `${clerkId}@portal.local`;
      const adminUser = isAdminEmail(fallbackEmail);

      // Task #501: claim pre-existing "shell" portal_users rows that were
      // created at purchase time with clerk_id=NULL (see
      // enrollPurchaserAndSendEmail / ensurePortalUserByEmail). When the
      // buyer later completes Clerk signup, requireAuth previously only
      // looked up by clerk_id, missed the shell row, and inserted a new
      // row. If that new row drifted from the shell's portalKey we ended
      // up with the cross-portal 403 Emma hit on /api/portal/*. Instead
      // of blindly inserting, attach the existing shell row by email when
      // exactly one matches the request's portalKey and has no clerk_id
      // yet. The unique constraint on clerk_id is preserved (the shell
      // row has clerk_id IS NULL until this UPDATE).
      if (email) {
        const lowerEmail = email.trim().toLowerCase();
        const shellRows = await db
          .select({
            id: portalUsersTable.id,
            email: portalUsersTable.email,
            clerkId: portalUsersTable.clerkId,
            portalKey: portalUsersTable.portalKey,
            firstName: portalUsersTable.firstName,
            lastName: portalUsersTable.lastName,
          })
          .from(portalUsersTable)
          .where(
            and(
              isNull(portalUsersTable.clerkId),
              eq(portalUsersTable.portalKey, requestedPortalKey),
              sql`lower(${portalUsersTable.email}) = ${lowerEmail}`,
            ),
          )
          .limit(2);
        const shell = pickClaimableShellRow(
          shellRows,
          requestedPortalKey,
          email,
        );
        if (shell) {
          // Task #745: claiming a shell row means a buyer just signed
          // into Clerk for the first time after their purchase. If
          // the shell landed with is_active=false (legacy GHL webhook
          // path, or any other create site that did not pass the
          // flag) the buyer would 403 at requireActive on the very
          // next request. Force isActive=true on claim - they have a
          // matching Clerk identity, so they are by definition a
          // real, active buyer at this point.
          const [claimed] = await db
            .update(portalUsersTable)
            .set({
              clerkId,
              firstName: shell.firstName ?? firstName,
              lastName: shell.lastName ?? lastName,
              lastLoginAt: new Date(),
              isActive: true,
            })
            .where(eq(portalUsersTable.id, shell.id))
            .returning();
          if (claimed) {
            logger.info(
              {
                clerkId,
                portalUserId: claimed.id,
                portalKey: claimed.portalKey,
              },
              "[requireAuth] claimed pre-existing shell portal_users row by email",
            );
            portalUser = claimed;
          }
        }
      }

      if (!portalUser) {
        [portalUser] = await db
          .insert(portalUsersTable)
          .values({
            clerkId,
            email: fallbackEmail,
            firstName,
            lastName,
            role: adminUser ? "admin" : "user",
            portalKey: requestedPortalKey,
            isActive: adminUser,
            isAList: adminUser,
            aListJoinedAt: adminUser ? new Date() : null,
            lastLoginAt: new Date(),
          })
          .onConflictDoUpdate({
            target: portalUsersTable.clerkId,
            set: { lastLoginAt: new Date() },
          })
          .returning();
      }
    }
    req.portalUser = portalUser;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), clerkId },
      "[requireAuth] portalUser upsert failed",
    );
  }

  // Task #710: super-admin "view as user" swap. If a valid
  // X-Impersonate-Session header is attached and the caller is the admin
  // who started the session, swap req.appUser/req.portalUser to the target
  // user's rows so all downstream code sees them as the customer. Write
  // requests are then blocked with 403 (read-only mode).
  try {
    // Task #796: impersonation is allowed for super-admins, admins, and any
    // team member granted the `users.impersonate` capability. req.portalUser /
    // req.appUser here are still the REAL caller (the swap below hasn't
    // happened yet), so this reflects the admin's own powers.
    const callerMayImpersonate = hasCapability(
      req.portalUser,
      "users.impersonate",
      !!req.appUser?.isSuperAdmin,
    );
    const ctx = await resolveImpersonationContext(req, clerkId, callerMayImpersonate);
    if (ctx) {
      req.impersonator = {
        clerkId,
        email: ctx.adminEmail,
        sessionId: ctx.sessionId,
      };
      req.portalUser = ctx.targetPortalUser;
      if (ctx.targetAppUser) req.appUser = ctx.targetAppUser;
    }
  } catch (err) {
    // Forged header / non-super-admin caller / expired or wrong-admin token:
    // return 403 explicitly so the client cannot mask its identity by
    // attaching an unauthorized X-Impersonate-Session header.
    if (err instanceof ImpersonationForbiddenError) {
      logger.warn(
        { reason: err.reason, clerkId },
        "[requireAuth] impersonation header rejected",
      );
      res.status(403).json({
        error: "impersonation_forbidden",
        reason: err.reason,
        message:
          "Your account is not authorized to impersonate other users, or the impersonation session is no longer valid.",
      });
      return;
    }
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[requireAuth] impersonation resolve failed",
    );
  }
  if (shouldBlockImpersonatedWrite(req)) {
    res.status(403).json({
      error: "impersonation_read_only",
      message:
        "This action is disabled while viewing the portal as another user. Click Exit in the gold banner to return to your admin session and try again.",
    });
    return;
  }

  next();
};

export const requireSuperAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  await requireAuth(req, res, () => {
    if (!req.appUser?.isSuperAdmin && req.portalUser?.role !== "admin") {
      res.status(403).json({ error: "Forbidden -- super admin access required" });
      return;
    }
    next();
  });
};

/**
 * Stricter variant: requires appUser.isSuperAdmin === true.
 * Portal admins (portalUser.role === "admin") are NOT granted access.
 * Used for Command Center and other highly sensitive internal tools.
 */
export const requireTrueSuperAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  await requireAuth(req, res, () => {
    if (!req.appUser?.isSuperAdmin) {
      res.status(403).json({ error: "Forbidden -- Command Center requires super-admin access" });
      return;
    }
    next();
  });
};
