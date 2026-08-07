#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Task #548: apply data-backfill migrations that `drizzle-kit push` silently
# skips (any migration containing UPDATE/DELETE/data-DML blocks - see the
# replit.md gotcha). Idempotent: every statement uses IF NOT EXISTS or
# equivalent guards, so re-running across publishes is safe. Without this
# step, the schema-drift check below would fail on any environment where
# these migrations haven't been hand-applied (which is exactly the bug
# Task #548 just fixed in dev, and the same class as Task #512).
pnpm --filter @workspace/scripts run apply:data-migrations

# Task #498: surface schema drift (columns/tables defined in
# `lib/db/src/schema/` but missing from the connected DB) right after
# `db push`. Hard-fails on drift by default so a publish that would
# leave prod with a missing column/table aborts before users see a
# 500. Set SCHEMA_DRIFT_NONFATAL=1 to downgrade to a warning (only
# appropriate for local/dev DBs that legitimately carry pre-existing
# drift from data-loss-protected migrations the runner cannot apply
# unattended). The boot-time DFY content health check
# (artifacts/api-server/src/lib/dfy-content-health.ts) and the
# ensureDfySchemaApplied boot hook are second-line guards.
if [ "${SCHEMA_DRIFT_NONFATAL:-0}" = "1" ]; then
  pnpm --filter @workspace/scripts run check:schema-drift \
    || echo "WARN: schema drift detected (SCHEMA_DRIFT_NONFATAL=1); review check:schema-drift output above"
else
  pnpm --filter @workspace/scripts run check:schema-drift
fi
# Task #460 recovery: re-send fresh room30.ai links to the 178 buyers whose
# original purchase_account_created/_existing emails went out with a
# *.replit.dev CTA host (broken). The script revokes the matching pending
# Clerk invitation and re-issues a clean one with redirect_url=room30.ai.
# Idempotent via metadata.replacedByTask460 - safe to leave in post-merge
# across publishes. Bounded to the known bad batch window so it cannot
# accidentally replay an unrelated future incident. PUBLIC_APP_URL must be
# https://room30.ai in this environment (it is).
SENT_AFTER=2026-05-14T22:19:00Z \
SENT_BEFORE=2026-05-14T22:44:00Z \
APPLY=1 \
pnpm --filter @workspace/scripts run resend:broken-account-emails
