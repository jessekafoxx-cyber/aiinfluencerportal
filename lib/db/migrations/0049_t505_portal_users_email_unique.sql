-- Task #505: Collapse duplicate portal_users rows by lower(email) and add
-- a unique index on lower(email) so the duplicate insert path that
-- created Cassie's id-65 + id-132 pair (CSV-grant ghost + Clerk first-
-- signin row) can never re-occur at the database level.
--
-- Strategy per duplicate group (case-insensitive email):
--   1. Pick the "winner" row: prefer is_a_list = true, then the oldest
--      created_at, then the smallest id (stable tiebreaker). This keeps
--      the row that already carries the A-List grant + history.
--   2. Hoist clerk_id, whop_user_id, order_id, stripe_customer_id, and
--      stripe_default_payment_method_id from any loser onto the winner
--      when the winner is missing them, so the first-signin Clerk row's
--      identifiers survive the merge.
--   3. Repoint every integer user_id column in every public table
--      (access_logs, email_logs, research jobs, etc) from loser ids to
--      the winner id, dynamically over information_schema, so we don't
--      have to enumerate every soft-FK table.
--   4. Delete losers.
--   5. CREATE UNIQUE INDEX ON portal_users (lower(email)) so future
--      duplicate inserts fail loudly instead of silently producing
--      cross-portal/clerk-bind drift.
--
-- IMPORTANT: this migration contains UPDATE/DELETE blocks (data
-- backfill) and MUST be applied via the migration runner, not
-- `drizzle-kit push`. See the replit.md gotcha "Migrations with UPDATE
-- blocks must run via the migration runner, not push".

DO $$
DECLARE
  grp RECORD;
  winner_id INT;
  loser_ids INT[];
  col RECORD;
  loser_clerk TEXT;
  loser_whop TEXT;
  loser_order TEXT;
  loser_stripe_cust TEXT;
  loser_stripe_pm TEXT;
  loser_a_list BOOLEAN;
  loser_a_list_joined TIMESTAMPTZ;
BEGIN
  FOR grp IN
    SELECT lower(email) AS lemail
      FROM portal_users
     GROUP BY lower(email)
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO winner_id
      FROM portal_users
     WHERE lower(email) = grp.lemail
     ORDER BY (is_a_list IS TRUE) DESC,
              created_at ASC NULLS LAST,
              id ASC
     LIMIT 1;

    SELECT array_agg(id) INTO loser_ids
      FROM portal_users
     WHERE lower(email) = grp.lemail AND id <> winner_id;

    SELECT clerk_id, whop_user_id, order_id,
           stripe_customer_id, stripe_default_payment_method_id
      INTO loser_clerk, loser_whop, loser_order,
           loser_stripe_cust, loser_stripe_pm
      FROM portal_users
     WHERE id = ANY(loser_ids) AND clerk_id IS NOT NULL
     ORDER BY last_login_at DESC NULLS LAST, id DESC
     LIMIT 1;

    -- Hoist a_list grant only if some loser already had it. We do NOT
    -- force is_a_list=true or set a default a_list_joined_at -- if no
    -- row in the group was on the A-List before the merge, none of
    -- them should be after.
    SELECT is_a_list, a_list_joined_at
      INTO loser_a_list, loser_a_list_joined
      FROM portal_users
     WHERE id = ANY(loser_ids) AND is_a_list IS TRUE
     ORDER BY a_list_joined_at ASC NULLS LAST, id ASC
     LIMIT 1;

    -- Null out clerk_id on losers BEFORE hoisting it to the winner.
    -- We captured loser_clerk into a PL/pgSQL variable above, so we
    -- can safely clear it on the loser row before applying it to the
    -- winner row; otherwise the UPDATE below would briefly hold the
    -- same clerk_id on two rows and trip the unique constraint.
    UPDATE portal_users SET clerk_id = NULL WHERE id = ANY(loser_ids);

    -- Preserve the winner's existing is_active/role/portal_key state.
    -- We only hoist the integration ids (clerk/whop/order/stripe) and
    -- the a_list flag from losers when the winner is missing them.
    -- This avoids the broken-access-control footgun of unconditionally
    -- activating previously-inactive accounts during the dedupe.
    UPDATE portal_users
       SET clerk_id = COALESCE(clerk_id, loser_clerk),
           whop_user_id = COALESCE(whop_user_id, loser_whop),
           order_id = COALESCE(order_id, loser_order),
           stripe_customer_id = COALESCE(stripe_customer_id, loser_stripe_cust),
           stripe_default_payment_method_id = COALESCE(stripe_default_payment_method_id, loser_stripe_pm),
           is_a_list = COALESCE(NULLIF(is_a_list, FALSE), loser_a_list, is_a_list),
           a_list_joined_at = COALESCE(a_list_joined_at, loser_a_list_joined),
           updated_at = now()
     WHERE id = winner_id;

    -- Repoint every integer user_id column in every public table from
    -- loser ids to the winner id. Skips portal_users itself.
    FOR col IN
      SELECT table_schema, table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name = 'user_id'
         AND data_type = 'integer'
         AND table_name <> 'portal_users'
    LOOP
      EXECUTE format(
        'UPDATE %I.%I SET %I = $1 WHERE %I = ANY($2)',
        col.table_schema, col.table_name, col.column_name, col.column_name
      ) USING winner_id, loser_ids;
    END LOOP;

    DELETE FROM portal_users WHERE id = ANY(loser_ids);
  END LOOP;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS portal_users_lower_email_uq
  ON portal_users (lower(email));
