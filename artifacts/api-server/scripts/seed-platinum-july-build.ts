/* eslint-disable no-console */
// One-shot seeder: inserts the July 2026 Platinum Club build row if it does
// not already exist. Safe to re-run — it is a no-op when the slug already
// exists.
//
// Run:
//   pnpm --filter @workspace/api-server exec tsx scripts/seed-platinum-july-build.ts

import { db } from "@workspace/db";
import { platinumClubBuildsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { PLATINUM_BUILD_SECTION_TYPES } from "../src/lib/ensure-platinum-club-builds.js";

const JULY_SLUG = "july-2026";
const JULY_LABEL = "JULY - AI PERSONAL FINANCE & WEALTH BUILDER";

const JULY_SECTIONS = PLATINUM_BUILD_SECTION_TYPES.map((s) => ({
  key: `july_${s.key}`,
  label: s.label,
}));

async function main() {
  // Check if already exists
  const [existing] = await db
    .select({ id: platinumClubBuildsTable.id })
    .from(platinumClubBuildsTable)
    .where(eq(platinumClubBuildsTable.slug, JULY_SLUG));

  if (existing) {
    console.log(`✓ July build already exists (id=${existing.id}) — nothing to do.`);
    process.exit(0);
  }

  // Find the current max displayOrder so we append at the end
  const [{ max } = { max: 0 }] = await db
    .select({ max: sql<number>`coalesce(max(${platinumClubBuildsTable.displayOrder}), 0)::int` })
    .from(platinumClubBuildsTable);

  const [row] = await db
    .insert(platinumClubBuildsTable)
    .values({
      label: JULY_LABEL,
      slug: JULY_SLUG,
      sections: JULY_SECTIONS,
      displayOrder: Number(max) + 1,
      isActive: true,
    })
    .returning({ id: platinumClubBuildsTable.id });

  console.log(`✓ Created July 2026 build (id=${row?.id}).`);
  console.log(`  Label:   ${JULY_LABEL}`);
  console.log(`  Slug:    ${JULY_SLUG}`);
  console.log(`  Sections (${JULY_SECTIONS.length}):`);
  for (const s of JULY_SECTIONS) {
    console.log(`    ${s.key}  →  "${s.label}"`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("seed-platinum-july-build failed:", err);
  process.exit(1);
});
