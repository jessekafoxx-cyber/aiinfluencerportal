-- Task #838: HeyGen-style voice-changer path for the AI Video Studio.
-- Members record/upload audio; ElevenLabs speech-to-speech converts it to the
-- character's chosen ElevenLabs voice; HeyGen lip-syncs to the converted audio.
-- All nullable for publish-safe rollout (a job is "audio mode" when
-- source_audio_url is set). No data backfill required.
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "input_mode" text;
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "sts_voice_id" text;
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "source_audio_url" text;
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "converted_audio_url" text;
