-- Task #478: Reconcile the Room30 portal lesson "1.2 The Strategy"
-- (portal_key='room30', slug='r30-p1-strategy') so it points at the
-- canonical Wistia video `gu4s4kx81c`.
--
-- The boot-time installer in
-- artifacts/api-server/src/lib/ensure-room30-lesson-videos.ts only
-- writes when wistia_video_id IS NULL (any non-null value, including
-- the empty-string sentinel an admin writes via PUT
-- /portal/admin/lessons/:slug/wistia, is treated as admin-owned and
-- left alone). This one-shot UPDATE is needed for environments where
-- the row was previously written with a different/empty value and
-- would not be corrected by the installer alone.

UPDATE "lessons"
SET "wistia_video_id" = 'gu4s4kx81c'
WHERE "portal_key" = 'room30'
  AND "slug" = 'r30-p1-strategy'
  AND ("wistia_video_id" IS DISTINCT FROM 'gu4s4kx81c');
