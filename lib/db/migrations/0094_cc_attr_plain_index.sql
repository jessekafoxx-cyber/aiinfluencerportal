-- Replace the COALESCE(utm_campaign, '') expression unique index on
-- cc_daily_attribution with a plain (day, channel, utm_campaign) index.
-- The expression index made the publish-time migration generator emit an
-- invalid operator class (date_ops on the text channel column), which blocked
-- deploys. utm_campaign becomes NOT NULL DEFAULT '' so the plain index can
-- enforce the same uniqueness without COALESCE.
DROP INDEX IF EXISTS "cc_daily_attr_day_channel_uq";--> statement-breakpoint
UPDATE "cc_daily_attribution" SET "utm_campaign" = '' WHERE "utm_campaign" IS NULL;--> statement-breakpoint
ALTER TABLE "cc_daily_attribution" ALTER COLUMN "utm_campaign" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "cc_daily_attribution" ALTER COLUMN "utm_campaign" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cc_daily_attr_day_channel_uq" ON "cc_daily_attribution" USING btree ("day", "channel", "utm_campaign");
