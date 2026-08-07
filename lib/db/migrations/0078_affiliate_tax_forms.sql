-- Affiliate tax compliance forms (W-9 for US, W-8BEN for non-US).
-- Required before payouts can be processed. Stored as jsonb because
-- the two form shapes are entirely different and we never query into
-- the payload - only return it to the IRS at year-end.
--
-- Schema-only delta (no UPDATE). Safe to apply via Publish.

CREATE TABLE IF NOT EXISTS affiliate_tax_forms (
  id                    serial PRIMARY KEY,
  portal_user_id        integer NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  form_type             text NOT NULL CHECK (form_type IN ('w9', 'w8ben')),
  form_data             jsonb NOT NULL,
  electronic_signature  text NOT NULL,
  submitted_at          timestamp NOT NULL DEFAULT now(),
  ip_address            text,
  user_agent            text
);

CREATE INDEX IF NOT EXISTS affiliate_tax_forms_user_idx          ON affiliate_tax_forms (portal_user_id);
CREATE INDEX IF NOT EXISTS affiliate_tax_forms_submitted_at_idx  ON affiliate_tax_forms (submitted_at);
