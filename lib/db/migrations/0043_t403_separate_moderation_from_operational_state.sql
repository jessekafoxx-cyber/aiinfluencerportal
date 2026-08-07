-- T403: Strip operational-state contamination from admin-dismissed rows.
--
-- The historical /portal/admin/ad-research-board/items/:id/dismiss
-- endpoint wrote a fake terminal failure on every admin dismiss:
--   mediaStatus='failed', mediaError='manually dismissed by admin',
--   mediaErrorClass='dismissed', mediaOutcomeChangedAt=now().
-- That made one moderation action tank Success Rate to 0%, count as a
-- Terminal Fail, and surface in Recent Failures as if the extraction
-- pipeline had broken.
--
-- The endpoint has been rewritten to only set dismissed=true and
-- libraryVisibility='archived'. This migration retroactively cleans up
-- every row that was contaminated by the legacy path so the historical
-- telemetry views agree with the new write semantics.
--
-- Recovery rules per row:
--   * If a healthy GCS object is present (media_object_path IS NOT
--     NULL), restore media_status='ok' - extraction had genuinely
--     succeeded before the admin dismissed it.
--   * Otherwise, restore media_status='pending' - we have no record of
--     a real operational outcome, so don't pretend there was one.
--   * Clear media_error, media_error_class, and media_outcome_changed_at
--     - the moderation action was never an operational event.
--   * Set library_visibility='archived' (idempotent with T402's
--     existing archived rows; the dismiss intent is preserved here).
--   * Keep dismissed=true - the moderation flag itself is correct.

UPDATE ad_research_board_items
SET
  media_status = CASE
    WHEN media_object_path IS NOT NULL THEN 'ok'
    ELSE 'pending'
  END,
  media_error = NULL,
  media_error_class = NULL,
  media_outcome_changed_at_t309 = NULL,
  library_visibility = 'archived',
  updated_at = now()
WHERE
  media_error_class = 'dismissed'
  OR media_error = 'manually dismissed by admin';
