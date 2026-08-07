-- Task #20: delete the carried-over customer account that the old
-- seed:room30-admin post-merge step kept recreating. The seed step has been
-- removed from scripts/post-merge.sh and the script now refuses to run
-- without an explicit email argument, so this is a one-time cleanup of the
-- rows it left behind. Pure data DELETEs - idempotent and publish-safe.
DELETE FROM "portal_users"
WHERE "email" = 'yddecasas21@gmail.com' AND "portal_key" = 'room30';

DELETE FROM "orders"
WHERE "id" = 'room30-admin-grant-0cb82278b15d2d87';
