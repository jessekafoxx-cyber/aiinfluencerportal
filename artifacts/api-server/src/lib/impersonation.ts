import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  adminImpersonationSessionsTable,
  portalUsersTable,
  appUsers,
} from "@workspace/db";
import type { Request } from "express";

export const IMPERSONATION_HEADER = "x-impersonate-session";
export const IMPERSONATION_TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8h

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SESSION_SECRET is required to sign admin impersonation tokens",
      );
    }
    return "dev-only-internal-secret-do-not-use-in-prod";
  }
  return s;
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(
    str.replace(/-/g, "+").replace(/_/g, "/") + pad,
    "base64",
  );
}

export interface ImpersonationTokenPayload {
  adminClerkId: string;
  targetUserId: number;
  sessionId: number;
  exp: number; // unix seconds
}

export function signImpersonationToken(
  payload: Omit<ImpersonationTokenPayload, "exp">,
  ttlMs: number = IMPERSONATION_TOKEN_TTL_MS,
): string {
  const full: ImpersonationTokenPayload = {
    ...payload,
    exp: Math.floor((Date.now() + ttlMs) / 1000),
  };
  const body = b64urlEncode(Buffer.from(JSON.stringify(full), "utf8"));
  const sig = b64urlEncode(
    createHmac("sha256", getSecret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export type VerifyImpersonationResult =
  | { ok: true; payload: ImpersonationTokenPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

/**
 * Verify a token's HMAC and parse the payload. Returns a tagged result so
 * callers can distinguish "expired" (soft fail → fall back to admin
 * identity + auto-close the session row) from "bad_signature" / "malformed"
 * (hard fail → 403). Wire this through `verifyImpersonationToken` when a
 * caller only needs the legacy payload-or-null shape.
 */
export function verifyImpersonationTokenDetailed(
  token: unknown,
): VerifyImpersonationResult {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [body, sig] = token.split(".");
  if (!body || !sig) return { ok: false, reason: "malformed" };
  let expectedSig: Buffer;
  try {
    expectedSig = createHmac("sha256", getSecret()).update(body).digest();
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  const givenSig = b64urlDecode(sig);
  if (givenSig.length !== expectedSig.length) {
    return { ok: false, reason: "bad_signature" };
  }
  if (!timingSafeEqual(givenSig, expectedSig)) {
    return { ok: false, reason: "bad_signature" };
  }
  let payload: ImpersonationTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof payload?.adminClerkId !== "string" ||
    typeof payload?.targetUserId !== "number" ||
    typeof payload?.sessionId !== "number" ||
    typeof payload?.exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (payload.exp * 1000 <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}

export function verifyImpersonationToken(
  token: unknown,
): ImpersonationTokenPayload | null {
  const r = verifyImpersonationTokenDetailed(token);
  return r.ok ? r.payload : null;
}

export interface ImpersonationContext {
  sessionId: number;
  adminClerkId: string;
  adminEmail: string | null;
  targetPortalUser: typeof portalUsersTable.$inferSelect;
  targetAppUser: typeof appUsers.$inferSelect | null;
}

/**
 * Thrown when a caller attempts to use the X-Impersonate-Session header but
 * is not authorized to (not a super-admin, token forged/expired, token bound
 * to a different admin, or session already closed). Callers in the auth
 * middleware should translate this into a 403 instead of silently dropping
 * back to the caller's own identity — the requirement is that any header
 * attempt by a non-super-admin is rejected explicitly.
 */
export class ImpersonationForbiddenError extends Error {
  reason: string;
  constructor(reason: string) {
    super(`impersonation_forbidden: ${reason}`);
    this.name = "ImpersonationForbiddenError";
    this.reason = reason;
  }
}

/**
 * Given a request whose caller has already been resolved as `callerClerkId`
 * (the admin's Clerk id), verify any X-Impersonate-Session header and return
 * the swapped portal/app user rows the request should be evaluated against.
 * Returns null when no header is present.
 * Throws ImpersonationForbiddenError when a header IS present but the caller
 * is not allowed to use it (lacks the impersonate capability,
 * forged/expired/wrong-admin token, or closed session) so the middleware can
 * return 403 instead of silently downgrading.
 *
 * Task #796: `callerMayImpersonate` is now true for any caller holding the
 * `users.impersonate` capability (admins implicitly, plus permitted team
 * members), not just super-admins.
 */
export async function resolveImpersonationContext(
  req: Request,
  callerClerkId: string,
  callerMayImpersonate: boolean,
): Promise<ImpersonationContext | null> {
  const raw = req.headers[IMPERSONATION_HEADER];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token) return null;
  if (!callerMayImpersonate) {
    throw new ImpersonationForbiddenError("not_permitted");
  }
  const verified = verifyImpersonationTokenDetailed(token);
  if (!verified.ok) {
    // Expired = SOFT fail: silently fall back to the admin's own identity
    // (the client is expected to drop the stale token on the next /status
    // reconcile poll). We still best-effort auto-close any orphan session
    // rows so the audit trail is consistent.
    if (verified.reason === "expired") {
      try {
        await db
          .update(adminImpersonationSessionsTable)
          .set({ endedAt: new Date(), endedReason: "expired" })
          .where(
            and(
              eq(adminImpersonationSessionsTable.adminClerkId, callerClerkId),
              isNull(adminImpersonationSessionsTable.endedAt),
            ),
          );
      } catch {}
      return null;
    }
    // Forged / tampered token = HARD fail.
    throw new ImpersonationForbiddenError("invalid_token");
  }
  const payload = verified.payload;
  if (payload.adminClerkId !== callerClerkId) {
    throw new ImpersonationForbiddenError("token_admin_mismatch");
  }

  const [session] = await db
    .select()
    .from(adminImpersonationSessionsTable)
    .where(eq(adminImpersonationSessionsTable.id, payload.sessionId))
    .limit(1);
  // Session row missing or already closed = SOFT fail: admin's session was
  // ended on another tab / by a server-side sweep. Fall back to admin
  // identity rather than 403'ing the whole request.
  if (!session) return null;
  if (session.endedAt) return null;
  if (session.adminClerkId !== callerClerkId) {
    // Token bound to a different admin than the session row claims is a
    // real tampering attempt, not a stale-session race.
    throw new ImpersonationForbiddenError("session_admin_mismatch");
  }
  if (session.targetPortalUserId !== payload.targetUserId) {
    throw new ImpersonationForbiddenError("session_target_mismatch");
  }
  // Server-side expiry: auto-close the row and soft-fail (same UX as
  // token-level expiry above).
  if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
    try {
      await db
        .update(adminImpersonationSessionsTable)
        .set({ endedAt: new Date(), endedReason: "expired" })
        .where(eq(adminImpersonationSessionsTable.id, session.id));
    } catch {}
    return null;
  }

  const [targetPortalUser] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.id, session.targetPortalUserId))
    .limit(1);
  if (!targetPortalUser) return null;

  let targetAppUser: typeof appUsers.$inferSelect | null = null;
  if (targetPortalUser.clerkId) {
    const [row] = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.clerkId, targetPortalUser.clerkId))
      .limit(1);
    if (row) targetAppUser = row;
  }

  return {
    sessionId: session.id,
    adminClerkId: session.adminClerkId,
    adminEmail: session.adminEmail,
    targetPortalUser,
    targetAppUser,
  };
}

