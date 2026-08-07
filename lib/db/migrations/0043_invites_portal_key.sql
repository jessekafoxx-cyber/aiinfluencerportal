-- Task: Permanent fix for cross-portal invite leak.
--
-- Symptom: An admin inviting a team member from the Room30 AI portal
-- received an Apex Offers branded email that linked to /portal/sign-up
-- (the Apex/course-portal sign-up). Once the invitee signed up they
-- landed in the Apex Offers dashboard instead of the Room30 portal.
--
-- Root cause: the `invites` table had no notion of which portal an
-- invite belonged to, so:
--   * /portal/admin/invites always built a `/portal/sign-up` link on
--     the Apex domain regardless of the inviting admin's portal.
--   * /portal/enroll claimed the most-recent unclaimed invite for the
--     email regardless of which portal the user actually signed up on.
--
-- This migration adds the column and backfills existing rows to "main"
-- (Apex/course-portal) so legacy invites continue to behave the same.
-- The application code already knows how to read X-Portal-Key on the
-- inviting admin's request and stamp the column going forward.

ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS portal_key text NOT NULL DEFAULT 'main';

-- Existing unclaimed invites have no recorded portal. They were sent
-- before the multi-portal split and pointed at /portal/sign-up, so
-- "main" is the historically correct default.
UPDATE invites
SET portal_key = 'main'
WHERE portal_key IS NULL OR portal_key = '';

CREATE INDEX IF NOT EXISTS invites_email_portal_key_idx
  ON invites (email, portal_key);
