-- Per-user dismiss timestamp for the "A quick note from Greg" portal notice
-- (Task #572 follow-on). When non-NULL, the FounderNoticeCard is suppressed
-- for that user across every device and browser. Mirrors the
-- ai_overlimit_dismissed_at pattern.
ALTER TABLE portal_users
  ADD COLUMN IF NOT EXISTS founder_notice_dismissed_at timestamp;
