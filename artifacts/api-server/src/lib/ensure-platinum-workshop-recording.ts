import {
  db,
  workshopRecordingsTable,
  appSettingsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

// One-time seed for the 28 May 2026 Platinum Club workshop replay.
//
// Workshop recordings are database content, not code, so they never travel
// with a publish. This buyer-reported gap ("nothing in Recordings") was the
// production recordings table being empty for every Platinum member. The
// agent cannot write the production database directly, so we seed the row in
// code and let it materialise on the next publish (and immediately in dev on
// the next boot).
//
// SEED_KEY in app_settings makes this strictly one-time: once it has run we
// never insert again, so if an admin later deletes or edits the recording it
// will NOT be resurrected on the next restart.
const SEED_KEY = "workshop_recording_seed_vvm606zu40";
const WISTIA_MEDIA_ID = "vvm606zu40";
const TITLE = "Platinum Club Workshop - 28 May 2026";
const RECORDED_AT = new Date("2026-05-28T19:00:00.000Z");
const SUMMARY_HTML =
  "<p>This is the full replay of the live Platinum Club workshop from <strong>28 May 2026</strong>. Watch the recording above for the complete session.</p>";

export async function ensurePlatinumWorkshopRecording(): Promise<void> {
  try {
    // Claim the one-time guard FIRST so concurrent boots (e.g. overlapping
    // API processes during a rolling restart) can never both reach the insert
    // path. The atomic INSERT ... ON CONFLICT DO NOTHING acts as a mutex: only
    // the process that actually creates the app_settings row proceeds. Every
    // later boot finds the key already present and returns no claimed row, so
    // it skips - which also means an admin who later deletes the recording will
    // NOT have it resurrected.
    const claimed = await db
      .insert(appSettingsTable)
      .values({ key: SEED_KEY, value: new Date().toISOString() })
      .onConflictDoNothing()
      .returning({ key: appSettingsTable.key });

    if (claimed.length === 0) {
      logger.info(
        "ensurePlatinumWorkshopRecording: already seeded, skipping",
      );
      return;
    }

    const [existing] = await db
      .select()
      .from(workshopRecordingsTable)
      .where(eq(workshopRecordingsTable.wistiaMediaId, WISTIA_MEDIA_ID));

    if (!existing) {
      await db.insert(workshopRecordingsTable).values({
        title: TITLE,
        wistiaMediaId: WISTIA_MEDIA_ID,
        recordedAt: RECORDED_AT,
        summary: SUMMARY_HTML,
        publishedAt: RECORDED_AT,
        createdBy: "system-seed",
      });
      logger.info(
        { wistiaMediaId: WISTIA_MEDIA_ID },
        "ensurePlatinumWorkshopRecording: inserted + published recording",
      );
    } else if (!existing.publishedAt) {
      // A draft row already exists for this media id - publish it so members
      // can see the replay rather than inserting a duplicate.
      await db
        .update(workshopRecordingsTable)
        .set({ publishedAt: existing.recordedAt ?? RECORDED_AT })
        .where(eq(workshopRecordingsTable.id, existing.id));
      logger.info(
        { wistiaMediaId: WISTIA_MEDIA_ID },
        "ensurePlatinumWorkshopRecording: published pre-existing draft recording",
      );
    } else {
      logger.info(
        { wistiaMediaId: WISTIA_MEDIA_ID },
        "ensurePlatinumWorkshopRecording: recording already present and published",
      );
    }

    logger.info("ensurePlatinumWorkshopRecording: done");
  } catch (err) {
    logger.error({ err }, "ensurePlatinumWorkshopRecording: failed");
  }
}
