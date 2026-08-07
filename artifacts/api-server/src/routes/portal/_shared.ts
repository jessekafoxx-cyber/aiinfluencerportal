// Shared helpers for portal.ts and (future) per-feature route files split
// out of routes/portal.ts. Keep this file dependency-light and side-effect
// free: anything imported here is loaded by every portal route group, so
// adding heavy modules here will leak into the API boot cost.

/**
 * Recover legacy / stripped-prefix Room30 lesson slugs.
 *
 * Every Room30 lesson row is stored with an `r30-` prefix
 * (`r30-p2-bridge-page-build`, `r30-p1-intro`, ...). Old shared links and
 * bookmarks occasionally land here with the leading `r` chopped off
 * (`30-p2-bridge-page-build`), which used to resolve to a 404 / 502 dead-end
 * on the lesson page. When we are inside the room30 portal and the slug
 * starts with a bare `30-`, transparently re-add the `r` so the lookup
 * succeeds. Outside of the room30 portal we leave the slug untouched so the
 * strict per-portal scoping is not weakened.
 */
export function resolveRoom30LessonSlug(slug: string, portalKey: string): string {
  if (portalKey === "room30" && /^30-/.test(slug)) {
    return `r${slug}`;
  }
  return slug;
}

/** Best-effort client IP extraction for access-log rows. */
export function getIp(req: any): string {
  return (
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.ip ||
    "unknown"
  );
}

/** HTML-escape a string for safe interpolation into transactional email HTML. */
export function escapeHtmlSafe(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
