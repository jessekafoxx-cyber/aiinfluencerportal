-- Task #796: team-member roles + granular permissions.
-- Additive, publish-safe ADD COLUMN. No backfill: app tolerates NULL as
-- "no capabilities" for team members, and admins implicitly hold all.
ALTER TABLE "portal_users" ADD COLUMN IF NOT EXISTS "team_role" text;
ALTER TABLE "portal_users" ADD COLUMN IF NOT EXISTS "permissions" jsonb;
ALTER TABLE "invites" ADD COLUMN IF NOT EXISTS "team_role" text;
ALTER TABLE "invites" ADD COLUMN IF NOT EXISTS "permissions" jsonb;
