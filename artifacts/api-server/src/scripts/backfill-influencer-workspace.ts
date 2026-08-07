import {
  db,
  aiInfluencersTable,
  influencerAnglesTable,
  influencerSettingsTable,
  settingImagesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Manual re-hydrate of an existing influencer's identity workspace.
//
// USE CASE: re-run angle generation + Drive-driven setting compositing for
// an influencer whose stale angles/settings were created by an earlier
// pipeline version. hydrateIdentityWorkspace is idempotent — if any
// influencer_angles or influencer_settings rows already exist for this
// influencer, the matching phase is skipped. To force a full re-hydrate,
// pass --wipe to delete those rows before calling hydrate.
//
// Usage:
//   tsx backfill-influencer-workspace.ts <influencerId> [--wipe]

function ts() {
  return new Date().toISOString().slice(11, 23);
}
function trace(msg: string, data?: unknown) {
  process.stdout.write(
    `[${ts()}] ${msg}${data !== undefined ? " " + JSON.stringify(data) : ""}\n`,
  );
}

async function main() {
  const idArg = Number(process.argv[2]);
  const wipe = process.argv.includes("--wipe");
  if (!Number.isFinite(idArg)) {
    console.error("usage: tsx backfill-influencer-workspace.ts <influencerId> [--wipe]");
    process.exit(1);
  }

  const [inf] = await db
    .select()
    .from(aiInfluencersTable)
    .where(eq(aiInfluencersTable.id, idArg))
    .limit(1);
  if (!inf) {
    console.error(`influencer ${idArg} not found`);
    process.exit(1);
  }
  if (!inf.avatarUrl) {
    console.error(`influencer ${idArg} has no avatar_url; cannot seed workspace`);
    process.exit(1);
  }
  trace("BACKFILL START", { influencerId: idArg, wipe, avatar: inf.avatarUrl });

  if (wipe) {
    const settings = await db
      .select({ id: influencerSettingsTable.id })
      .from(influencerSettingsTable)
      .where(eq(influencerSettingsTable.influencerId, idArg));
    if (settings.length > 0) {
      await db
        .delete(settingImagesTable)
        .where(inArray(settingImagesTable.settingId, settings.map((s) => s.id)));
    }
    await db.delete(influencerSettingsTable).where(eq(influencerSettingsTable.influencerId, idArg));
    await db.delete(influencerAnglesTable).where(eq(influencerAnglesTable.influencerId, idArg));
    trace("WIPED stale rows", { settings: settings.length });
  }

  trace("CALL hydrateIdentityWorkspace");
  const pipeline = await import("../lib/influencer-pipeline");
  await pipeline.hydrateIdentityWorkspace(idArg, inf.avatarUrl);
  trace("RETURNED hydrateIdentityWorkspace");

  const angles = await db
    .select({ id: influencerAnglesTable.id })
    .from(influencerAnglesTable)
    .where(eq(influencerAnglesTable.influencerId, idArg));
  const settings = await db
    .select({ id: influencerSettingsTable.id })
    .from(influencerSettingsTable)
    .where(eq(influencerSettingsTable.influencerId, idArg));
  let imgCount = 0;
  for (const s of settings) {
    const imgs = await db
      .select({ id: settingImagesTable.id })
      .from(settingImagesTable)
      .where(eq(settingImagesTable.settingId, s.id));
    imgCount += imgs.length;
  }
  trace("FINAL COUNTS", {
    angles: angles.length,
    settings: settings.length,
    settingImages: imgCount,
  });
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
