-- Task #250: Production-harden the AI influencer pipeline.
--
-- Additive-only schema changes for: error taxonomy + persistence,
-- per-scene state tracking, bounded retry counters, webhook
-- idempotency / observability, heartbeat-based stuck-job recovery,
-- and idempotent finalization.
--
-- All ADDs use IF NOT EXISTS so this migration is safe to re-run, and
-- the migration runner (not `drizzle-kit push`) is the canonical way
-- to apply it because of the small backfill UPDATE blocks below
-- (push silently skips UPDATEs - see replit.md "Migrations with
-- UPDATE blocks must run via the migration runner, not push").

ALTER TABLE ai_influencer_jobs
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS last_error_message text,
  ADD COLUMN IF NOT EXISTS last_error_payload jsonb,
  ADD COLUMN IF NOT EXISTS scenes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS retries jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS webhook_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS stage_started_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS finalize_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_sent_at timestamp with time zone;

-- Backfill stage_started_at + heartbeat_at for existing rows so the
-- stuck-job sweeper has a non-NULL baseline to compare against.
UPDATE ai_influencer_jobs
SET stage_started_at = COALESCE(stage_started_at, created_at),
    heartbeat_at = COALESCE(heartbeat_at, updated_at, created_at)
WHERE stage_started_at IS NULL OR heartbeat_at IS NULL;

-- Backfill the per-scene state array from the existing scene_image_urls
-- array so finalization for in-flight jobs sees a populated `scenes`.
-- Each entry becomes a `completed` scene with the recorded URL/label.
UPDATE ai_influencer_jobs
SET scenes = (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'idx', (ord - 1)::int,
        'sceneId', NULL,
        'label', el->>'label',
        'state', 'completed',
        'attempts', 1,
        'imageUrl', el->>'url',
        'lastErrorCode', NULL,
        'lastErrorAt', NULL
      )
      ORDER BY ord
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(scene_image_urls) WITH ORDINALITY AS t(el, ord)
)
WHERE jsonb_typeof(scenes) = 'array'
  AND jsonb_array_length(scenes) = 0
  AND jsonb_typeof(scene_image_urls) = 'array'
  AND jsonb_array_length(scene_image_urls) > 0;

-- Carry the legacy failure_reason into the new structured error column
-- so the diagnostics endpoint shows a normalized code for old failures.
UPDATE ai_influencer_jobs
SET last_error_code = COALESCE(last_error_code, 'LEGACY_FAILURE'),
    last_error_message = COALESCE(last_error_message, failure_reason)
WHERE status = 'failed' AND failure_reason IS NOT NULL AND last_error_code IS NULL;
