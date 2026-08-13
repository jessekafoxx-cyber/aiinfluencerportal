/* eslint-disable no-console */
// CSV → DB upsert for July 2026 Platinum Club resources.
//
// Usage:
//   pnpm --filter @workspace/api-server exec tsx scripts/import-platinum-july-csv.ts <path-to-csv>
//
// The CSV must have these columns (order does not matter, extra columns are ignored):
//
//   section           — one of the july_* keys (e.g. july_main_offer)
//   title             — display title (used as the upsert key together with section)
//   description       — optional description text
//   resource_type     — pdf | docx | audio | zip | google_doc | drive_folder | link | image | one_click_install
//   drive_file_id     — Google Drive file id (raw id or a full Drive URL — both are accepted)
//   external_url      — full URL (for google_doc, drive_folder, link, zip bundles, etc.)
//   cover_drive_file_id — Drive file id or URL for the cover image thumbnail (optional)
//   display_order     — integer sort position within the section (optional; defaults to 0)
//
// Upsert key: (section, title).  Existing rows are updated; new rows are inserted.
// Rows where BOTH drive_file_id and external_url are empty are skipped.
//
// The script never deletes rows.

import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { db } from "@workspace/db";
import { platinumClubBuildsTable, platinumClubResourcesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

// ── CSV parser (zero-dependency, handles quoted fields + CRLF) ───────────────

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];

  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuote = false;
        else cur += ch;
      } else {
        if (ch === '"') inQuote = true;
        else if (ch === ',') { fields.push(cur); cur = ""; }
        else cur += ch;
      }
    }
    fields.push(cur);
    return fields;
  }

  const headers = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

// ── Drive ID normalisation (same logic as routes/platinum-club.ts) ───────────

function normalizeDriveId(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/,
  ];
  for (const re of patterns) {
    const m = v.match(re);
    if (m?.[1]) return m[1];
  }
  return v;
}

function emptyToNull(v: string): string | null {
  return v.trim() || null;
}

// ── Valid values ─────────────────────────────────────────────────────────────

const VALID_RESOURCE_TYPES = new Set([
  "pdf", "docx", "audio", "zip", "google_doc", "drive_folder",
  "link", "image", "one_click_install",
]);

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: tsx scripts/import-platinum-july-csv.ts <path-to-csv>");
    process.exit(1);
  }

  const absPath = resolve(csvPath);
  console.log(`Reading CSV: ${absPath}`);

  // Read file
  const text = await new Promise<string>((resolve_, reject) => {
    const chunks: Buffer[] = [];
    createReadStream(absPath)
      .on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
      .on("end", () => resolve_(Buffer.concat(chunks).toString("utf8")))
      .on("error", reject);
  });

  const rows = parseCSV(text);
  if (rows.length === 0) {
    console.error("CSV appears to be empty or has no data rows.");
    process.exit(1);
  }

  // Validate required headers
  const required = ["section", "title", "resource_type"];
  const headers = Object.keys(rows[0]);
  for (const col of required) {
    if (!headers.includes(col)) {
      console.error(`Missing required column: "${col}"`);
      process.exit(1);
    }
  }

  // Load the July build to validate section keys
  const [julyBuild] = await db
    .select()
    .from(platinumClubBuildsTable)
    .where(eq(platinumClubBuildsTable.slug, "july-2026"));
  if (!julyBuild) {
    console.error(
      'July build not found. Run `tsx scripts/seed-platinum-july-build.ts` first.',
    );
    process.exit(1);
  }
  const julySections = new Set<string>(
    (julyBuild.sections as { key: string }[]).map((s) => s.key),
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lineNum = i + 2; // 1-based + header row

    const section = (row.section ?? "").trim();
    const title = (row.title ?? "").trim();
    const resourceType = (row.resource_type ?? "").trim();
    const driveFileId = normalizeDriveId(row.drive_file_id ?? "");
    const externalUrl = emptyToNull(row.external_url ?? "");
    const coverDriveFileId = normalizeDriveId(row.cover_drive_file_id ?? "");
    const description = emptyToNull(row.description ?? "");
    const displayOrder = parseInt(row.display_order ?? "0", 10) || 0;

    // Validations
    if (!section || !title || !resourceType) {
      console.warn(`  Line ${lineNum}: skipped — section/title/resource_type missing.`);
      skipped++;
      continue;
    }
    if (!julySections.has(section)) {
      console.warn(
        `  Line ${lineNum}: skipped — section "${section}" not in July build. Valid sections: ${[...julySections].join(", ")}`,
      );
      skipped++;
      continue;
    }
    if (!VALID_RESOURCE_TYPES.has(resourceType)) {
      console.warn(
        `  Line ${lineNum}: skipped — unknown resource_type "${resourceType}".`,
      );
      skipped++;
      continue;
    }
    if (!driveFileId && !externalUrl) {
      console.warn(
        `  Line ${lineNum}: skipped — both drive_file_id and external_url are empty.`,
      );
      skipped++;
      continue;
    }

    try {
      // Check for existing row (upsert key: section + title)
      const [existing] = await db
        .select({ id: platinumClubResourcesTable.id })
        .from(platinumClubResourcesTable)
        .where(
          and(
            eq(platinumClubResourcesTable.section, section),
            eq(platinumClubResourcesTable.title, title),
          ),
        );

      if (existing) {
        await db
          .update(platinumClubResourcesTable)
          .set({
            description,
            resourceType,
            driveFileId,
            externalUrl,
            coverDriveFileId,
            displayOrder,
            isActive: true,
          })
          .where(eq(platinumClubResourcesTable.id, existing.id));
        console.log(`  ✎ Updated  [${section}] "${title}"`);
        updated++;
      } else {
        await db.insert(platinumClubResourcesTable).values({
          section,
          title,
          description,
          resourceType,
          driveFileId,
          externalUrl,
          coverDriveFileId,
          displayOrder,
          isActive: true,
        });
        console.log(`  + Inserted [${section}] "${title}"`);
        inserted++;
      }
    } catch (err) {
      console.error(`  ✗ Error    [${section}] "${title}": ${(err as Error).message}`);
      errors++;
    }
  }

  console.log("");
  console.log("─".repeat(50));
  console.log(`Done. Rows processed: ${rows.length}`);
  console.log(`  ✓ Inserted: ${inserted}`);
  console.log(`  ✎ Updated:  ${updated}`);
  console.log(`  — Skipped:  ${skipped}`);
  console.log(`  ✗ Errors:   ${errors}`);

  if (errors > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error("import-platinum-july-csv failed:", err);
  process.exit(1);
});