/**
 * Close every open impersonation session for the given admin. Used both when
 * the admin hits "Exit" and when a new "Start" arrives (auto-close prior).
 */
export async function endOpenImpersonationSessions(
  adminClerkId: string,
  reason: string,
): Promise<number> {
  const closed = await db
    .update(adminImpersonationSessionsTable)
    .set({ endedAt: new Date(), endedReason: reason })
    .where(
      and(
        eq(adminImpersonationSessionsTable.adminClerkId, adminClerkId),
        isNull(adminImpersonationSessionsTable.endedAt),
      ),
    )
    .returning({ id: adminImpersonationSessionsTable.id });
  return closed.length;
}

export function isImpersonationWriteAllowedPath(path: string): boolean {
  // Strip query string.
  const clean = (path.split("?")[0] || "").replace(/\/+$/, "");
  // Stop endpoint must always be callable so Exit always works.
  if (clean === "/api/portal/admin/impersonate/stop") return true;
  // Start endpoint must also be callable while impersonating so the admin
  // can switch directly from one target user to another (the route handler
  // closes the prior session via endOpenImpersonationSessions before
  // minting the new token).
  if (/^\/api\/portal\/admin\/impersonate\/\d+$/.test(clean)) return true;
  return false;
}

export function shouldBlockImpersonatedWrite(req: Request): boolean {
  if (!(req as any).impersonator) return false;
  const m = (req.method || "GET").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
  return !isImpersonationWriteAllowedPath(req.originalUrl || req.url || "");
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      impersonator?: {
        clerkId: string;
        email: string | null;
        sessionId: number;
      };
    }
  }
}
