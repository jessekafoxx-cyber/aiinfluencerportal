-- T402: Sheet sync support for the DFY bridge pages catalog.
--
-- Adds three nullable columns so the weekly importer can upsert rows
-- pulled from Greg's Google Sheet without disturbing manually-curated
-- entries:
--   * bonus_number    - integer parsed from the sheet ("Bonus Template N")
--                        and rendered as a "Bonus #N" pill in the UI.
--   * source          - "sheet" for sheet-sourced rows, "manual" for
--                        admin-added rows. Manual rows are never
--                        touched by the importer.
--   * source_row_key  - stable identity from the sheet (we use the
--                        normalised template URL). The importer upserts
--                        on (source, source_row_key).
--
-- All columns are nullable / defaulted, so no data backfill is needed
-- and `drizzle-kit push` would apply this cleanly. We still register it
-- as a numbered migration for parity with the other 004x migrations.

ALTER TABLE "dfy_bridge_pages"
  ADD COLUMN IF NOT EXISTS "bonus_number" integer,
  ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "source_row_key" text;

CREATE UNIQUE INDEX IF NOT EXISTS "dfy_bridge_pages_source_key_uq"
  ON "dfy_bridge_pages" ("source", "source_row_key")
  WHERE "source_row_key" IS NOT NULL;
