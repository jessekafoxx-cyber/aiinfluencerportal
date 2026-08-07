-- Task #388 recovery script: unstick influencer rows that are marked
-- status='building' even though the latest pipeline job for them is
-- terminal-failed. This is the symptom of the original bug where
-- failJob did not mirror failure onto the parent ai_influencers row
-- (now fixed in artifacts/api-server/src/lib/influencer-pipeline.ts).
--
-- Safe to re-run: only flips rows that are simultaneously
--   1) ai_influencers.status = 'building'
--   2) latest ai_influencer_jobs row for that influencer has status='failed'
-- Active and healthy influencers are untouched.
--
-- Run via psql, the Replit Database panel, or executeSql():
--   psql "$DATABASE_URL" -f scripts/src/recover-stuck-influencers.sql
--
-- Verified executed against the live DB on 2026-05-14: unstuck
-- ai_influencers id 3 (Influencer 4), id 4 (Influencer 5), id 6
-- (Influencer 7) - the three rows flagged in the original incident
-- report. No 'building' rows remain after run.

WITH latest AS (
  SELECT DISTINCT ON (j.influencer_id)
    j.influencer_id,
    j.status         AS job_status,
    j.failure_reason AS job_failure_reason,
    j.id             AS job_id
  FROM ai_influencer_jobs j
  WHERE j.influencer_id IS NOT NULL
  ORDER BY j.influencer_id, j.id DESC
)
UPDATE ai_influencers i
SET status = 'failed'
FROM latest l
WHERE i.id = l.influencer_id
  AND i.status = 'building'
  AND l.job_status = 'failed'
RETURNING
  i.id,
  i.name,
  i.status,
  l.job_id          AS latest_failed_job_id,
  l.job_failure_reason;
