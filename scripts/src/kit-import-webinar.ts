/**
 * Task #639 - one-shot importer for a WebinarFuel-style registrants CSV
 * into the KIT (ConvertKit) outbox.
 *
 * Reads the CSV at `--file <path>`, derives KIT tags per row, and
 * enqueues `kit_sync_outbox` rows. The api-server worker drain loop
 * (every 15s) pushes them to KIT.
 *
 * Tags applied per kept row:
 *   - Always: `webinar-registrant`, `webinar:<event-slug>` (derived from
 *     the CSV `Webinar` column; falls back to `webinar:unknown`).
 *   - `webinar-attended-live` if `Attended live = Yes`.
 *   - `webinar-watched-replay` if `Watched replay = Yes`.
 *   - `webinar-purchased` if `Purchased from live room = Yes` OR
 *     `Purchased from replay room = Yes`.
 *
 * Skip rules: rows with no email / malformed email / `Subscribed = No`
 * are dropped and counted in the summary, never enqueued.
 *
 * Idempotent: each enqueued row carries a stable `source` string
 *   `webinar-csv:<event-slug>:<sha256-of-email>:<tag>`
 * and the importer skips only the exact `(event, email, tag)` pairs
 * already present in `kit_sync_outbox` under that source. A buyer
 * imported for one webinar is still re-tagged for any future webinar,
 * and an interrupted prior run can be re-run to fill in missing tags
 * without duplicating ones already enqueued.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run kit:import-webinar -- --file <path>            # dry-run
 *   pnpm --filter @workspace/scripts run kit:import-webinar -- --file <path> --apply    # writes
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { createHash } from "node:crypto";

import { parse as csvParse } from "csv-parse/sync";
import { sql } from "drizzle-orm";

import { db, kitSyncOutboxTable } from "@workspace/db";

interface Args {
  file: string;
  apply: boolean;
}

function parseArgs(argv: string[]): Args {
  let file = "";
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") {
      file = argv[++i] ?? "";
    } else if (a.startsWith("--file=")) {
      file = a.slice("--file=".length);
    } else if (a === "--apply") {
      apply = true;
    } else if (a === "--dry-run") {
      apply = false;
    }
  }
  if (!file) {
    console.error(
      "usage: kit:import-webinar -- --file <path> [--dry-run|--apply]",
    );
    process.exit(2);
  }
  return { file: resolveCsvPath(file), apply };
}

/**
 * Resolve `--file` against the location the user actually invoked pnpm
 * from, not the current process.cwd() (which is `scripts/` when run
 * via `pnpm --filter @workspace/scripts`). Falls back to repo root and
 * process.cwd() so common invocations all work.
 */
function resolveCsvPath(raw: string): string {
  if (isAbsolute(raw)) return raw;
  const candidates: string[] = [];
  if (process.env.INIT_CWD) candidates.push(resolve(process.env.INIT_CWD, raw));
  candidates.push(resolve(process.cwd(), raw));
  candidates.push(resolve(process.cwd(), "..", raw)); // scripts/ -> repo root
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

function slugifyEvent(raw: string | null | undefined): string {
  if (!raw) return "webinar:unknown";
  const slug = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `webinar:${slug}` : "webinar:unknown";
}

function normEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase();
  // RFC-lite check: presence of `@` plus a `.` in the host half.
  const at = k.indexOf("@");
  if (at <= 0 || at === k.length - 1) return null;
  const host = k.slice(at + 1);
  if (!host.includes(".")) return null;
  if (/\s/.test(k)) return null;
  return k;
}

function isYes(v: string | undefined | null): boolean {
  return (v ?? "").trim().toLowerCase() === "yes";
}

function isNo(v: string | undefined | null): boolean {
  return (v ?? "").trim().toLowerCase() === "no";
}

function emailHash(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 16);
}

interface Row {
  email: string;
  firstName: string | null;
  eventSlugTag: string;
  attendedLive: boolean;
  watchedReplay: boolean;
  purchased: boolean;
}

interface Summary {
  rowsSeen: number;
  rowsValid: number;
  rowsSkipped: {
    noEmail: number;
    invalidEmail: number;
    unsubscribed: number;
    alreadyEnqueued: number;
  };
  tagsApplied: Record<string, number>;
  enqueued: number;
  dryRun: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const text = readFileSync(args.file, "utf8");
  const records: Record<string, string>[] = csvParse(text, {
    columns: (h: string[]) => h.map((c) => c.trim()),
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });

  const summary: Summary = {
    rowsSeen: 0,
    rowsValid: 0,
    rowsSkipped: {
      noEmail: 0,
      invalidEmail: 0,
      unsubscribed: 0,
      alreadyEnqueued: 0,
    },
    tagsApplied: {},
    enqueued: 0,
    dryRun: !args.apply,
  };

