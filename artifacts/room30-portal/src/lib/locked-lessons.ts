// Single source of truth for which lesson slugs are locked / "coming soon"
// for regular users. Admins can still open them so they can edit / preview.
//
// Used by:
//   - operating-system.tsx (greys out the row in the lesson list)
//   - course-player.tsx (blocks the lesson page itself, and skips locked
//     lessons when navigating with the prev/next arrows)
//
// Add or remove a slug here to lock or unlock it everywhere at once.
export const LOCKED_LESSON_SLUGS: ReadonlySet<string> = new Set<string>([
  "ig-tiktok-story-sequence",
  "whatsapp-remarketing",
  "sunday-story-pitch",
  // Phase 5 ads intro - video still being recorded.
  "r30-p5-mindset-behind-ads",
  // Phase 4 content lessons from Selfie Yapping onwards - still being recorded.
  // Admins can still click through to edit/preview (the lock badge stays
  // visible but the row is clickable for admins, see operating-system.tsx).
  "r30-p4-creating-selfie-yapping-clips",
  "r30-p4-creating-viral-slideshows",
  "r30-p4-creating-viral-carousels",
  "r30-p4-creating-overlay-clips",
  "r30-p4-creating-fastmotion-clips",
  // Phase 5 advertorial lessons - still being recorded.
  "r30-p5-creating-advertorial-pages",
  "r30-p5-creating-advertorial-ads",
  "r30-p5-why-advertorial-ads-crush-it",
]);

export function isLessonLocked(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return LOCKED_LESSON_SLUGS.has(slug);
}
