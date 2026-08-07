import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// Task #774: durable, append-only record of every affiliate tax-form
// submission attempt (POST /portal/my-links/tax-form). Successful
// submissions already land in `affiliate_tax_forms`, but FAILED attempts
// (the recurring `invalid_form_type` class, missing body, encryption
// unavailable, etc.) were previously only visible in request logs, which
// the worker-hosted daily health audit cannot read. This table is the
// durable signal the audit counts so a spike in W-8BEN / W-9 rejections
// surfaces to admins instead of silently blocking payouts.
//
// Recorder is fire-and-forget and non-throwing so a recording failure can
// never fail a tax-form submission. `portalUserId` is nullable because a
// few rejection paths (e.g. missing_body) may not have a resolved user,
// though in practice auth runs first.
export const affiliateTaxFormAttemptsTable = pgTable(
  "affiliate_tax_form_attempts",
  {
    id: serial("id").primaryKey(),
    portalUserId: integer("portal_user_id"),
    // Normalized form type as received (lowercased, hyphens stripped).
    // May be empty string when the client sent nothing parseable.
    formType: text("form_type"),
    ok: boolean("ok").notNull(),
    // Rejection reason when ok=false (e.g. invalid_form_type,
    // missing_body, form_data_required, signature_required,
    // tax_form_encryption_unavailable). Null on success.
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    createdAtIdx: index("affiliate_tax_form_attempts_created_at_idx").on(
      t.createdAt,
    ),
    okIdx: index("affiliate_tax_form_attempts_ok_idx").on(t.ok),
  }),
);

export type AffiliateTaxFormAttempt =
  typeof affiliateTaxFormAttemptsTable.$inferSelect;
export type NewAffiliateTaxFormAttempt =
  typeof affiliateTaxFormAttemptsTable.$inferInsert;
