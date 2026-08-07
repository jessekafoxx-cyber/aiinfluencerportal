// Pure timezone math for the evergreen webinar (Tasks #797 / #805).
//
// These helpers carry NO database dependency so the webinar scheduling
// predicates that build on them can be unit-tested without a live
// DATABASE_URL. `webinar.ts` re-exports `ymdInZone` / `zonedWallClockToUtc`
// for its existing callers.

// Offset (tz - utc) in ms at a given instant, via Intl. Positive means
// the zone is ahead of UTC.
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - date.getTime();
}

// Convert a wall-clock local time in `timeZone` to the absolute UTC
// instant. One correction pass handles DST correctly for our use.
export function zonedWallClockToUtc(
  year: number,
  month1: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month1 - 1, day, hour, minute, 0);
  const offset = tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

// The Y/M/D of `instant` as seen in `timeZone`.
export function ymdInZone(
  instant: Date,
  timeZone: string,
): { year: number; month1: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month1: Number(map.month),
    day: Number(map.day),
  };
}
