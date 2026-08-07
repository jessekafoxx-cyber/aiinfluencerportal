// Task #774: shared Wistia media reachability probe.
//
// Used by the workshop-recordings admin create/update endpoints (reject a
// typo'd / non-existent media id before it ships a dead player to every
// Platinum member) and by the daily health-check audit (flag already-
// published recordings whose media became unreachable). Read-only GET
// against the public Wistia media metadata endpoint - no auth, no writes.

export async function isWistiaMediaReachable(
  mediaId: string,
  timeoutMs = 8000,
): Promise<boolean> {
  const id = String(mediaId ?? "").trim();
  if (!id) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://fast.wistia.com/embed/medias/${encodeURIComponent(id)}.json`,
      { signal: controller.signal },
    );
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
