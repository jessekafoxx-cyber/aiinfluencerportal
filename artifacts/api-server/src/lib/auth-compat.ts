/**
 * Clerk auth entry points for the portal backend.
 *
 * `getAuth(req)` reads the Clerk JWT validated by clerkMiddleware() and
 * returns the session claims. `clerkClient` is the real Clerk server-side
 * API client (backed by CLERK_SECRET_KEY) — used by requireAuth to recover
 * email / name via the Clerk API when session claims don't include them.
 *
 * AUTH CONFIGURATION: To manage users, login providers, branding, or
 * credentials, use the Auth pane in the workspace toolbar. There is no
 * external Clerk dashboard for Replit-managed tenants.
 */
export { getAuth, clerkClient } from "@clerk/express";
