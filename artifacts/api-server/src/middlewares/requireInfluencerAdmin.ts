import type { Request, Response, NextFunction } from "express";
import { getAuth } from "../lib/auth-compat";

// Same allow-list shape used by `routes/influencer-jobs.ts` for the
// per-job diagnostics endpoint. Centralised here so every admin-only
// AI Influencer surface (per-job diagnostics + Task #696 cross-user
// generations API) shares one source of truth.
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "greg@cookemedia.io")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export function isInfluencerAdmin(req: Request): boolean {
  if (req.appUser?.isSuperAdmin) return true;
  const appUserEmail = (req.appUser?.email ?? "").toLowerCase();
  if (appUserEmail && ADMIN_EMAILS.has(appUserEmail)) return true;
  // Defensive fallback: if req.appUser exists but email is null (Clerk
  // session claims omit it AND clerkClient.users.getUser transiently
  // failed when requireAuth ran), check the Clerk JWT email directly
  // before locking the real super-admin out of his own admin console.
  // This is the wedge that made /admin/influencer-generations look
  // completely empty for greg@cookemedia.io.
  const auth = getAuth(req);
  const claims = auth?.sessionClaims as
    | { email?: string; email_address?: string; primary_email_address?: string }
    | undefined;
  const jwtEmail = (
    claims?.email ||
    claims?.email_address ||
    claims?.primary_email_address ||
    ""
  ).toLowerCase();
  return !!jwtEmail && ADMIN_EMAILS.has(jwtEmail);
}

export function requireInfluencerAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isInfluencerAdmin(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}
