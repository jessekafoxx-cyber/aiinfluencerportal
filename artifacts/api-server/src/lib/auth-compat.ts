/**
 * Replit Auth compatibility layer.
 *
 * The codebase was originally built on Clerk, where routes called
 * `getAuth(req)` for the session and `clerkClient.users.getUser()` for
 * profile data. Authentication now runs through Replit Auth (OIDC): the
 * `authMiddleware` loads the session and puts the user on `req.user`.
 *
 * This module re-implements the two Clerk entry points on top of
 * `req.user` so the ~15 route files that used them only needed an import
 * swap. The historical "clerkId" columns in app_users / portal_users now
 * store the Replit Auth user id (the OIDC `sub` claim) — the linking /
 * shell-row-claiming semantics are unchanged.
 */
import type { Request } from "express";
import { db, appUsers, portalUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface CompatSessionClaims {
  userId: string;
  email: string | null;
  email_address: string | null;
  firstName: string | null;
  first_name: string | null;
  lastName: string | null;
  last_name: string | null;
  [key: string]: unknown;
}

export interface CompatAuth {
  userId: string | null;
  sessionClaims: CompatSessionClaims | null;
}

export function getAuth(req: Request): CompatAuth {
  const user = (req as Request & { user?: { id: string; email: string | null; firstName: string | null; lastName: string | null } }).user;
  if (!user?.id) return { userId: null, sessionClaims: null };
  return {
    userId: user.id,
    sessionClaims: {
      userId: user.id,
      email: user.email ?? null,
      email_address: user.email ?? null,
      firstName: user.firstName ?? null,
      first_name: user.firstName ?? null,
      lastName: user.lastName ?? null,
      last_name: user.lastName ?? null,
    },
  };
}

export interface CompatUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  emailAddresses: { emailAddress: string }[];
  primaryEmailAddress: { emailAddress: string } | null;
}

/**
 * Clerk-shaped user lookup backed by our own database. Routes only ever
 * used `getUser(id)` to recover the email / name of the *current* user
 * when session claims were missing them; with Replit Auth the claims are
 * always populated, so this is a rarely-hit fallback.
 */
export const clerkClient = {
  users: {
    async getUser(id: string): Promise<CompatUser> {
      let email: string | null = null;
      let name: string | null = null;
      const [appUser] = await db
        .select({ email: appUsers.email, name: appUsers.name })
        .from(appUsers)
        .where(eq(appUsers.clerkId, id));
      if (appUser) {
        email = appUser.email ?? null;
        name = appUser.name ?? null;
      }
      let firstName: string | null = null;
      let lastName: string | null = null;
      if (!email || !name) {
        const [portalUser] = await db
          .select({
            email: portalUsersTable.email,
            firstName: portalUsersTable.firstName,
            lastName: portalUsersTable.lastName,
          })
          .from(portalUsersTable)
          .where(eq(portalUsersTable.clerkId, id));
        if (portalUser) {
          email ||= portalUser.email ?? null;
          firstName = portalUser.firstName ?? null;
          lastName = portalUser.lastName ?? null;
        }
      }
      if (!firstName && name) {
        const parts = name.split(" ");
        firstName = parts[0] || null;
        lastName = parts.slice(1).join(" ") || null;
      }
      return {
        id,
        firstName,
        lastName,
        emailAddresses: email ? [{ emailAddress: email }] : [],
        primaryEmailAddress: email ? { emailAddress: email } : null,
      };
    },
  },
};
