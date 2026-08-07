// Task #796 - Team roles & granular capabilities.
//
// A "team" portal_user can be granted a subset of staff capabilities. An
// "admin" (or the env-pinned super admin) implicitly holds every capability.
// Students hold none. The source of truth for a team member is the
// `permissions` array on portal_users; `team_role` is only a UI preset label.

export const TEAM_CAPABILITIES = [
  "users.view", // view the customer list + individual customer profiles
  "users.invite", // create + resend portal invites
  "users.reset_password", // send a password-reset to a customer
  "users.grant_access", // grant / revoke product entitlements
  "users.impersonate", // log in as a customer (read-only "view as user")
  "logs.view", // view access / activity logs
] as const;

export type TeamCapability = (typeof TEAM_CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(TEAM_CAPABILITIES);

export function isTeamCapability(value: unknown): value is TeamCapability {
  return typeof value === "string" && CAPABILITY_SET.has(value);
}

// Human-readable labels + descriptions for the admin UI. Kept here so the
// wire contract (what the API accepts) and the presentation stay together.
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

// Preset roles seed the permission checkboxes. "custom" starts empty and is
// configured entirely by hand. These are the canonical presets referenced in
// Task #796 (CS Specialist gets the full staff toolkit minus analytics).
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

// Drop anything that is not a known capability so a malformed/stale payload
// can never widen a team member's powers beyond the current allowlist.
export function sanitizeCapabilities(input: unknown): TeamCapability[] {
  if (!Array.isArray(input)) return [];
  const out: TeamCapability[] = [];
  for (const v of input) {
    if (isTeamCapability(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

type CapabilityUserLike = {
  role?: string | null;
  permissions?: unknown;
} | null
  | undefined;

// Resolve the effective capability set for a caller. Admins / super-admins
// always hold the full set; team members hold whatever survives sanitization;
// everyone else holds nothing.
export function userCapabilities(
  user: CapabilityUserLike,
  isSuperAdmin: boolean,
): Set<TeamCapability> {
  if (isSuperAdmin || user?.role === "admin") {
    return new Set(TEAM_CAPABILITIES);
  }
  if (user?.role === "team") {
    return new Set(sanitizeCapabilities(user.permissions));
  }
  return new Set();
}

export function hasCapability(
  user: CapabilityUserLike,
  cap: TeamCapability,
  isSuperAdmin: boolean,
): boolean {
  return userCapabilities(user, isSuperAdmin).has(cap);
}
