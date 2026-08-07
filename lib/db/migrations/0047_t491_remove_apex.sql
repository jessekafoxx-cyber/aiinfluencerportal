-- Task #491: Remove Apex Offers / course-portal / marketing-tool from this
-- monorepo. The frontend artifacts (course-portal, marketing-tool) and the
-- /api/marketing-tool/* routes have been deleted in code; this migration
-- drops the now-orphaned tables and purges the legacy `portal_key='main'`
-- rows that powered the Apex course portal.

-- ---------------------------------------------------------------------------
-- 1. Drop marketing-tool tables (18 total). All consumers have been deleted
--    from the api-server in this same task. Use IF EXISTS so the migration
--    is idempotent across environments.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS "ad_research_ads"        CASCADE;
DROP TABLE IF EXISTS "assets"                 CASCADE;
DROP TABLE IF EXISTS "brain_sources"          CASCADE;
DROP TABLE IF EXISTS "camo_ads"               CASCADE;
DROP TABLE IF EXISTS "competitor_channels"    CASCADE;
DROP TABLE IF EXISTS "competitor_videos"      CASCADE;
DROP TABLE IF EXISTS "copywriting_guidelines" CASCADE;
DROP TABLE IF EXISTS "data_sources"           CASCADE;
DROP TABLE IF EXISTS "editing_styles"         CASCADE;
DROP TABLE IF EXISTS "episodes"               CASCADE;
DROP TABLE IF EXISTS "learned_exemplars"      CASCADE;
DROP TABLE IF EXISTS "mt_conversations"       CASCADE;
DROP TABLE IF EXISTS "mt_messages"            CASCADE;
DROP TABLE IF EXISTS "offers"                 CASCADE;
DROP TABLE IF EXISTS "research_docs"          CASCADE;
DROP TABLE IF EXISTS "script_rewrites"        CASCADE;
DROP TABLE IF EXISTS "short_form_scripts"     CASCADE;
DROP TABLE IF EXISTS "video_projects"         CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Purge legacy course-portal (`portal_key='main'`) rows from the shared
--    multi-tenant tables. Room30 rows (`portal_key='room30'`) are untouched.
--    Order matters: child tables before parents.
-- ---------------------------------------------------------------------------
DELETE FROM "lesson_progress"
 WHERE "lesson_id" IN (
   SELECT "lessons"."id" FROM "lessons"
    WHERE "lessons"."portal_key" = 'main'
 );
DELETE FROM "lessons"        WHERE "portal_key" = 'main';
DELETE FROM "course_phases"  WHERE "portal_key" = 'main';
DELETE FROM "portal_users"   WHERE "portal_key" = 'main';

-- ---------------------------------------------------------------------------
-- 3. Flip the `portal_users.portal_key` default from 'main' to 'room30' so
--    any new row inserted without an explicit value lands in the correct
--    portal. Matches the schema change in lib/db/src/schema/portal.ts.
-- ---------------------------------------------------------------------------
ALTER TABLE "portal_users" ALTER COLUMN "portal_key" SET DEFAULT 'room30';
