// Task #796 - Team roles & granular capabilities (frontend mirror).
//
// This file MUST stay in sync with the api-server source of truth at
// artifacts/api-server/src/lib/capabilities.ts. Artifacts cannot cross-import,
// so the canonical capability list, presets, and helpers are duplicated here
// for the admin UI. The backend remains the security boundary - this mirror
// only drives what the UI shows / pre-selects.

export const TEAM_CAPABILITIES = [
  "users.view",
  "users.invite",
  "users.reset_password",
  "users.grant_access",
  "users.impersonate",
  "logs.view",
] as const;

export type TeamCapability = (typeof TEAM_CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(TEAM_CAPABILITIES);

export function isTeamCapability(value: unknown): value is TeamCapability {
  return typeof value === "string" && CAPABILITY_SET.has(value);
}

export const CAPABILITY_META: Record<
  TeamCapability,
  { label: string; description: string }
> = {
  "users.view": {
    label: "View customers",
    description: "See the customer list and open individual customer profiles.",
  },
  "users.invite": {
    label: "Invite & resend",
    description: "Send new portal invites and resend existing ones.",
  },
  "users.reset_password": {
    label: "Reset passwords",
    description: "Send a customer a temporary password to sign back in.",
  },
  "users.grant_access": {
    label: "Grant access",
    description: "Grant or revoke a customer's product entitlements.",
  },
  "users.impersonate": {
    label: "Log in as customer",
    description: "View the portal as a customer (read-only) to help them.",
  },
  "logs.view": {
    label: "View logs",
    description: "View access and activity logs for dispute support.",
  },
};

export type TeamRoleKey =
  | "onboarding_specialist"
  | "customer_support_specialist"
  | "custom";

export const TEAM_ROLE_PRESETS: Record<
  TeamRoleKey,
  { label: string; description: string; capabilities: TeamCapability[] }
> = {
  onboarding_specialist: {
    label: "Onboarding Specialist",
    description:
      "Helps new customers get set up - invites, resends, password resets, granting access, and activity logs.",
    capabilities: [
      "users.view",
      "users.invite",
      "users.reset_password",
      "users.grant_access",
      "logs.view",
    ],
  },
  customer_support_specialist: {
    label: "Customer Support Specialist",
    description:
      "Full front-line support toolkit - view customers, invite/resend, reset passwords, grant access, log in as a customer, and view logs.",
    capabilities: [
      "users.view",
      "users.invite",
      "users.reset_password",
      "users.grant_access",
      "users.impersonate",
      "logs.view",
    ],
  },
  custom: {
    label: "Custom",
    description: "Pick exactly which capabilities this team member has.",
    capabilities: [],
  },
};

export function isTeamRoleKey(value: unknown): value is TeamRoleKey {
  return (
    value === "onboarding_specialist" ||
    value === "customer_support_specialist" ||
    value === "custom"
  );
}

export function sanitizeCapabilities(input: unknown): TeamCapability[] {
  if (!Array.isArray(input)) return [];
  const out: TeamCapability[] = [];
  for (const v of input) {
    if (isTeamCapability(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

type CapabilityUserLike =
  | {
      role?: string | null;
      permissions?: unknown;
      capabilities?: unknown;
    }
  | null
  | undefined;

// Resolve the effective capability set for a user. Admins always hold the
// full set; team members hold whatever survives sanitization. When the API
// has already computed a flat `capabilities` array (as getMe does), prefer it.
export function userCapabilities(
  user: CapabilityUserLike,
  isAdmin: boolean,
): Set<TeamCapability> {
  if (isAdmin || user?.role === "admin") {
    return new Set(TEAM_CAPABILITIES);
  }
  if (Array.isArray(user?.capabilities)) {
    return new Set(sanitizeCapabilities(user?.capabilities));
  }
  if (user?.role === "team") {
    return new Set(sanitizeCapabilities(user.permissions));
  }
  return new Set();
}

export function hasCapability(
  user: CapabilityUserLike,
  cap: TeamCapability,
  isAdmin: boolean,
): boolean {
  return userCapabilities(user, isAdmin).has(cap);
}
