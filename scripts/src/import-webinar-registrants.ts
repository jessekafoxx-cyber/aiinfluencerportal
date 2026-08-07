/**
 * One-shot importer for a WebinarFuel-style registrants CSV.
 *
 * For every row we:
 *   1. Upsert into crm_contacts via enqueueCrmContact (in-process, immediate)
 *   2. Enqueue a KIT "live-event" tag via enqueueKitTag (outbox; api-server
 *      worker drains)
 *   3. Enqueue a WATI "live-event" tag via enqueueWatiTag when we can
 *      derive a valid E.164 phone (outbox; api-server worker drains)
 *
 * CSV columns we read (case-insensitive):
 *   "First name", "Last name", "Phone country code", "Phone number",
 *   "Email", "Webinar", "Attended live", "Watched replay"
 *
 * Usage:
 *   CSV_PATH=/abs/path/to/registrants.csv DRY_RUN=1 \
 *     pnpm --filter @workspace/scripts run import:webinar-registrants
 *   DRY_RUN=0 to actually write.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { enqueueCrmContact } from "../../artifacts/api-server/src/lib/crm-ingest.js";
import { enqueueKitTag } from "../../artifacts/api-server/src/lib/kit-sync.js";
import { enqueueWatiTag } from "../../artifacts/api-server/src/lib/wati-sync.js";
import { normalizePhoneE164 } from "../../artifacts/api-server/src/lib/wati-client.js";

const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";
const CSV_PATH = process.env.CSV_PATH
  ? resolve(process.env.CSV_PATH)
  : resolve(
      process.cwd(),
      "../attached_assets/MCefYJywPBWm8eYtTrA2Yi2q1778938485_1778938503269.csv",
    );
const SOURCE_TAG = process.env.SOURCE_TAG ?? "webinar-registrants-import";

interface Registrant {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phoneE164: string | null;
  webinar: string | null;
  attendedLive: boolean;
  watchedReplay: boolean;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        cur.push(field);
        field = "";
      } else if (ch === "\n") {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      } else if (ch === "\r") {
        // skip
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function pickColumn(headers: string[], names: string[]): number {
  const norm = headers.map((h) => h.trim().toLowerCase());
  for (const n of names) {
    const i = norm.indexOf(n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

function combinePhone(countryCode: string, number: string): string | null {
  const cc = (countryCode || "").replace(/\D+/g, "");
  // National number: strip non-digits then strip any leading 0s (trunk
  // prefix common in UK/EU/AU/NZ CSV exports).
  const nat = (number || "").replace(/\D+/g, "").replace(/^0+/, "");
  if (!cc || !nat) return null;
  // Some CSV rows have the country code already baked into the
  // "Phone number" column (e.g. +1 / 12482227611). Naively
  // concatenating produces 112482227611 which routes to the wrong
  // WhatsApp contact. If `nat` already starts with `cc` AND has enough
  // remaining digits to be a plausible national number on its own,
  // treat it as already international.
  const combined =
    nat.startsWith(cc) && nat.length - cc.length >= 7 ? nat : cc + nat;
  return normalizePhoneE164(combined);
}

function loadRegistrants(): Registrant[] {
  const text = readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0];
  const idxEmail = pickColumn(headers, ["email"]);
  const idxFirst = pickColumn(headers, ["first name", "first_name"]);
  const idxLast = pickColumn(headers, ["last name", "last_name"]);
  const idxCc = pickColumn(headers, ["phone country code", "country code"]);
  const idxPhone = pickColumn(headers, ["phone number", "phone"]);
  const idxWebinar = pickColumn(headers, ["webinar"]);
  const idxAttended = pickColumn(headers, ["attended live"]);
  const idxReplay = pickColumn(headers, ["watched replay"]);
  if (idxEmail < 0) throw new Error("CSV missing Email column");

  const byEmail = new Map<string, Registrant>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const email = (row[idxEmail] ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    const firstName =
      idxFirst >= 0 ? (row[idxFirst] ?? "").trim() || null : null;
    const lastName =
      idxLast >= 0 ? (row[idxLast] ?? "").trim() || null : null;
    const phoneE164 =
      idxCc >= 0 && idxPhone >= 0
        ? combinePhone(row[idxCc] ?? "", row[idxPhone] ?? "")
        : null;
    const webinar =
      idxWebinar >= 0 ? (row[idxWebinar] ?? "").trim() || null : null;
    const attendedLive =
      idxAttended >= 0 &&
      (row[idxAttended] ?? "").trim().toLowerCase() === "yes";
    const watchedReplay =
      idxReplay >= 0 && (row[idxReplay] ?? "").trim().toLowerCase() === "yes";

    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, {
        email,
        firstName,
        lastName,
        phoneE164,
        webinar,
        attendedLive,
        watchedReplay,
      });
    } else {
      existing.firstName = existing.firstName || firstName;
      existing.lastName = existing.lastName || lastName;
      existing.phoneE164 = existing.phoneE164 || phoneE164;
      existing.webinar = existing.webinar || webinar;
      existing.attendedLive = existing.attendedLive || attendedLive;
      existing.watchedReplay = existing.watchedReplay || watchedReplay;
    }
  }
  return [...byEmail.values()];
}

async function main() {
  const regs = loadRegistrants();
  const withPhone = regs.filter((r) => r.phoneE164).length;
  console.log(
    `[webinar-import] mode=${DRY_RUN ? "DRY_RUN" : "APPLY"} csv=${CSV_PATH} unique_emails=${regs.length} with_phone=${withPhone}`,
  );

  if (DRY_RUN) {
    for (const r of regs.slice(0, 10)) {
      console.log(
        `[webinar-import] sample email=${r.email} first=${r.firstName ?? ""} phone=${r.phoneE164 ?? "-"} attended=${r.attendedLive} replay=${r.watchedReplay}`,
      );
    }
    console.log("[webinar-import] DRY_RUN=1 - set DRY_RUN=0 to apply.");
    return;
  }

  let crm = 0;
  let kit = 0;
  let wati = 0;
  let watiSkipped = 0;
  let failed = 0;

  for (const r of regs) {
    const fullName =
      [r.firstName, r.lastName].filter((s) => s && s.trim()).join(" ") || null;
    const fields: Record<string, string | number> = {
      attended_live: r.attendedLive ? "yes" : "no",
      watched_replay: r.watchedReplay ? "yes" : "no",
    };
    if (r.webinar) fields.webinar = r.webinar;

    try {
      await enqueueCrmContact({
        email: r.email,
        phone: r.phoneE164,
        firstName: r.firstName,
        lastName: r.lastName,
        source: r.webinar ? `webinar:${r.webinar}` : "webinar",
        notes: `Webinar registrant import (${SOURCE_TAG}). attended_live=${fields.attended_live} watched_replay=${fields.watched_replay}`,
      });
      crm++;

      await enqueueKitTag({
        email: r.email,
        tag: "live-event",
        firstName: r.firstName,
        fields,
        source: SOURCE_TAG,
      });
      kit++;

      if (r.phoneE164) {
        await enqueueWatiTag({
          phone: r.phoneE164,
          email: r.email,
          tag: "live-event",
          fullName,
          fields,
          source: SOURCE_TAG,
        });
        wati++;
      } else {
        watiSkipped++;
      }
    } catch (err) {
      failed++;
      console.warn(
        `[webinar-import] failed email=${r.email}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(
    `[webinar-import] done crm=${crm} kit=${kit} wati=${wati} wati_skipped_no_phone=${watiSkipped} failed=${failed}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[webinar-import] fatal", err);
    process.exit(1);
  });
