-- One-shot idempotency stamp for the #low-ticket Slack summary
-- posted by GET /api/funnel/order/:oid. Set via atomic
-- UPDATE WHERE NULL pattern so refresh + multi-device thank-you
-- visits never double-post. ADD COLUMN only - publish-safe.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS low_ticket_slack_posted_at timestamp;
