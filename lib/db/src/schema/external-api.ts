import {
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// External admin API keys for partner integrations such as the GetViktor
// Slack/Teams agent. Keys are issued from the admin panel; the plaintext
// value is shown to the admin once at creation time and never again. The
// DB only stores the SHA-256 hash + a 4-char "last4" hint so admins can
// identify which key is which in the audit log without exposing secrets.
//
// Auth flow: external callers send the plaintext key as the `x-api-key`
// header. The middleware (artifacts/api-server/src/middlewares/
// requireExternalApiKey.ts) hashes it and looks up an unrevoked row.
export const externalApiKeysTable = pgTable("external_api_keys", {
  id: serial("id").primaryKey(),
  // sha-256 hex of the plaintext key. Unique by definition.
  keyHash: text("key_hash").notNull().unique(),
  // human-readable label, e.g. "GetViktor production".
  name: text("name").notNull(),
  // last 4 chars of the plaintext key (for "key ending in xxxx" UI).
  last4: text("last4").notNull(),
  // who created the key (clerk id of the admin).
  createdByClerkId: text("created_by_clerk_id"),
  createdByEmail: text("created_by_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // null while active; set to a timestamp the moment an admin revokes the
  // key. Revoked keys can never be re-activated; admins generate a new one.
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedByClerkId: text("revoked_by_clerk_id"),
  revokedReason: text("revoked_reason"),
  // last successful auth timestamp - shown in the admin UI so the operator
  // can spot keys that have gone unused or are being actively probed.
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  lastUsedIp: text("last_used_ip"),
});

export type ExternalApiKey = typeof externalApiKeysTable.$inferSelect;
export type InsertExternalApiKey = typeof externalApiKeysTable.$inferInsert;

// Singleton settings row (id=1) used as the global kill-switch for the
// external admin API. When `kill_switch_enabled` is true, every endpoint
// in the external namespace returns 503 immediately, regardless of which
// key was presented. Designed for "shut it all down right now" scenarios
// (compromised key suspected, runaway script, partner dispute).
export const externalApiSettingsTable = pgTable("external_api_settings", {
  id: integer("id").primaryKey(),
  killSwitchEnabled: boolean("kill_switch_enabled").default(false).notNull(),
  killSwitchReason: text("kill_switch_reason"),
  killSwitchToggledAt: timestamp("kill_switch_toggled_at", { withTimezone: true }),
  killSwitchToggledByEmail: text("kill_switch_toggled_by_email"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ExternalApiSettings = typeof externalApiSettingsTable.$inferSelect;

// Append-only audit log for every authenticated external API call.
// Read endpoints are also logged so we have a complete picture of what
// the partner agent has been looking at, but write endpoints capture
// before/after state so a grant or revoke can always be reversed and
// reconstructed. The log is the only source of truth for "what did
// Viktor do for customer X" investigations.
export const externalApiAuditLogTable = pgTable(
  "external_api_audit_log",
  {
    id: serial("id").primaryKey(),
    // null when the request failed auth (no key matched); otherwise the
    // id of the externalApiKeys row that authenticated.
    keyId: integer("key_id"),
    // mirror keyId fields here so the log row is still readable after a
    // key is revoked + the admin renames it.
    keyName: text("key_name"),
    keyLast4: text("key_last4"),
    // request shape
    method: text("method").notNull(),
    path: text("path").notNull(),
    action: text("action").notNull(), // e.g. "user.grant", "user.lookup"
    targetEmail: text("target_email"),
    requestBody: jsonb("request_body"),
    // for write endpoints, snapshot of the relevant DB state.
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    // operator-supplied audit reason (passed in the request body for
    // every write endpoint). Surfaced verbatim in the admin log viewer.
    reason: text("reason"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    statusCode: integer("status_code").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    keyIdIdx: index("external_api_audit_log_key_id_idx").on(t.keyId),
    targetEmailIdx: index("external_api_audit_log_target_email_idx").on(t.targetEmail),
    actionIdx: index("external_api_audit_log_action_idx").on(t.action),
    createdAtIdx: index("external_api_audit_log_created_at_idx").on(t.createdAt),
  }),
);

export type ExternalApiAuditLog = typeof externalApiAuditLogTable.$inferSelect;
export type InsertExternalApiAuditLog = typeof externalApiAuditLogTable.$inferInsert;
