-- Envelope-encrypt affiliate tax form PII at rest.
--
-- All new W-9 / W-8BEN submissions write an AES-256-GCM envelope to
-- `form_data_encrypted`. The legacy `form_data` jsonb column is kept
-- nullable so any historical rows (none expected in prod yet) remain
-- readable until they're re-submitted or migrated.

ALTER TABLE "affiliate_tax_forms"
  ADD COLUMN IF NOT EXISTS "form_data_encrypted" text;

ALTER TABLE "affiliate_tax_forms"
  ALTER COLUMN "form_data" DROP NOT NULL;
