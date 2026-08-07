-- Task #710: Super-admin "view as user" impersonation session ledger.
-- One row per start/stop pair; `ended_at IS NULL` means the session is
-- still considered open server-side. Token verification cross-checks
-- this row so a revoked or expired session cannot be replayed.
CREATE TABLE IF NOT EXISTS admin_impersonation_sessions (
  id serial PRIMARY KEY,
  admin_clerk_id text NOT NULL,
  admin_email text,
  target_portal_user_id integer NOT NULL,
  target_email text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_reason text,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_impersonation_sessions_admin_open_idx
  ON admin_impersonation_sessions (admin_clerk_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS admin_impersonation_sessions_started_at_idx
  ON admin_impersonation_sessions (started_at DESC);
