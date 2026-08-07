-- Task #532: remove the VSL Ad Swipes DFY gallery feature.
-- The Drive folder of source .mp4s only ever contained 1 video, so the
-- 62-tile gallery (61 stills + 1 video) was wholly removed at the user's
-- request. Cascading FK on dfy_template_favourites cleans up favourites.

DELETE FROM dfy_templates WHERE category = 'vsl_swipe';
