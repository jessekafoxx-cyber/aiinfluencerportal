// Task #805 unit test: webinar follow-up scheduler gating decisions.
//
// Task #802 locked the building blocks (queue builder, atomic claim,
// encore no-show detection, WhatsApp/Slack idempotency) against a live
// Postgres. This file locks the *timing loop's* selection logic - the
// window / timezone boundaries that decide WHEN each piece fires - as
// pure unit tests with no database dependency:
//
//   1. shouldBuildEncore: a not-yet-ended session is excluded; an
//      ended session inside the lookback is included; canceled / too-old
//      / not-yet-started are excluded.
//   2. isBefore1hDue: a session just inside vs just outside the
//      1h-before + past-grace window is included / excluded correctly.
//   3. isDailySummaryDue: respects sameZonedDay and the 9 AM cutoff,
//      verified across a DST boundary in America/New_York.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BEFORE_1H_LEAD_MS,
  BEFORE_1H_PAST_GRACE_MS,
  DAILY_SUMMARY_HOUR,
  ENCORE_LOOKBACK_MS,
  dailySummaryCutoffOnDayOf,
  isBefore1hDue,
  isDailySummaryDue,
  sameZonedDay,
  sessionEnd,
  shouldBuildEncore,
} from "./webinar-scheduling.ts";
import { zonedWallClockToUtc } from "./webinar-time.ts";

const TZ = "America/New_York";
const HOUR = 3_600_000;
const MINUTE = 60_000;

type Session = { startsAt: Date; videoDurationSeconds: number; status: string };

function session(startsAt: Date, opts: Partial<Session> = {}): Session {
  return {
    startsAt,
    videoDurationSeconds: opts.videoDurationSeconds ?? 3600,
    status: opts.status ?? "scheduled",
  };
}

// ---------------------------------------------------------------------------
// 1. shouldBuildEncore - only ended, in-window, non-canceled sessions
// ---------------------------------------------------------------------------

test("shouldBuildEncore excludes a session that has not yet ended", () => {
  const now = new Date("2026-06-04T18:00:00Z");
  // Started 30 min ago, runs 60 min -> ends 30 min from now. Not over.
  const live = session(new Date(now.getTime() - 30 * MINUTE), {
    videoDurationSeconds: 3600,
  });
  assert.equal(now.getTime() < sessionEnd(live).getTime(), true);
  assert.equal(
    shouldBuildEncore(live, now),
    false,
    "a live (not-yet-ended) session must not get the encore track",
  );
});

test("shouldBuildEncore includes a session that just ended", () => {
  const now = new Date("2026-06-04T18:00:00Z");
  // Started 61 min ago, 60 min long -> ended 1 min ago.
  const ended = session(new Date(now.getTime() - 61 * MINUTE), {
    videoDurationSeconds: 3600,
  });
  assert.equal(shouldBuildEncore(ended, now), true);
});

test("shouldBuildEncore is exact at the end boundary", () => {
  const now = new Date("2026-06-04T18:00:00Z");
  // Ends exactly now: now < end is false -> eligible.
  const endsExactlyNow = session(new Date(now.getTime() - 3600 * 1000), {
    videoDurationSeconds: 3600,
  });
  assert.equal(sessionEnd(endsExactlyNow).getTime(), now.getTime());
  assert.equal(shouldBuildEncore(endsExactlyNow, now), true);

  // One second short of ending -> not eligible.
  const oneSecShort = session(new Date(now.getTime() - 3599 * 1000), {
    videoDurationSeconds: 3600,
  });
  assert.equal(shouldBuildEncore(oneSecShort, now), false);
});

test("shouldBuildEncore excludes canceled, too-old, and not-yet-started sessions", () => {
  const now = new Date("2026-06-04T18:00:00Z");
  const ended = session(new Date(now.getTime() - 2 * HOUR));

  assert.equal(
    shouldBuildEncore({ ...ended, status: "canceled" }, now),
    false,
    "canceled sessions never build the encore track",
  );

  const tooOld = session(new Date(now.getTime() - ENCORE_LOOKBACK_MS - HOUR));
  assert.equal(
    shouldBuildEncore(tooOld, now),
    false,
    "sessions older than the lookback fall out of the window",
  );

  const future = session(new Date(now.getTime() + HOUR));
  assert.equal(
    shouldBuildEncore(future, now),
    false,
    "a session that has not started cannot have ended",
  );
});

// ---------------------------------------------------------------------------
// 2. isBefore1hDue - the 1h-before + past-grace window
// ---------------------------------------------------------------------------

test("isBefore1hDue includes a session just inside the 1h lead edge", () => {
  const now = new Date("2026-06-04T18:00:00Z");
  // Start is BEFORE_1H_LEAD_MS - 1s away -> inside (start <= now + 1h).
  const justInside = session(new Date(now.getTime() + BEFORE_1H_LEAD_MS - 1000));
  assert.equal(isBefore1hDue(justInside, now), true);

  // Exactly at the lead edge is still inclusive.
  const atEdge = session(new Date(now.getTime() + BEFORE_1H_LEAD_MS));
  assert.equal(isBefore1hDue(atEdge, now), true);
});

test("isBefore1hDue excludes a session just outside the 1h lead edge", () => {
  const now = new Date("2026-06-04T18:00:00Z");
  // More than an hour out -> not due yet.
  const tooEarly = session(new Date(now.getTime() + BEFORE_1H_LEAD_MS + 1000));
  assert.equal(isBefore1hDue(tooEarly, now), false);
});

