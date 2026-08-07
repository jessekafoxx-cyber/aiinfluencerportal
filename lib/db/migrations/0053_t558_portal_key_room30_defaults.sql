-- Task #558: Fix "account does not belong to this portal" 403 on every
-- legacy Room30 buyer. The project went single-tenant in Task #491 -
-- only portal_key='room30' is in use - but several portal_key-bearing
-- tables in lib/db/src/schema/portal.ts still defaulted to 'main' and
-- still carried 'main' rows. Migration 0048 already handled
-- portal_users, but coursePhases / lessons / invites were left behind
-- and any newly inserted row (or any legacy 'main' row that wasn't
-- backfilled at the time) keeps tripping the cross-portal denial in
-- requireAuth.
--
-- This migration:
--   1. Backfills every remaining portal_key='main' (or any non-room30)
--      row in portal_users, course_phases, lessons, and invites to
--      'room30'.
--   2. Sets the column default to 'room30' on those tables so new
--      inserts can't recreate the drift.
--
-- IMPORTANT: contains UPDATE blocks (data backfill) and MUST be applied
-- via the migration runner, not `drizzle-kit push`. See the replit.md
-- gotcha "Production schema changes belong to the Publish flow; data
-- backfills are separate" - drizzle-kit push silently skips UPDATE
-- statements, which is the same trap that hit Task #200 / #432 / #512.

UPDATE "portal_users"  SET "portal_key" = 'room30' WHERE "portal_key" <> 'room30';
UPDATE "course_phases" SET "portal_key" = 'room30' WHERE "portal_key" <> 'room30';
UPDATE "lessons"       SET "portal_key" = 'room30' WHERE "portal_key" <> 'room30';
UPDATE "invites"       SET "portal_key" = 'room30' WHERE "portal_key" <> 'room30';

ALTER TABLE "portal_users"  ALTER COLUMN "portal_key" SET DEFAULT 'room30';
ALTER TABLE "course_phases" ALTER COLUMN "portal_key" SET DEFAULT 'room30';
ALTER TABLE "lessons"       ALTER COLUMN "portal_key" SET DEFAULT 'room30';
ALTER TABLE "invites"       ALTER COLUMN "portal_key" SET DEFAULT 'room30';
