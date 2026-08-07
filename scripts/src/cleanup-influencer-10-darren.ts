/**
 * One-off cleanup for Darren Nicholl (darren@darrennicholl.com)
 * Influencer page: room30.ai/members/influencer/10
 *
 * Problem (Intercom 215474404221852, Monday 2934535833):
 *   Influencer 10 has 90 angles + 58 settings because 5 jobs (#8, #22, #44,
 *   #52, #55) all reused the same ai_influencers row and Viktor's delivery
 *   endpoints (POST /angles/batch, /settings, /setting-images) appended every
 *   retry's batch instead of replacing prior data. The buyer was happy with
 *   the first successful batch and wants every later batch removed.
 *
 * First successful batch (kept):
 *   10 angles  ids 779-788  created 2026-05-19 03:19:07-11 UTC
 *    8 settings ids 527-534 created 2026-05-19 03:19:12-18 UTC
 *    8 setting_images (1 per setting, cascade via setting_id)
 *
 * Cutoff:
 *   created_at >= '2026-05-21 00:00:00+00' (every duplicate batch landed
 *   today; the May-19 originals are well outside the window).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run cleanup:influencer-10 -- --dry
 *   pnpm --filter @workspace/scripts run cleanup:influencer-10 -- --apply
 *
 * Must be run against PROD_DATABASE_URL by the user — agent cannot write to
 * production from the executeSql sandbox.
 */

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  aiInfluencersTable,
  influencerAnglesTable,
  influencerSettingsTable,
  settingImagesTable,
} from "@workspace/db";

const INFLUENCER_ID = 10;
const CUTOFF_ISO = "2026-05-21 00:00:00+00";

function parseArgs(): { apply: boolean } {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const dry = argv.includes("--dry");
  if (!apply && !dry) {
    throw new Error("Pass --dry to preview or --apply to commit.");
  }
  return { apply };
}

