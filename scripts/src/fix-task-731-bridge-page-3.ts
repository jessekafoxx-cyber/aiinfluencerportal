/**
 * Task #731 — Fix Bridge Page 3 install link.
 *
 * The Room30 "Building Your Bridge Page" lesson (slug
 * `r30-p2-bridge-page-build`) had the Bridge page 3 install link
 * silently pointing at the Bridge page 2 affiliate funnel_share ID
 * (`69f895bd671aafa949f64ff1`). The correct ID for Bridge page 3 is
 * `6a03667e09b7380096e9a894`.
 *
 * `ensureRoom30Course` only inserts new lesson rows — it never updates
 * existing rows — so patching `room30-course-data.ts` alone is not
 * enough. This one-shot script rewrites the `notes` column on the
 * single matching lessons row in place. Idempotent (safe to re-run;
 * exits 0 with "already clean" if no occurrence is found).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run fix:task-731-bridge-page-3            (dry-run)
 *   pnpm --filter @workspace/scripts run fix:task-731-bridge-page-3 -- --apply (write)
 *
 * Against prod, set DATABASE_URL=$PROD_DATABASE_URL before running.
 */

import { and, eq } from "drizzle-orm";
import { db, lessonsTable } from "@workspace/db";

const LESSON_SLUG = "r30-p2-bridge-page-build";
const PORTAL_KEY = "room30";
const BAD_LINK =
  'funnel_share=69f895bd671aafa949f64ff1">Bridge page 3</a>';
const GOOD_LINK =
  'funnel_share=6a03667e09b7380096e9a894">Bridge page 3</a>';
// HTML-entity variant in case the row was stored with `&amp;` etc.
const BAD_LINK_AMP =
  'funnel_share=69f895bd671aafa949f64ff1&quot;&gt;Bridge page 3&lt;/a&gt;';
const GOOD_LINK_AMP =
  'funnel_share=6a03667e09b7380096e9a894&quot;&gt;Bridge page 3&lt;/a&gt;';

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await db
    .select({ id: lessonsTable.id, notes: lessonsTable.notes })
    .from(lessonsTable)
    .where(
      and(
        eq(lessonsTable.slug, LESSON_SLUG),
        eq(lessonsTable.portalKey, PORTAL_KEY),
      ),
    );

  if (rows.length === 0) {
    console.log(`[task-731] no lesson row found for slug=${LESSON_SLUG} portal=${PORTAL_KEY}`);
    process.exit(0);
  }

  let changed = 0;
  let alreadyClean = 0;
  for (const row of rows) {
    const notes = row.notes ?? "";
    let next = notes;
    if (next.includes(BAD_LINK)) next = next.split(BAD_LINK).join(GOOD_LINK);
    if (next.includes(BAD_LINK_AMP)) next = next.split(BAD_LINK_AMP).join(GOOD_LINK_AMP);

    if (next === notes) {
      alreadyClean++;
      console.log(`[task-731] lesson id=${row.id}: already clean`);
      continue;
    }

    if (!apply) {
      console.log(`[task-731] lesson id=${row.id}: would rewrite Bridge page 3 link (dry-run)`);
      changed++;
      continue;
    }

    await db.update(lessonsTable).set({ notes: next }).where(eq(lessonsTable.id, row.id));
    changed++;
    console.log(`[task-731] lesson id=${row.id}: notes updated`);
  }

  console.log(
    `[task-731] done — apply=${apply} changed=${changed} alreadyClean=${alreadyClean}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[task-731] failed", err);
  process.exit(1);
});
