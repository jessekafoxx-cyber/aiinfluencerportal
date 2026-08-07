-- Task #250 round-7: exponential backoff for non-scene retries
-- (Higgsfield dispatch, Enhancor dispatch, finalize, email).
--
-- Per code-review feedback: scene retries already gate on a per-scene
-- nextAttemptAt embedded in the scenes jsonb, but stage-level retries
-- (advanceQueuedJobs / enhancor fallback / finalizeJob / sendEmail)
-- were retrying on every worker tick because no equivalent backoff
-- timestamp existed at the job level. This adds one.
--
-- Set on each retry to (now + exponential backoff with cap). Cleared
-- on successful stage transitions and when a tick claims the job for
-- a fresh attempt. Gates the candidate queries in advanceQueuedJobs
-- and finalizeReadyJobs.
ALTER TABLE ai_influencer_jobs
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS ai_influencer_jobs_next_attempt_at_idx
  ON ai_influencer_jobs (next_attempt_at)
  WHERE next_attempt_at IS NOT NULL;
