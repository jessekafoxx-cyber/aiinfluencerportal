// Pure selection predicates for webinar scheduling windows.
//
// The window / timezone boundaries are the correctness-critical part of
// webinar timing and are easy to break, so they live here as pure, db-free
// predicates that callers use and that unit tests can exercise directly
// (no live DATABASE_URL required).

import { ymdInZone, zonedWallClockToUtc } from "./webinar-time";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

// Encore track is (re)built for any non-canceled session that ended
// within this lookback. Idempotent per registrant downstream.
export const ENCORE_LOOKBACK_MS = 3 * DAY_MS;

// The 1h-before WhatsApp is due once we are within an hour of the start,
// with a small past-grace so a momentarily-down worker still fires.
export const BEFORE_1H_LEAD_MS = HOUR_MS;
export const BEFORE_1H_PAST_GRACE_MS = 10 * 60 * 1000;

// Hour-of-day (tz wall-clock) the daily summary is allowed to fire.
export const DAILY_SUMMARY_HOUR = 9;

type SessionLike = {
  startsAt: Date;
  videoDurationSeconds: number;
  status: string;
};

// The instant a session's video finishes (start + duration).
export function sessionEnd(
  s: Pick<SessionLike, "startsAt" | "videoDurationSeconds">,
): Date {
  return new Date(s.startsAt.getTime() + s.videoDurationSeconds * 1000);
}

// The configured daily-summary hour (tz wall-clock) on the calendar day
// of `instant`.
export function dailySummaryCutoffOnDayOf(
  instant: Date,
  timeZone: string,
): Date {
  const ymd = ymdInZone(instant, timeZone);
  return zonedWallClockToUtc(
    ymd.year,
    ymd.month1,
    ymd.day,
    DAILY_SUMMARY_HOUR,
    0,
    timeZone,
  );
}

// Whether two instants land on the same calendar day in `timeZone`.
export function sameZonedDay(a: Date, b: Date, timeZone: string): boolean {
  const x = ymdInZone(a, timeZone);
  const y = ymdInZone(b, timeZone);
  return x.year === y.year && x.month1 === y.month1 && x.day === y.day;
}

// Encore eligibility: a non-canceled session whose start is within the
// lookback window AND whose video has actually finished by `now`. A
// session that has not yet ended is excluded so we never build the
// no-show track for people who could still show up.
export function shouldBuildEncore(s: SessionLike, now: Date): boolean {
  if (s.status === "canceled") return false;
  const startMs = s.startsAt.getTime();
  const nowMs = now.getTime();
  if (startMs < nowMs - ENCORE_LOOKBACK_MS) return false; // too old
  if (startMs > nowMs) return false; // hasn't started
  if (now.getTime() < sessionEnd(s).getTime()) return false; // not over yet
  return true;
}

// 1h-before eligibility: non-canceled and `now` sits inside
// [start - 1h, start + past-grace]. Equivalent to
// `now - grace <= start <= now + 1h`.
export function isBefore1hDue(
  s: Pick<SessionLike, "startsAt" | "status">,
  now: Date,
): boolean {
  if (s.status === "canceled") return false;
  const startMs = s.startsAt.getTime();
  const nowMs = now.getTime();
  const dueBefore = nowMs + BEFORE_1H_LEAD_MS;
  const notBefore = nowMs - BEFORE_1H_PAST_GRACE_MS;
  return startMs <= dueBefore && startMs >= notBefore;
}

// Daily-summary eligibility: non-canceled, the session airs on the same
// (tz) calendar day as `now`, and `now` is at/after the summary cutoff.
export function isDailySummaryDue(
  s: Pick<SessionLike, "startsAt" | "status">,
  now: Date,
  timeZone: string,
): boolean {
  if (s.status === "canceled") return false;
  if (!sameZonedDay(s.startsAt, now, timeZone)) return false;
  if (now.getTime() < dailySummaryCutoffOnDayOf(now, timeZone).getTime()) {
    return false; // before the cutoff hour
  }
  return true;
}
