-- T396: Randomise background music order and add searchable track codes.
--
-- Adds a short, unique, human-readable code (e.g. "BGM-A7K3X2") to
-- every Background Reel Music track so a user can search the library
-- and find the same track again later. Codes use a 32-char alphabet
-- that excludes ambiguous glyphs (0/O/1/I) so they're easy to read
-- and dictate. New rows generate their code in app code; this
-- migration also backfills every existing row, then locks the column
-- NOT NULL.
--
-- Contains an UPDATE block, so per the replit.md gotcha this MUST be
-- applied via the migration runner or executed directly as SQL -
-- `drizzle-kit push` will silently skip the backfill.

ALTER TABLE "dfy_background_tracks"
  ADD COLUMN IF NOT EXISTS "track_code" text;

CREATE UNIQUE INDEX IF NOT EXISTS "dfy_background_tracks_code_uq"
  ON "dfy_background_tracks" ("track_code");

DO $$
DECLARE
  r RECORD;
  candidate text;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
  inserted boolean;
BEGIN
  FOR r IN SELECT id FROM dfy_background_tracks WHERE track_code IS NULL LOOP
    inserted := false;
    WHILE NOT inserted LOOP
      candidate := 'BGM-';
      FOR i IN 1..6 LOOP
        candidate := candidate || substr(alphabet, 1 + floor(random() * 32)::int, 1);
      END LOOP;
      BEGIN
        UPDATE dfy_background_tracks SET track_code = candidate WHERE id = r.id;
        inserted := true;
      EXCEPTION WHEN unique_violation THEN
        -- collision; loop and try a fresh candidate
      END;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE "dfy_background_tracks"
  ALTER COLUMN "track_code" SET NOT NULL;