  // First pass: parse + dedupe by email, applying skip rules. Last-write
  // wins on first name; tag booleans are OR-merged across rows so
  // duplicate registrations for the same buyer collapse cleanly.
  const byEmail = new Map<string, Row>();
  for (const rec of records) {
    summary.rowsSeen++;
    const rawEmail = rec["Email"];
    if (!rawEmail || !rawEmail.trim()) {
      summary.rowsSkipped.noEmail++;
      continue;
    }
    const email = normEmail(rawEmail);
    if (!email) {
      summary.rowsSkipped.invalidEmail++;
      continue;
    }
    const subscribed = rec["Subscribed"];
    if (isNo(subscribed)) {
      summary.rowsSkipped.unsubscribed++;
      continue;
    }
    const firstName = (rec["First name"] ?? "").trim() || null;
    const eventSlugTag = slugifyEvent(rec["Webinar"]);
    const attendedLive = isYes(rec["Attended live"]);
    const watchedReplay = isYes(rec["Watched replay"]);
    const purchased =
      isYes(rec["Purchased from live room"]) ||
      isYes(rec["Purchased from replay room"]);

    const existing = byEmail.get(email);
    if (existing) {
      existing.firstName = existing.firstName || firstName;
      existing.attendedLive = existing.attendedLive || attendedLive;
      existing.watchedReplay = existing.watchedReplay || watchedReplay;
      existing.purchased = existing.purchased || purchased;
      // Prefer the first non-unknown event slug we see.
      if (existing.eventSlugTag === "webinar:unknown" && eventSlugTag !== "webinar:unknown") {
        existing.eventSlugTag = eventSlugTag;
      }
    } else {
      byEmail.set(email, {
        email,
        firstName,
        eventSlugTag,
        attendedLive,
        watchedReplay,
        purchased,
      });
    }
  }
  summary.rowsValid = byEmail.size;

  // Collect every event slug present in this CSV (usually one, but we
  // never assume) so the dedupe lookup can scope to *just* those events.
  // That way a buyer imported under a previous webinar is still re-tagged
  // for the current one, but an exact `(event, email, tag)` pair that
  // already landed in the outbox is skipped (so an interrupted prior run
  // can be re-run safely without duplicating the rows it already wrote).
  const eventSlugs = new Set<string>();
  for (const r of byEmail.values()) eventSlugs.add(r.eventSlugTag);

  const hashes = new Map<string, string>(); // email -> emailHash
  for (const r of byEmail.values()) hashes.set(r.email, emailHash(r.email));

  // Exact `(event-slug, email-hash, tag)` triples already enqueued.
  const seenTriples = new Set<string>();
  for (const eventSlug of eventSlugs) {
    const likePattern = `webinar-csv:${eventSlug}:%`;
    const rows = await db.execute<{ payload_source: string }>(sql`
      SELECT payload->>'source' AS payload_source
        FROM kit_sync_outbox
       WHERE payload->>'source' LIKE ${likePattern}
    `);
    const list: Array<{ payload_source: string }> = Array.isArray(rows)
      ? (rows as Array<{ payload_source: string }>)
      : ((rows as unknown as { rows?: Array<{ payload_source: string }> }).rows ?? []);
    for (const r of list) {
      const src = r.payload_source ?? "";
      // src looks like `webinar-csv:<event-slug>:<email-hash>:<tag>`.
      // The event-slug itself contains a colon (`webinar:<slug>`), so we
      // can't just split - reconstruct relative to the known prefix.
      const prefix = `webinar-csv:${eventSlug}:`;
      if (!src.startsWith(prefix)) continue;
      const rest = src.slice(prefix.length);
      const sep = rest.indexOf(":");
      if (sep < 0) continue;
      const emailH = rest.slice(0, sep);
      const tag = rest.slice(sep + 1);
      seenTriples.add(`${eventSlug}|${emailH}|${tag}`);
    }
  }

  // Second pass: enqueue per (email, tag), skipping only the exact
  // triples that already exist for the same event.
  for (const row of byEmail.values()) {
    const h = hashes.get(row.email)!;
    const tags: string[] = ["webinar-registrant", row.eventSlugTag];
    if (row.attendedLive) tags.push("webinar-attended-live");
    if (row.watchedReplay) tags.push("webinar-watched-replay");
    if (row.purchased) tags.push("webinar-purchased");

    for (const tag of tags) {
      const tripleKey = `${row.eventSlugTag}|${h}|${tag}`;
      if (seenTriples.has(tripleKey)) {
        summary.rowsSkipped.alreadyEnqueued++;
        continue;
      }
      summary.tagsApplied[tag] = (summary.tagsApplied[tag] ?? 0) + 1;
      summary.enqueued++;
      if (!args.apply) continue;
      await db.insert(kitSyncOutboxTable).values({
        contactEmail: row.email,
        op: "tag",
        tag,
        payload: {
          firstName: row.firstName,
          source: `webinar-csv:${row.eventSlugTag}:${h}:${tag}`,
        },
        status: "pending",
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (!args.apply) {
    console.log(
      "\nDry-run only. Re-run with --apply to enqueue these into kit_sync_outbox.",
    );
  } else {
    console.log(
      "\nEnqueued. The worker drain loop (every 15s) will push these to KIT.",
    );
  }
}

main().catch((err) => {
  console.error("[kit-import-webinar] failed:", err);
  process.exit(1);
});
