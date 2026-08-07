/**
 * Ensure every buyer in the Whop Members CSV has a portal_users row in the
 * room30 portal so the admin "Manage Users" panel actually lists them.
 *
 * Background: the funnel CSV recovery (recover-whop-buyers-from-csv.ts)
 * writes the orders row + sends the Clerk invite, but it does NOT create
 * the portal_users row - that normally happens when the buyer accepts the
 * Clerk invite and signs in for the first time. Until they sign in the
 * admin "Manage Users" page (which queries
 *   SELECT * FROM portal_users WHERE portal_key = 'room30'
 * ) shows nothing, even though the buyer has paid and has a working Clerk
 * invite. After today's mass recovery the operator wants every buyer
 * visible in admin immediately so support can act on them without waiting
 * for first sign-in.
 *
 * What this does, per email in the CSV:
 *   - SELECT portal_users WHERE email=? AND portal_key='room30'.
 *     - If a row exists, leave role/clerkId/etc untouched but make sure
 *       isActive=true and (when first/last name on the row are blank)
 *       backfill firstName/lastName from the CSV.
 *     - If no row exists, INSERT a fresh one with portal_key='room30',
 *       role='student', isActive=true, isAList=false, clerkId=NULL.
 *       The clerkId stays NULL until the buyer actually signs in via
 *       Clerk; the existing portal sign-in flow links the row by email
 *       at that point.
 *   - Portugal attendees already had isAList=true set by
 *     grant-portugal-full-access.ts. This script never clears isAList.
 *
 * Usage:
 *   CSV_PATH=/abs/path/to/members.csv DRY_RUN=1 \
 *     pnpm --filter @workspace/scripts run backfill:portal-users-csv
 *   DRY_RUN=0 to apply.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { db, portalUsersTable } from "@workspace/db";

const PORTAL_KEY = "room30";
const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";
const CSV_PATH = process.env.CSV_PATH
  ? resolve(process.env.CSV_PATH)
  : resolve(
      process.cwd(),
      "../attached_assets/exprt_iL3N8M1jVsJU_1778793947930.csv",
    );

type Buyer = {
  email: string;
  firstName: string | null;
  lastName: string | null;
};

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

function loadBuyers(): Buyer[] {
  const text = readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0];
  const idxEmail = pickColumn(headers, ["email", "user email", "buyer email"]);
  const idxName = pickColumn(headers, ["name"]);
  const idxFirst = pickColumn(headers, ["first name", "first_name"]);
  const idxLast = pickColumn(headers, ["last name", "last_name"]);
  if (idxEmail < 0) throw new Error("CSV missing Email column");

  const byEmail = new Map<string, Buyer>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const email = (row[idxEmail] ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;

    let firstName: string | null =
      idxFirst >= 0 ? (row[idxFirst] ?? "").trim() || null : null;
    let lastName: string | null =
      idxLast >= 0 ? (row[idxLast] ?? "").trim() || null : null;
    if (!firstName && !lastName && idxName >= 0) {
      const full = (row[idxName] ?? "").trim();
      if (full) {
        const parts = full.split(/\s+/);
        firstName = parts[0] ?? null;
        lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
      }
    }

    if (!byEmail.has(email)) {
      byEmail.set(email, { email, firstName, lastName });
    } else {
      const existing = byEmail.get(email)!;
      existing.firstName = existing.firstName || firstName;
      existing.lastName = existing.lastName || lastName;
    }
  }
  return [...byEmail.values()];
}

async function main() {
  const buyers = loadBuyers();
  console.log(
    `[backfill] csv=${CSV_PATH} unique_emails=${buyers.length} portal_key=${PORTAL_KEY}`,
  );

  let inserted = 0;
  let updated = 0;
  let untouched = 0;
  let failed = 0;

  for (const buyer of buyers) {
    try {
      const [existing] = await db
        .select()
        .from(portalUsersTable)
        .where(
          and(
            eq(portalUsersTable.email, buyer.email),
            eq(portalUsersTable.portalKey, PORTAL_KEY),
          ),
        )
        .limit(1);

      if (existing) {
        const patch: Record<string, unknown> = {};
        if (!existing.isActive) patch.isActive = true;
        if (!existing.firstName && buyer.firstName)
          patch.firstName = buyer.firstName;
        if (!existing.lastName && buyer.lastName)
          patch.lastName = buyer.lastName;

        if (Object.keys(patch).length === 0) {
          untouched++;
          if (DRY_RUN) {
            console.log(`[ok] ${buyer.email} -> already present, no changes`);
          }
          continue;
        }

        if (DRY_RUN) {
          console.log(
            `[update] ${buyer.email} -> ${JSON.stringify(patch)} (DRY_RUN)`,
          );
          updated++;
          continue;
        }

        await db
          .update(portalUsersTable)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(portalUsersTable.id, existing.id));
        updated++;
        console.log(`[update] ${buyer.email} -> ${JSON.stringify(patch)}`);
      } else {
        if (DRY_RUN) {
          console.log(
            `[insert] ${buyer.email} firstName=${buyer.firstName ?? ""} lastName=${buyer.lastName ?? ""} (DRY_RUN)`,
          );
          inserted++;
          continue;
        }
        await db.insert(portalUsersTable).values({
          email: buyer.email,
          portalKey: PORTAL_KEY,
          role: "student",
          isActive: true,
          ...(buyer.firstName ? { firstName: buyer.firstName } : {}),
          ...(buyer.lastName ? { lastName: buyer.lastName } : {}),
        });
        inserted++;
        console.log(`[insert] ${buyer.email}`);
      }
    } catch (err) {
      failed++;
      console.error(`[fatal] ${buyer.email}: ${(err as Error).message}`);
    }
  }

  console.log(
    `[backfill] done. inserted=${inserted} updated=${updated} untouched=${untouched} failed=${failed}${DRY_RUN ? " (DRY_RUN=1)" : ""}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
