import { db } from "@workspace/db";
import { platinumClubBuildsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// Platinum Club "DFY Builds" seed.
//
// Publish ships the `platinum_club_builds` table (ADD TABLE migration) but skips
// data backfills, so this boot loader provides the INITIAL build rows.
//
// IMPORTANT - seed-if-empty only. Admins own builds at runtime via the admin
// CRUD endpoints in routes/platinum-club.ts (create / rename / reorder / hide /
// delete). The loader seeds the two starter builds below ONLY when the table is
// empty; once any row exists it never touches the table again. A drift-
// correcting reseed would silently wipe every admin edit on the next worker
// restart, so it must not be reintroduced.
//
// The May build keeps the ORIGINAL bare section keys (main_offer, bonuses, ...)
// and the June build uses launchpad_-prefixed keys, so the existing
// platinum_club_resources rows continue to map to the correct build with no
// data migration. The advisory lock keeps concurrent workers from racing the
// first insert.

type SeedBuild = {
  label: string;
  slug: string;
  displayOrder: number;
  sections: { key: string; label: string }[];
};

// Standard section taxonomy every build ships with (used here for the seeds and
// re-exported for admin-created builds).
export const PLATINUM_BUILD_SECTION_TYPES: { key: string; label: string }[] = [
  { key: "main_offer", label: "Main Offer" },
  { key: "bonuses", label: "Bonuses" },
  { key: "bumps", label: "Order Bumps" },
  { key: "upsells", label: "Upsells" },
  { key: "creation_assets", label: "Creation Assets" },
  { key: "content_scripts", label: "Content Scripts" },
  { key: "ads", label: "Ads Library" },
  { key: "sales_assets", label: "Sales Assets" },
  { key: "top_ads", label: "Top 20 Ads" },
  { key: "custom_graphics", label: "Custom Graphics" },
];

export const PLATINUM_CLUB_BUILDS: SeedBuild[] = [
  {
    label: "May 2026 - Agency Growth Blueprint",
    slug: "may-2026",
    displayOrder: 1,
    // Original bare keys - the existing 58 resources reference these.
    sections: PLATINUM_BUILD_SECTION_TYPES.map((s) => ({ ...s })),
  },
  {
    label: "June 2026 - The First-Time Entrepreneur Launchpad",
    slug: "june-2026",
    displayOrder: 2,
    sections: PLATINUM_BUILD_SECTION_TYPES.map((s) => ({
      key: `launchpad_${s.key}`,
      label: s.label,
    })),
  },
];

const ADVISORY_LOCK_KEY = 0x70636c62; // "pclb"

export async function ensurePlatinumClubBuildsSeeded(): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`);

      const [{ count } = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(platinumClubBuildsTable);
      if (Number(count) > 0) {
        return;
      }

      for (const b of PLATINUM_CLUB_BUILDS) {
        await tx.insert(platinumClubBuildsTable).values({
          label: b.label,
          slug: b.slug,
          sections: b.sections,
          displayOrder: b.displayOrder,
          isActive: true,
        });
      }

      logger.info(
        { seeded: PLATINUM_CLUB_BUILDS.length },
        "ensurePlatinumClubBuildsSeeded - seeded starter builds",
      );
    });
  } catch (err) {
    logger.error({ err }, "ensurePlatinumClubBuildsSeeded failed");
  }
}
