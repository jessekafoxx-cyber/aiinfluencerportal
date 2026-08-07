/**
 * AI Video Studio admin gate (Task #828).
 *
 * The Video Studio is admin-only and must be INVISIBLE to non-admins:
 * every endpoint returns 404 (not 403) so a non-admin cannot even detect
 * the feature exists. This mirrors the "non-admins see NOTHING" rule - no
 * sidebar entry, no routes, no 403 signal.
 *
 * Admin resolution ORs the existing portal admin signals:
 *   - req.appUser.isSuperAdmin (env ADMIN_EMAILS healed into app_users)
 *   - req.portalUser.role === 'admin'
 *   - the caller's email is in ADMIN_EMAILS or VIDEO_STUDIO_ADMIN_EMAILS
 */

import type { Request, Response, NextFunction } from "express";
import { requireAuth } from "./requireAuth.js";

const VIDEO_STUDIO_ADMIN_EMAILS = new Set(
  (process.env.VIDEO_STUDIO_ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

const BASE_ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "greg@cookemedia.io")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * Pure predicate over an authenticated request. Safe to call only AFTER
 * requireAuth has populated req.appUser / req.portalUser.
 */
export function isVideoStudioAdmin(req: Request): boolean {
  if (req.appUser?.isSuperAdmin) return true;
  if (req.portalUser?.role === "admin") return true;
  const email = (req.appUser?.email || req.portalUser?.email || "")
    .toString()
    .trim()
    .toLowerCase();
  if (!email) return false;
  return BASE_ADMIN_EMAILS.has(email) || VIDEO_STUDIO_ADMIN_EMAILS.has(email);
}

/**
 * Video Studio admins (the studio is admin-only today) get UNLIMITED video
 * credits: their generations/edits never debit a wallet and never hit the
 * insufficient-balance 402. Paying non-admins (once the studio is ungated)
 * still run on the credit ledger. Kept as its own named predicate so the
 * "unlimited" semantic is explicit at every call site, even though it
 * currently mirrors isVideoStudioAdmin.
 */
export function hasUnlimitedVideoCredits(req: Request): boolean {
  return isVideoStudioAdmin(req);
}

/**
 * Express middleware: authenticate, then 404 unless the caller is a Video
 * Studio admin. Returns 404 (never 403) for both unauthenticated and
 * authenticated-but-not-admin callers so the feature is undetectable.
 */
export const requireVideoStudioAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  // Run the standard auth chain but never leak its 401/403 for this
  // feature - any failure to resolve an admin identity becomes a 404.
  let authPassed = false;
  await new Promise<void>((resolve) => {
    requireAuth(req, res, () => {
      authPassed = true;
      resolve();
    }).catch(() => resolve());
    // If requireAuth already sent a response (401/403), resolve so we can
    // overwrite intent below. Express guards against double-send via
    // res.headersSent which we check before responding.
  });

  if (!authPassed || !isVideoStudioAdmin(req)) {
    if (!res.headersSent) {
      res.status(404).json({ error: "Not found" });
    }
    return;
  }
  next();
};
