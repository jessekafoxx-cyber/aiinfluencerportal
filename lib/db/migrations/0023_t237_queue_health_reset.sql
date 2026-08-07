-- Task #237: queue-health analytics reset.
--
-- Adds a tiny single-row control table the API process writes to when
-- an admin invokes the reset endpoint. The Media Worker process polls
-- this row on every queue-metrics tick. When `reset_requested_at` is
-- newer than `reset_acknowledged_at` the worker zeroes its in-memory
-- provider counters and writes back an acknowledgement.
--
-- Cookie BYTES, board rows, sync sessions, media files, recovered
-- media, dismissed rows, extraction classifications, and recovery
-- metadata are all UNTOUCHED by this reset; only the analytics
-- aggregates owned by `ad_research_board_queue_metrics` and the
-- analytics-only fields on `ad_research_board_sync_status` are
-- cleared.
--
-- Idempotent: safe to re-run via the migration runner.

CREATE TABLE IF NOT EXISTS ad_research_board_queue_metrics_control (
  id integer PRIMARY KEY,
  reset_requested_at_t237 timestamptz,
  reset_acknowledged_at_t237 timestamptz,
  last_reset_actor_t237 text,
  last_reset_dry_run_t237 boolean
);

INSERT INTO ad_research_board_queue_metrics_control (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
