// Task #797 - Evergreen Webinar shared helpers.
//
// Pure-ish helpers shared between the public/admin webinar routes and
// the worker session-generator scheduler:
//   - settings singleton accessor (id=1, lazily created)
//   - timezone-aware schedule math (wall-clock "HH:MM" in a named tz)
//   - upcoming-session generation (idempotent on the startsAt unique idx)
//   - per-session phase + elapsed math
//   - deterministic attendee-count curve (seeded by session start)
//   - fire-and-forget registration webhook

import { and, asc, eq, gte, sql } from "drizzle-orm";
import {
  db,
  webinarSettings,
  webinarSessions,
  type WebinarSettings,
  type WebinarSession,
} from "@workspace/db";
import { logger } from "./logger";
import { ymdInZone, zonedWallClockToUtc } from "./webinar-time";

export { ymdInZone, zonedWallClockToUtc };

export async function getWebinarSettings(): Promise<WebinarSettings> {
  const [existing] = await db
    .select()
    .from(webinarSettings)
    .where(eq(webinarSettings.id, 1))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(webinarSettings)
    .values({ id: 1 })
    .onConflictDoNothing({ target: webinarSettings.id })
    .returning();
  if (created) return created;
  const [row] = await db
    .select()
    .from(webinarSettings)
    .where(eq(webinarSettings.id, 1))
    .limit(1);
  return row;
}

function parseHHMM(s: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return { hour: 20, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number(m[1])));
  const minute = Math.min(59, Math.max(0, Number(m[2])));
  return { hour, minute };
}

// The next `count` airing instants (UTC) at the configured wall-clock
// time, starting from `from`. A slot today that is still a few minutes
// in the future is included; once it is in the past we roll to the next
// day.
export function computeUpcomingSessionStarts(
  settings: Pick<WebinarSettings, "scheduleTime" | "scheduleTimezone">,
  count: number,
  from: Date = new Date(),
): Date[] {
  const { hour, minute } = parseHHMM(settings.scheduleTime);
  const tz = settings.scheduleTimezone || "America/New_York";
  const out: Date[] = [];
  const startYmd = ymdInZone(from, tz);
  for (let i = 0; out.length < count && i < count + 3; i++) {
    const base = new Date(
      Date.UTC(startYmd.year, startYmd.month1 - 1, startYmd.day + i, 12, 0, 0),
    );
    const ymd = ymdInZone(base, tz);
    const instant = zonedWallClockToUtc(
      ymd.year,
      ymd.month1,
      ymd.day,
      hour,
      minute,
      tz,
    );
    // Skip slots already in the past (small 60s grace).
    if (instant.getTime() > from.getTime() - 60_000) out.push(instant);
  }
  return out.slice(0, count);
}

// Ensure the next `upcomingCount` future sessions exist in the DB.
// Idempotent: insert ... on conflict (starts_at) do nothing.
export async function ensureUpcomingSessions(
  settings: WebinarSettings,
): Promise<WebinarSession[]> {
  const count = Math.max(1, settings.upcomingCount || 4);
  const starts = computeUpcomingSessionStarts(settings, count);
  if (starts.length > 0) {
    await db
      .insert(webinarSessions)
      .values(
        starts.map((startsAt) => ({
          startsAt,
          status: "scheduled" as const,
          videoDurationSeconds: settings.videoDurationSeconds,
        })),
      )
      .onConflictDoNothing({ target: webinarSessions.startsAt });
  }
  const now = new Date();
  return db
    .select()
    .from(webinarSessions)
    .where(gte(webinarSessions.startsAt, new Date(now.getTime() - 60_000)))
    .orderBy(asc(webinarSessions.startsAt))
    .limit(count);
}

export type WebinarPhase = "scheduled" | "live" | "ended";

export interface SessionTiming {
  phase: WebinarPhase;
  /** Seconds since the video started (clamped to [0, duration]). */
  elapsedSeconds: number;
  /** Seconds until the airing starts (0 once live). */
  secondsUntilStart: number;
  durationSeconds: number;
}

