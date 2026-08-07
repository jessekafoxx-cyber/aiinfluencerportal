-- Task #774: durable, append-only log of affiliate tax-form submission
-- attempts (POST /portal/my-links/tax-form). Failed attempts (the recurring
-- invalid_form_type class) were previously only visible in request logs,
-- which the worker-hosted daily health audit cannot read. The daily
-- health-check counts recent rows here to surface a spike in W-9 / W-8BEN
-- rejections to admins. ADD TABLE only - publish-safe.
CREATE TABLE IF NOT EXISTS "affiliate_tax_form_attempts" (
  "id" serial PRIMARY KEY NOT NULL,
  "portal_user_id" integer,
  "form_type" text,
  "ok" boolean NOT NULL,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "affiliate_tax_form_attempts_created_at_idx" ON "affiliate_tax_form_attempts" ("created_at");
CREATE INDEX IF NOT EXISTS "affiliate_tax_form_attempts_ok_idx" ON "affiliate_tax_form_attempts" ("ok");
