-- Per-domain / tier / category source-mix stats for admin breakdown panel (task #24)
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE research_generation_jobs
  ADD COLUMN IF NOT EXISTS research_stats jsonb;

COMMIT;
