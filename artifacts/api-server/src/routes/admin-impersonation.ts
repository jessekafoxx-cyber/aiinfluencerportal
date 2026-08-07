// ─────────────────────────────────────────────────────────────────────────────
// Task #710 — Super-admin "view as user" impersonation endpoints.
//
// Mounted at /api/portal/admin/impersonate. The start endpoint requires the
// caller to be a super-admin AND not currently impersonating. The stop
// endpoint is the only write endpoint that remains callable while
// impersonating (see lib/impersonation.ts:isImpersonationWriteAllowedPath)
// so the "Exit" button always works.
// ─────────────────────────────────────────────────────────────────────────────
import { Router, type IRouter, type Request, type Response } from "express";
import { db, portalUsersTable, adminImpersonationSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import {
  signImpersonationToken,
  endOpenImpersonationSessions,
  IMPERSONATION_TOKEN_TTL_MS,
} from "../lib/impersonation";
import { hasCapability } from "../lib/capabilities";

const router: IRouter = Router();

router.use(requireAuth);

// Task #796: impersonation is no longer super-admin-only. Any caller who
// holds the `users.impersonate` capability (admins implicitly, plus team
// members granted it) may start / stop a "view as user" session.
function callerCanImpersonate(req: Request): boolean {
  return hasCapability(
    (req as any).portalUser,
    "users.impersonate",
    !!req.appUser?.isSuperAdmin,
  );
}

// NOTE on route ordering: Express 5 / path-to-regexp v8 no longer accepts
// the Express 4 regex constraint syntax (":userId(\\d+)"), so the literal
// "/stop" and "/status" routes MUST be declared before the parametric
// "/:userId" route below — otherwise the parametric route would swallow
// them. Non-numeric userIds are rejected inside the handler with a 400
// invalid_user_id via Number.isFinite.

// POST /api/portal/admin/impersonate/stop
// End the current impersonation session. Callable while impersonating
// (whitelisted in shouldBlockImpersonatedWrite) so Exit always works.
router.post("/stop", async (req: Request, res: Response) => {
  const impersonator = (req as any).impersonator as
    | { clerkId: string; sessionId: number }
    | undefined;

  // If the request carries an impersonation header, requireAuth has
  // already validated + resolved it. Use the impersonator's clerkId so
  // the audit trail records the admin, not the user we were viewing as.
  const adminClerkId: string | undefined =
    impersonator?.clerkId ??
    (req.appUser?.clerkId as string | undefined) ??
    (req.userId as string | undefined);

  if (!adminClerkId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // If the caller is not impersonating AND lacks the impersonate
  // capability, deny.
  if (!impersonator && !callerCanImpersonate(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const closed = await endOpenImpersonationSessions(
    adminClerkId,
    impersonator ? "admin_exit" : "admin_exit_no_header",
  );
  logger.info(
    { adminClerkId, closed, sessionId: impersonator?.sessionId ?? null },
    "[admin-impersonation] session stopped",
  );
  res.json({ ok: true, closed });
});

// GET /api/portal/admin/impersonate/status
// Lightweight status check the portal uses on page load to confirm a
// stored token is still valid (e.g. after a refresh across a tab).
router.get("/status", async (req: Request, res: Response) => {
  const impersonator = (req as any).impersonator as
    | { clerkId: string; email: string | null; sessionId: number }
    | undefined;
  if (!impersonator) {
    res.json({ active: false });
    return;
  }
  res.json({
    active: true,
    sessionId: impersonator.sessionId,
    admin: { clerkId: impersonator.clerkId, email: impersonator.email },
    target: req.portalUser
      ? {
          id: req.portalUser.id,
          email: req.portalUser.email,
          firstName: req.portalUser.firstName ?? null,
          lastName: req.portalUser.lastName ?? null,
        }
      : null,
  });
});

// POST /api/portal/admin/impersonate/:userId
// Start an impersonation session targeting the given portal user. Returns
// the signed token the client stores in sessionStorage. Auto-closes any
// prior open sessions for this admin so only one is ever active.
router.post("/:userId", async (req: Request, res: Response) => {
  // Start may be called while already impersonating so the admin can switch
  // targets without first hitting Exit. In that case the *real* admin
  // identity comes from req.impersonator (set by requireAuth when the
  // header validates), NOT from req.appUser (which has been swapped to the
  // target portal user). The shared write-block whitelist permits this
  // path; the prior session is auto-closed below via
  // endOpenImpersonationSessions("superseded_by_new_session").
  const impersonator = (req as any).impersonator as
    | { clerkId: string; email: string | null; sessionId: number }
    | undefined;
  const callerMayImpersonate = !!impersonator || callerCanImpersonate(req);
  if (!callerMayImpersonate) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const userIdNum = Number(req.params.userId);
  if (!Number.isFinite(userIdNum) || userIdNum <= 0) {
    res.status(400).json({ error: "invalid_user_id" });
    return;
  }

  const [target] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.id, userIdNum))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "user_not_found" });
    return;
  }

  // When rotating sessions, the impersonator's clerkId is the real admin;
  // req.appUser has been swapped to the target by requireAuth.
  const adminClerkId = (impersonator?.clerkId ??
    req.appUser?.clerkId ??
    req.userId) as string | undefined;
  if (!adminClerkId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const adminEmail: string | null =
    impersonator?.email ?? req.appUser?.email ?? null;

  // Close any prior open sessions so only one is ever active per admin.
  await endOpenImpersonationSessions(adminClerkId, "superseded_by_new_session");

  const expiresAt = new Date(Date.now() + IMPERSONATION_TOKEN_TTL_MS);
  const [session] = await db
    .insert(adminImpersonationSessionsTable)
    .values({
      adminClerkId,
      adminEmail,
      targetPortalUserId: target.id,
      targetEmail: target.email,
      expiresAt,
    })
    .returning();

  const token = signImpersonationToken({
    adminClerkId,
    targetUserId: target.id,
    sessionId: session.id,
  });

  logger.info(
    {
      sessionId: session.id,
      adminClerkId,
      adminEmail,
      targetPortalUserId: target.id,
      targetEmail: target.email,
    },
    "[admin-impersonation] session started",
  );

  res.json({
    sessionId: session.id,
    token,
    expiresAt: expiresAt.toISOString(),
    target: {
      id: target.id,
      email: target.email,
      firstName: target.firstName ?? null,
      lastName: target.lastName ?? null,
      role: target.role,
    },
    admin: { clerkId: adminClerkId, email: adminEmail },
  });
});

export default router;
