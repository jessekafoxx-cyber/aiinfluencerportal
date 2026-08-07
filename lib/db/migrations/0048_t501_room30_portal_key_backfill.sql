-- Task #501: Fix Room30 cross-portal 403 on AI Influencer.
--
-- 46 production portal_users rows landed with portal_key='main' because
-- ensurePortalUserByEmail() in external-api.ts inserted without an explicit
-- portalKey and the historical column default was 'main'. After Task #491
-- removed the Apex/course-portal frontend, 'main' is no longer a valid
-- portal value and any such row trips the cross-portal denial branch in
-- requireAuth when the buyer signs into Room30 (HTTP 403).
--
-- This migration:
--   1. Re-asserts the column default as 'room30' (idempotent; the original
--      flip shipped in 0047_t491_remove_apex.sql but is repeated here so
--      this migration is self-contained and safe to apply on databases
--      that never ran 0047's UPDATE block).
--   2. Backfills every remaining portal_key='main' row to 'room30'.
--
-- IMPORTANT: this migration contains an UPDATE block (data backfill) and
-- MUST be applied via the migration runner, not `drizzle-kit push`. See
-- the replit.md gotcha "Migrations with UPDATE blocks must run via the
-- migration runner, not push" - drizzle-kit push silently skips UPDATE
-- statements and would leave the bug unfixed in production.

ALTER TABLE "portal_users" ALTER COLUMN "portal_key" SET DEFAULT 'room30';

UPDATE "portal_users"
   SET "portal_key" = 'room30'
 WHERE "portal_key" = 'main';
