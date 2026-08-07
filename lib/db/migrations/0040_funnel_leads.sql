CREATE TABLE IF NOT EXISTS "funnel_leads" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "country" text,
  "affiliate_code" text,
  "source_page" text,
  "referrer" text,
  "client_ip_address" text,
  "client_user_agent" text,
  "order_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "funnel_leads_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "funnel_leads_created_at_idx" ON "funnel_leads" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "funnel_leads_order_id_idx" ON "funnel_leads" ("order_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "funnel_leads"
    ADD CONSTRAINT "funnel_leads_order_id_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "phone" text;
