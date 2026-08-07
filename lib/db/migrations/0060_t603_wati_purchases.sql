-- Task #603: WATI revenue attribution ledger.
--
-- Per-purchase rows that back the WATI custom-attribute push
-- (lifetime_revenue, last_purchase_*, purchase_count). One row per
-- (order_id, slug) so a webhook re-delivery cannot double-count
-- revenue. Refunds set refunded_at + refunded_amount_cents instead of
-- deleting so historical attribution survives. Schema-only - no
-- UPDATE blocks.

CREATE TABLE IF NOT EXISTS "wati_purchases" (
  "order_id" text NOT NULL,
  "slug" text NOT NULL,
  "contact_phone" text NOT NULL,
  "contact_email" text,
  "amount_cents" integer NOT NULL,
  "product_name" text NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "refunded_at" timestamptz,
  "refunded_amount_cents" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("order_id", "slug")
);

CREATE INDEX IF NOT EXISTS "wati_purchases_phone_idx"
  ON "wati_purchases" ("contact_phone");

CREATE INDEX IF NOT EXISTS "wati_purchases_email_idx"
  ON "wati_purchases" ("contact_email");