export function computeSessionTiming(
  session: Pick<WebinarSession, "startsAt" | "videoDurationSeconds">,
  settings: Pick<WebinarSettings, "roomGraceMinutes">,
  now: Date = new Date(),
): SessionTiming {
  const startMs = session.startsAt.getTime();
  const duration = session.videoDurationSeconds;
  const nowMs = now.getTime();
  const elapsed = Math.floor((nowMs - startMs) / 1000);
  const graceSec = (settings.roomGraceMinutes || 0) * 60;
  if (elapsed < 0) {
    return {
      phase: "scheduled",
      elapsedSeconds: 0,
      secondsUntilStart: Math.ceil((startMs - nowMs) / 1000),
      durationSeconds: duration,
    };
  }
  if (elapsed >= duration + graceSec) {
    return {
      phase: "ended",
      elapsedSeconds: duration,
      secondsUntilStart: 0,
      durationSeconds: duration,
    };
  }
  return {
    phase: "live",
    elapsedSeconds: Math.min(elapsed, duration),
    secondsUntilStart: 0,
    durationSeconds: duration,
  };
}

// Deterministic [0,1) PRNG from a 32-bit integer seed (mulberry32 mix).
function seededUnit(seed: number): number {
  let t = (seed >>> 0) + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Deterministic, smooth "live attendee" count for a given playback
// position. Ramps up over the first 10%, plateaus through 70%, then
// declines, with a seeded +/- micro-fluctuation so it never looks
// static but is identical for every viewer at the same second.
export function attendeeCountAt(
  session: Pick<WebinarSession, "startsAt" | "videoDurationSeconds">,
  elapsedSeconds: number,
  settings: Pick<
    WebinarSettings,
    "counterBase" | "counterRampPct" | "counterVariancePct"
  >,
): number {
  const duration = Math.max(1, session.videoDurationSeconds);
  const base = Math.max(1, settings.counterBase);
  const peak = base * Math.max(1, settings.counterRampPct) / 100;
  const f = Math.min(1, Math.max(0, elapsedSeconds / duration));

  let curve: number;
  if (f < 0.1) {
    curve = base + (peak - base) * (f / 0.1);
  } else if (f < 0.7) {
    curve = peak;
  } else {
    const tail = (f - 0.7) / 0.3;
    curve = peak - (peak - base * 0.5) * tail;
  }

  // 15s buckets so the number drifts gently rather than per-second.
  const bucket = Math.floor(elapsedSeconds / 15);
  const seed = (Math.floor(session.startsAt.getTime() / 1000) ^ (bucket * 2654435761)) >>> 0;
  const jitter = (seededUnit(seed) * 2 - 1) * (Math.max(0, settings.counterVariancePct) / 100);
  return Math.max(1, Math.round(curve * (1 + jitter)));
}

// Fire-and-forget POST of the registration payload to the configured
// webhook. Never throws into the caller.
export interface RegistrationWebhookPayload {
  event: "webinar_registration";
  first_name: string | null;
  email: string;
  phone: string | null;
  registered_at: string;
  session_datetime: string;
  unique_access_link: string;
  hours_until_session: number;
}

export function fireRegistrationWebhook(
  webhookUrl: string | null | undefined,
  payload: RegistrationWebhookPayload,
): void {
  if (!webhookUrl) return;
  void (async () => {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        logger.warn(
          { status: res.status, email: payload.email },
          "[webinar] registration webhook non-2xx",
        );
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), email: payload.email },
        "[webinar] registration webhook failed",
      );
    }
  })();
}

// Mark sessions live/ended based on the wall clock. Used by the worker
// sweep so admin lists reflect reality even without a viewer hitting
// the public endpoints.
export async function sweepSessionStatuses(now: Date = new Date()): Promise<void> {
  const settings = await getWebinarSettings();
  const graceSec = (settings.roomGraceMinutes || 0) * 60;
  // scheduled -> live
  await db
    .update(webinarSessions)
    .set({ status: "live", updatedAt: new Date() })
    .where(
      and(
        eq(webinarSessions.status, "scheduled"),
        sql`${webinarSessions.startsAt} <= ${now.toISOString()}`,
      ),
    );
  // live -> ended (start + duration + grace passed)
  await db
    .update(webinarSessions)
    .set({ status: "ended", updatedAt: new Date() })
    .where(
      and(
        eq(webinarSessions.status, "live"),
        sql`${webinarSessions.startsAt} + (${webinarSessions.videoDurationSeconds} + ${graceSec}) * interval '1 second' <= ${now.toISOString()}`,
      ),
    );
}
