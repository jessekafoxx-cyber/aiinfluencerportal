-- Task #134: rebuild Ad Research Board pipeline so cached media never disappears.
--
-- Adds three columns the new non-destructive sync needs:
--   * hidden_from_sheet — true when a row was previously seen in the Google
--     Sheet but is now absent. Hidden rows stay in the DB (and their cached
--     media stays in object storage); they are excluded from the user view
--     but still visible to admins, who can unhide them. This is what makes
--     the sync non-destructive.
--   * url_kind — classification of the ad link (instagram-post,
--     instagram-reel, facebook-post, facebook-reel, facebook-share-redirect,
--     direct-image, direct-video, unknown) so the admin can see which
--     download strategy a row will take.
--   * resolved_url — canonical URL after resolving Facebook /share/r|p|v
--     redirect tokens, cached on the row so retries don't re-resolve.
--
-- All idempotent — safe to re-run.

ALTER TABLE ad_research_board_items
  ADD COLUMN IF NOT EXISTS hidden_from_sheet boolean NOT NULL DEFAULT false;

ALTER TABLE ad_research_board_items
  ADD COLUMN IF NOT EXISTS url_kind text;

ALTER TABLE ad_research_board_items
  ADD COLUMN IF NOT EXISTS resolved_url text;

CREATE INDEX IF NOT EXISTS ad_research_board_items_hidden_from_sheet_idx
  ON ad_research_board_items (hidden_from_sheet);