async function main() {
  const { apply } = parseArgs();

  const [influencer] = await db
    .select()
    .from(aiInfluencersTable)
    .where(eq(aiInfluencersTable.id, INFLUENCER_ID))
    .limit(1);
  if (!influencer) {
    console.error(`Influencer ${INFLUENCER_ID} not found.`);
    process.exit(1);
  }

  const beforeAngles = await db
    .select({ id: influencerAnglesTable.id })
    .from(influencerAnglesTable)
    .where(eq(influencerAnglesTable.influencerId, INFLUENCER_ID));
  const beforeSettings = await db
    .select({ id: influencerSettingsTable.id })
    .from(influencerSettingsTable)
    .where(eq(influencerSettingsTable.influencerId, INFLUENCER_ID));
  const beforeSettingImages = await db
    .select({ id: settingImagesTable.id })
    .from(settingImagesTable)
    .where(
      inArray(
        settingImagesTable.settingId,
        beforeSettings.map((s) => s.id),
      ),
    );

  const cutoff = new Date(CUTOFF_ISO);

  const anglesToDelete = await db
    .select({ id: influencerAnglesTable.id, createdAt: influencerAnglesTable.createdAt })
    .from(influencerAnglesTable)
    .where(
      and(
        eq(influencerAnglesTable.influencerId, INFLUENCER_ID),
        gte(influencerAnglesTable.createdAt, cutoff),
      ),
    );
  const settingsToDelete = await db
    .select({ id: influencerSettingsTable.id, name: influencerSettingsTable.name })
    .from(influencerSettingsTable)
    .where(
      and(
        eq(influencerSettingsTable.influencerId, INFLUENCER_ID),
        gte(influencerSettingsTable.createdAt, cutoff),
      ),
    );
  const settingImageIdsToDelete = settingsToDelete.length
    ? await db
        .select({ id: settingImagesTable.id })
        .from(settingImagesTable)
        .where(
          inArray(
            settingImagesTable.settingId,
            settingsToDelete.map((s) => s.id),
          ),
        )
    : [];

  console.log("\nInfluencer 10 (Darren Nicholl) cleanup");
  console.log("---------------------------------------");
  console.log(`Status:           ${influencer.status}`);
  console.log(`Before:           ${beforeAngles.length} angles, ${beforeSettings.length} settings, ${beforeSettingImages.length} setting_images`);
  console.log(`Cutoff:           created_at >= ${CUTOFF_ISO}`);
  console.log(`Will delete:      ${anglesToDelete.length} angles, ${settingsToDelete.length} settings, ${settingImageIdsToDelete.length} setting_images`);
  console.log(`Will keep:        ${beforeAngles.length - anglesToDelete.length} angles, ${beforeSettings.length - settingsToDelete.length} settings, ${beforeSettingImages.length - settingImageIdsToDelete.length} setting_images`);

  const expectedKeptAngles = 10;
  const expectedKeptSettings = 8;
  const expectedKeptAngleIds = [779, 780, 781, 782, 783, 784, 785, 786, 787, 788];
  const expectedKeptSettingIds = [527, 528, 529, 530, 531, 532, 533, 534];
  const willKeepAngles = beforeAngles.length - anglesToDelete.length;
  const willKeepSettings = beforeSettings.length - settingsToDelete.length;
  if (willKeepAngles !== expectedKeptAngles || willKeepSettings !== expectedKeptSettings) {
    console.error(`\nABORT: refusing to run. Expected to keep ${expectedKeptAngles} angles + ${expectedKeptSettings} settings, plan would keep ${willKeepAngles} + ${willKeepSettings}.`);
    process.exit(1);
  }
  const willKeepAngleIds = beforeAngles
    .filter((a) => !anglesToDelete.some((d) => d.id === a.id))
    .map((a) => a.id)
    .sort((a, b) => a - b);
  const willKeepSettingIds = beforeSettings
    .filter((s) => !settingsToDelete.some((d) => d.id === s.id))
    .map((s) => s.id)
    .sort((a, b) => a - b);
  const sameIds = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (!sameIds(willKeepAngleIds, expectedKeptAngleIds) || !sameIds(willKeepSettingIds, expectedKeptSettingIds)) {
    console.error(`\nABORT: refusing to run. Surviving IDs do not match the recorded first-batch IDs.`);
    console.error(`  Plan would keep angles:    ${willKeepAngleIds.join(",")}`);
    console.error(`  Expected first-batch:      ${expectedKeptAngleIds.join(",")}`);
    console.error(`  Plan would keep settings:  ${willKeepSettingIds.join(",")}`);
    console.error(`  Expected first-batch:      ${expectedKeptSettingIds.join(",")}`);
    process.exit(1);
  }

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to commit.\n");
    await pool.end();
    return;
  }

  await db.transaction(async (tx) => {
    if (settingImageIdsToDelete.length > 0) {
      await tx.delete(settingImagesTable).where(
        inArray(
          settingImagesTable.id,
          settingImageIdsToDelete.map((r) => r.id),
        ),
      );
    }
    if (settingsToDelete.length > 0) {
      await tx.delete(influencerSettingsTable).where(
        inArray(
          influencerSettingsTable.id,
          settingsToDelete.map((r) => r.id),
        ),
      );
    }
    if (anglesToDelete.length > 0) {
      await tx.delete(influencerAnglesTable).where(
        inArray(
          influencerAnglesTable.id,
          anglesToDelete.map((r) => r.id),
        ),
      );
    }
    // Re-pack sort_order on the remaining angles and settings so the
    // workspace UI renders 0..N-1 cleanly instead of leaving the holes
    // the dupe rows used to fill.
    await tx.execute(sql`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order, id) - 1 AS rn
        FROM influencer_angles
        WHERE influencer_id = ${INFLUENCER_ID}
      )
      UPDATE influencer_angles a
      SET sort_order = ranked.rn
      FROM ranked
      WHERE a.id = ranked.id;
    `);
    await tx.execute(sql`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order, id) - 1 AS rn
        FROM influencer_settings
        WHERE influencer_id = ${INFLUENCER_ID}
      )
      UPDATE influencer_settings s
      SET sort_order = ranked.rn
      FROM ranked
      WHERE s.id = ranked.id;
    `);
  });

  const afterAngles = await db
    .select({ id: influencerAnglesTable.id })
    .from(influencerAnglesTable)
    .where(eq(influencerAnglesTable.influencerId, INFLUENCER_ID));
  const afterSettings = await db
    .select({ id: influencerSettingsTable.id })
    .from(influencerSettingsTable)
    .where(eq(influencerSettingsTable.influencerId, INFLUENCER_ID));
  const afterSettingImages = afterSettings.length
    ? await db
        .select({ id: settingImagesTable.id })
        .from(settingImagesTable)
        .where(
          inArray(
            settingImagesTable.settingId,
            afterSettings.map((s) => s.id),
          ),
        )
    : [];

  console.log(`\nDone. After:     ${afterAngles.length} angles, ${afterSettings.length} settings, ${afterSettingImages.length} setting_images\n`);

  // Post-apply invariants — refuse to declare success if the survivors
  // are not exactly the recorded first-batch IDs.
  const afterAngleIds = afterAngles.map((a) => a.id).sort((a, b) => a - b);
  const afterSettingIds = afterSettings.map((s) => s.id).sort((a, b) => a - b);
  if (!sameIds(afterAngleIds, expectedKeptAngleIds) || !sameIds(afterSettingIds, expectedKeptSettingIds)) {
    console.error(`FAIL: post-apply invariant violated. Investigate immediately.`);
    console.error(`  After angles:    ${afterAngleIds.join(",")}`);
    console.error(`  Expected:        ${expectedKeptAngleIds.join(",")}`);
    console.error(`  After settings:  ${afterSettingIds.join(",")}`);
    console.error(`  Expected:        ${expectedKeptSettingIds.join(",")}`);
    await pool.end();
    process.exit(2);
  }
  if (afterSettingImages.length !== expectedKeptSettings) {
    console.error(`FAIL: expected ${expectedKeptSettings} setting_images (1 per first-batch setting), got ${afterSettingImages.length}.`);
    await pool.end();
    process.exit(2);
  }
  console.log(`Post-apply invariants OK.\n`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
