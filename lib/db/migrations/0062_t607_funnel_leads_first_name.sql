-- Task #607 follow-on: capture first name on the raw funnel_leads row.
-- Until now first name flowed only into KIT/WATI custom fields, so any
-- consumer that read funnel_leads directly (CRM ingest, ad-hoc reports)
-- had to join the outbox tables to recover identity. Adding the column
-- here keeps the lead row self-contained.

ALTER TABLE funnel_leads ADD COLUMN IF NOT EXISTS first_name TEXT;
