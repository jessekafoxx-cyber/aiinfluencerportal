-- T406: Add portal_key to portal_users so we can scope every admin
-- endpoint by the portal the user actually belongs to (course-portal
-- "main" vs Room30 "room30"). Backfill existing rows by looking at
-- which portal's lessons the user has actually progressed through;
-- everyone else stays on the safe default ("main"). Then forcibly
-- clear any prebuilt brain selection on Room30 users so the OS tools
-- can never accidentally pull the AI-Influencer-Portfolio brain into
-- a Room30 generation (Room30 is a separate product from Apex
-- Offers / Prompt and Build, with no curated brain catalogue).
--
-- This migration contains UPDATE blocks; per replit.md it must be
-- applied via the migration runner (or directly via psql), not via
-- drizzle-kit push, which silently skips data-mutating statements.

ALTER TABLE "portal_users"
  ADD COLUMN IF NOT EXISTS "portal_key" text NOT NULL DEFAULT 'main';

-- Backfill: any user with completed lesson progress on a Room30
-- lesson is a Room30 user. (Room30 lessons are scoped via
-- lessons.portal_key = 'room30'.)
UPDATE "portal_users" pu
SET "portal_key" = 'room30'
WHERE pu."portal_key" = 'main'
  AND EXISTS (
    SELECT 1
    FROM "lesson_progress" lp
    JOIN "lessons" l ON l.id = lp.lesson_id
    WHERE lp.user_id = pu.id
      AND l."portal_key" = 'room30'
  );

-- Backfill: anyone whose email signed up for the Room30 notify list
-- but never touched a course lesson is also a Room30 user.
UPDATE "portal_users" pu
SET "portal_key" = 'room30'
WHERE pu."portal_key" = 'main'
  AND EXISTS (
    SELECT 1 FROM "room30_notify_signups" rns
    WHERE lower(rns.email) = lower(pu.email)
  );

-- Backfill: anyone whose email submitted the Room30 contact form is
-- also a Room30 user. Catches inquirers who never opted into the
-- notify list and never started a lesson but still have a portal
-- account from a prior touchpoint.
UPDATE "portal_users" pu
SET "portal_key" = 'room30'
WHERE pu."portal_key" = 'main'
  AND EXISTS (
    SELECT 1 FROM "room30_contact_submissions" rcs
    WHERE lower(rcs.email) = lower(pu.email)
  );

-- Force every Room30 user back to "own" brain mode and drop any
-- selected prebuilt brain id. The Room30 frontend no longer exposes
-- the picker, so any persisted prebuilt selection (incl. greg's) is
-- dead state that could otherwise leak the curated AI Influencer
-- Portfolio brain into Room30 OS-tool generations.
UPDATE "user_brain_profiles" ubp
SET "brain_mode" = 'own',
    "selected_prebuilt_brain_id" = NULL,
    "updated_at" = now()
WHERE ubp.user_id IN (
  SELECT id FROM "portal_users" WHERE "portal_key" = 'room30'
)
AND (ubp."brain_mode" = 'prebuilt' OR ubp."selected_prebuilt_brain_id" IS NOT NULL);

-- Belt-and-braces: explicitly clear greg@cookemedia.io's brain
-- profile in case the email is on a row we mis-classified above.
-- Greg is admin in both portals; he should never have a prebuilt
-- selection persisted because he is the source of the curated brains.
UPDATE "user_brain_profiles" ubp
SET "brain_mode" = 'own',
    "selected_prebuilt_brain_id" = NULL,
    "updated_at" = now()
WHERE ubp.user_id IN (
  SELECT id FROM "portal_users" WHERE lower(email) = 'greg@cookemedia.io'
)
AND (ubp."brain_mode" = 'prebuilt' OR ubp."selected_prebuilt_brain_id" IS NOT NULL);
