import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { portalUsersTable } from "./portal";

// Tax compliance forms for affiliates (W-9 for US residents, W-8BEN for
// non-US). Required before payouts can be processed. Stored as
// jsonb because the two form types have completely different field
// shapes - we do not need to query into the payload, only return it to
// the IRS at year-end. The portal UI never reads `formData` back; it
// only reads metadata (form type + submittedAt) so a re-submit can show
// "on file since X".
export const AFFILIATE_TAX_FORM_TYPES = ["w9", "w8ben"] as const;
export type AffiliateTaxFormType = (typeof AFFILIATE_TAX_FORM_TYPES)[number];

export const affiliateTaxFormsTable = pgTable(
  "affiliate_tax_forms",
  {
    id: serial("id").primaryKey(),
    portalUserId: integer("portal_user_id")
      .notNull()
      .references(() => portalUsersTable.id, { onDelete: "cascade" }),
    formType: text("form_type").notNull(),
    // Legacy plaintext column. Kept nullable so historical rows (if any)
    // remain readable; all new writes go to `formDataEncrypted` and leave
    // this NULL. Reader path prefers the encrypted column when present.
    formData: jsonb("form_data"),
    // AES-256-GCM envelope of the W-9 / W-8BEN payload, serialized as
    // JSON: {alg, iv, ciphertext, authTag}. See
    // artifacts/api-server/src/lib/affiliate-tax-form-crypto.ts.
    formDataEncrypted: text("form_data_encrypted"),
    electronicSignature: text("electronic_signature").notNull(),
    submittedAt: timestamp("submitted_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => ({
    portalUserIdx: index("affiliate_tax_forms_user_idx").on(t.portalUserId),
    submittedAtIdx: index("affiliate_tax_forms_submitted_at_idx").on(t.submittedAt),
  }),
);

export type AffiliateTaxForm = typeof affiliateTaxFormsTable.$inferSelect;
export type NewAffiliateTaxForm = typeof affiliateTaxFormsTable.$inferInsert;