test("isBefore1hDue honors the past-grace window edges", () => {
  const now = new Date("2026-06-04T18:00:00Z");
  // Started exactly past-grace ago -> still inside (start >= now - grace).
  const atGraceEdge = session(new Date(now.getTime() - BEFORE_1H_PAST_GRACE_MS));
  assert.equal(isBefore1hDue(atGraceEdge, now), true);

  // Started a second beyond the grace -> dropped.
  const pastGrace = session(
    new Date(now.getTime() - BEFORE_1H_PAST_GRACE_MS - 1000),
  );
  assert.equal(isBefore1hDue(pastGrace, now), false);
});

test("isBefore1hDue excludes canceled sessions inside the window", () => {
  const now = new Date("2026-06-04T18:00:00Z");
  const inWindow = session(new Date(now.getTime() + 30 * MINUTE), {
    status: "canceled",
  });
  assert.equal(isBefore1hDue(inWindow, now), false);
});

// ---------------------------------------------------------------------------
// 3. isDailySummaryDue - sameZonedDay + 9 AM cutoff, DST-aware
// ---------------------------------------------------------------------------

test("dailySummaryCutoffOnDayOf resolves to 9 AM wall-clock in the zone", () => {
  // Summer: EDT (UTC-4) -> 9 AM local == 13:00 UTC.
  const summerNow = new Date("2026-06-04T15:00:00Z"); // 11 AM EDT
  const summerCutoff = dailySummaryCutoffOnDayOf(summerNow, TZ);
  assert.equal(summerCutoff.toISOString(), "2026-06-04T13:00:00.000Z");

  // Winter: EST (UTC-5) -> 9 AM local == 14:00 UTC.
  const winterNow = new Date("2026-01-15T15:00:00Z"); // 10 AM EST
  const winterCutoff = dailySummaryCutoffOnDayOf(winterNow, TZ);
  assert.equal(winterCutoff.toISOString(), "2026-01-15T14:00:00.000Z");
  assert.equal(DAILY_SUMMARY_HOUR, 9);
});

test("isDailySummaryDue is false before 9 AM and true at/after, in EDT", () => {
  // 8:59 AM EDT (12:59 UTC) -> before cutoff.
  const before = new Date("2026-06-04T12:59:00Z");
  const s = session(new Date("2026-06-04T20:00:00Z")); // airs that evening
  assert.equal(
    isDailySummaryDue(s, before, TZ),
    false,
    "before 9 AM local the summary must not fire",
  );

  // 9:00 AM EDT exactly (13:00 UTC) -> due.
  const atNine = new Date("2026-06-04T13:00:00Z");
  assert.equal(isDailySummaryDue(s, atNine, TZ), true);

  // 9:01 AM EDT -> due.
  const afterNine = new Date("2026-06-04T13:01:00Z");
  assert.equal(isDailySummaryDue(s, afterNine, TZ), true);
});

test("isDailySummaryDue respects the calendar day across the UTC boundary", () => {
  // 11 PM EDT on Jun 4 == 03:00 UTC Jun 5. A session airing the evening
  // of Jun 4 is still 'today' in New York even though UTC has rolled.
  const lateNightLocal = new Date("2026-06-05T03:00:00Z"); // 11 PM EDT Jun 4
  const todaysSession = session(new Date("2026-06-04T20:00:00Z")); // 4 PM EDT Jun 4
  assert.equal(
    sameZonedDay(todaysSession.startsAt, lateNightLocal, TZ),
    true,
    "both fall on Jun 4 in America/New_York",
  );
  assert.equal(isDailySummaryDue(todaysSession, lateNightLocal, TZ), true);

  // A session airing Jun 5 (next NY day) is not due during Jun 4's tick.
  const tomorrowsSession = session(new Date("2026-06-05T20:00:00Z"));
  assert.equal(
    isDailySummaryDue(tomorrowsSession, lateNightLocal, TZ),
    false,
    "a different calendar day must be excluded even if UTC dates collide",
  );
});

test("isDailySummaryDue handles the spring-forward DST day correctly", () => {
  // DST starts 2026-03-08 in the US: clocks jump 2 AM EST -> 3 AM EDT, so
  // that day 9 AM is EDT (UTC-4) == 13:00 UTC. Verify the cutoff math
  // does not drift on the transition day.
  const cutoff = zonedWallClockToUtc(2026, 3, 8, 9, 0, TZ);
  assert.equal(cutoff.toISOString(), "2026-03-08T13:00:00.000Z");

  const dstSession = session(new Date("2026-03-08T18:00:00Z")); // 2 PM EDT
  // 8:59 AM EDT (12:59 UTC) -> not yet due.
  assert.equal(
    isDailySummaryDue(dstSession, new Date("2026-03-08T12:59:00Z"), TZ),
    false,
  );
  // 9:00 AM EDT (13:00 UTC) -> due.
  assert.equal(
    isDailySummaryDue(dstSession, new Date("2026-03-08T13:00:00Z"), TZ),
    true,
  );
});

test("isDailySummaryDue excludes canceled sessions", () => {
  const now = new Date("2026-06-04T14:00:00Z"); // 10 AM EDT, after cutoff
  const s = session(new Date("2026-06-04T20:00:00Z"), { status: "canceled" });
  assert.equal(isDailySummaryDue(s, now, TZ), false);
});
