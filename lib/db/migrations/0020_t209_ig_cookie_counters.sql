-- Task #209: IG cookie continuity counters. Four new per-snapshot
-- columns on ad_research_board_queue_metrics so the dashboard can
-- distinguish materialize vs attach failures BEFORE the auth-wall
-- escalation wave shows up downstream. Schema-only ALTERs (defaults
-- supplied for the NOT NULL constraint), so this migration is safe
-- to apply via `pnpm db:push`.

ALTER TABLE "ad_research_board_queue_metrics"
  ADD COLUMN IF NOT EXISTS "ig_cookie_materialize_success_t209" integer DEFAULT 0 NOT NULL;
ALTER TABLE "ad_research_board_queue_metrics"
  ADD COLUMN IF NOT EXISTS "ig_cookie_materialize_fail_t209" integer DEFAULT 0 NOT NULL;
ALTER TABLE "ad_research_board_queue_metrics"
  ADD COLUMN IF NOT EXISTS "ig_cookie_attach_success_t209" integer DEFAULT 0 NOT NULL;
ALTER TABLE "ad_research_board_queue_metrics"
  ADD COLUMN IF NOT EXISTS "ig_cookie_attach_fail_t209" integer DEFAULT 0 NOT NULL;
