-- Task #659: custom affiliate usernames + /r/<username> vanity links.
--
-- Adds a single nullable column on portal_users that stores the user's
-- chosen affiliate slug (e.g. "alex"). The slug is enforced lower-case
-- + unique via a partial index that ignores NULLs so the vast majority
-- of users who never pick a slug stay un-indexed.
--
-- The slug is purely a redirect-time alias: /r/<slug> resolves to the
-- user's existing FirstPromoter cust_id (typically `portal_user_<id>`)
-- and 302s the visitor to `room30.ai/?fpr=<cust_id>`. We deliberately
-- do NOT change the FirstPromoter cust_id when the slug is set, so
-- legacy `?fpr=portal_user_<id>` links keep working forever.

ALTER TABLE portal_users
  ADD COLUMN IF NOT EXISTS firstpromoter_username TEXT;

-- Case-insensitive unique index (NULLs are allowed; only filled-in
-- slugs must be unique). Lower() guarantees "Alex", "alex" and "ALEX"
-- can never coexist.
CREATE UNIQUE INDEX IF NOT EXISTS portal_users_firstpromoter_username_lower_uq
  ON portal_users (lower(firstpromoter_username))
  WHERE firstpromoter_username IS NOT NULL;
