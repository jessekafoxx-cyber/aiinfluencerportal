// Task #498: Code-driven application of the DFY-content schema bits that
// the API/worker depend on. The original symptom (#498) was that
// migrations 0041 (subfolder columns), 0042 (dfy_drive_subfolders table),
// 0044 (bridge_pages sheet sync columns) and 0045 (dfy_advertorial_pages
// table) had never landed on the connected DB. The Drive sync then
// crashed with `relation does not exist` on every run and emptied the
// portal.
//
// `drizzle-kit push` is gated on data-loss prompts and is not part of
// the API/worker boot, so a missed migration on prod can sit there
// silently. This boot hook idempotently applies the structural pieces
// the runtime needs (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT
// EXISTS / CREATE INDEX IF NOT EXISTS only - no UPDATE backfills, which
// per replit.md must go through the migration runner). It is a safety
// net so the runtime can self-heal a missing migration on any DB it is
// pointed at, including prod after Publish.
//
// Safe to keep across releases: every statement is a no-op once the
// underlying migration has landed.

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import { objectStorageClient } from "./objectStorage";

const STATEMENTS: { name: string; sql: ReturnType<typeof sql> }[] = [
  // 0042: dfy_drive_subfolders catalog
  {
    name: "create dfy_drive_subfolders",
    sql: sql`
      CREATE TABLE IF NOT EXISTS "dfy_drive_subfolders" (
        "id" serial PRIMARY KEY NOT NULL,
        "slug" text NOT NULL,
        "drive_subfolder_id" text NOT NULL,
        "name" text NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `,
  },
  {
    name: "index dfy_drive_subfolders_slug_drive_id_idx",
    sql: sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "dfy_drive_subfolders_slug_drive_id_idx"
        ON "dfy_drive_subfolders" ("slug", "drive_subfolder_id")
    `,
  },
  {
    name: "index dfy_drive_subfolders_slug_active_idx",
    sql: sql`
      CREATE INDEX IF NOT EXISTS "dfy_drive_subfolders_slug_active_idx"
        ON "dfy_drive_subfolders" ("slug", "is_active")
    `,
  },
  // 0041: subfolder columns on dfy_drive_assets
  {
    name: "alter dfy_drive_assets add subfolder cols",
    sql: sql`
      ALTER TABLE "dfy_drive_assets"
        ADD COLUMN IF NOT EXISTS "subfolder_drive_id" text,
        ADD COLUMN IF NOT EXISTS "subfolder_name" text
    `,
  },
  {
    name: "index dfy_drive_assets_slug_subfolder_idx",
    sql: sql`
      CREATE INDEX IF NOT EXISTS "dfy_drive_assets_slug_subfolder_idx"
        ON "dfy_drive_assets" ("slug", "subfolder_drive_id", "is_active", "sort_key")
    `,
  },
  // 0044: sheet-sync columns on dfy_bridge_pages
  {
    name: "alter dfy_bridge_pages add sheet-sync cols",
    sql: sql`
      ALTER TABLE "dfy_bridge_pages"
        ADD COLUMN IF NOT EXISTS "bonus_number" integer,
        ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'manual',
        ADD COLUMN IF NOT EXISTS "source_row_key" text
    `,
  },
  {
    name: "index dfy_bridge_pages_source_key_uq",
    sql: sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "dfy_bridge_pages_source_key_uq"
        ON "dfy_bridge_pages" ("source", "source_row_key")
        WHERE "source_row_key" IS NOT NULL
    `,
  },
  // lessons.status column (three-state visibility: published / coming_soon / draft)
  {
    name: "alter lessons add status col",
    sql: sql`
      ALTER TABLE "lessons"
        ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'published'
    `,
  },
  // 0045: dfy_advertorial_pages catalog
  {
    name: "create dfy_advertorial_pages",
    sql: sql`
      CREATE TABLE IF NOT EXISTS "dfy_advertorial_pages" (
        "id" serial PRIMARY KEY,
        "title" text NOT NULL,
        "description" text,
        "template_number" integer,
        "preview_url" text NOT NULL,
        "install_url" text,
        "preview_image_url" text,
        "sort_order" integer NOT NULL DEFAULT 0,
        "source" text NOT NULL DEFAULT 'manual',
        "source_row_key" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `,
  },
  {
    name: "index dfy_advertorial_pages_source_key_uq",
    sql: sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "dfy_advertorial_pages_source_key_uq"
        ON "dfy_advertorial_pages" ("source", "source_row_key")
        WHERE "source_row_key" IS NOT NULL
    `,
  },
];

export async function ensureDfySchemaApplied(): Promise<void> {
  let appliedCount = 0;
  for (const stmt of STATEMENTS) {
    try {
      await db.execute(stmt.sql);
      appliedCount += 1;
    } catch (err) {
      logger.error(
        {
          event: "ensure-dfy-schema-stmt-failed",
          stmt: stmt.name,
          err: err instanceof Error ? err.message : String(err),
        },
        `ensureDfySchemaApplied: statement failed (${stmt.name})`,
      );
    }
  }
  logger.info(
    {
      event: "ensure-dfy-schema-applied",
      applied: appliedCount,
      total: STATEMENTS.length,
    },
    `ensureDfySchemaApplied: ${appliedCount}/${STATEMENTS.length} idempotent DDL statements ran`,
  );
  await reactivateDfyDriveAssetsWithExistingObjects();
}

// Task #498: reactivation pass for dfy_drive_assets rows that were
// soft-deleted (is_active=false) but whose cached media still exists
// in object storage. We HEAD-check each row's original_object_key
// against GCS via @google-cloud/storage file.exists() before flipping
// is_active back to true so we never resurrect a row whose backing
// payload was actually purged. Covers both subfolder-mode slugs
// (e.g. 250-scenes) and flat-mode slugs (e.g. 100-ai-influencers).
// Capped per-call (REACTIVATE_LIMIT) and run with bounded
// concurrency (REACTIVATE_CONCURRENCY) so a large soft-deleted set
// can't block boot. Best-effort: any failure is logged and the
// importers proceed.
const REACTIVATE_LIMIT = 1000;
const REACTIVATE_CONCURRENCY = 8;

export async function reactivateDfyDriveAssetsWithExistingObjects(): Promise<void> {
  let candidates: Array<{ id: number; key: string }> = [];
  try {
    const rows: unknown = await db.execute(sql`
      SELECT "id", "original_object_key"
        FROM "dfy_drive_assets"
       WHERE "is_active" = false
         AND "original_object_key" IS NOT NULL
       LIMIT ${REACTIVATE_LIMIT}
    `);
    const list = (rows as { rows?: Array<{ id: number | string; original_object_key: string }> })
      ?.rows ?? [];
    candidates = list.map((r) => ({ id: Number(r.id), key: r.original_object_key }));
  } catch (err) {
    logger.warn(
      {
        event: "dfy-drive-assets-reactivate-query-failed",
        err: err instanceof Error ? err.message : String(err),
      },
      "dfy-drive-assets: reactivation candidate query failed (non-fatal)",
    );
    return;
  }

  if (candidates.length === 0) return;

  const privateDir = process.env["PRIVATE_OBJECT_DIR"] ?? "";
  if (!privateDir) {
    logger.info(
      { event: "dfy-drive-assets-reactivate-skipped" },
      "dfy-drive-assets: reactivation skipped (PRIVATE_OBJECT_DIR not set; the next periodic Drive sync will reconcile)",
    );
    return;
  }

  const parsed = privateDir.replace(/^\/+/, "").split("/");
  if (parsed.length < 1 || !parsed[0]) {
    logger.warn(
      { event: "dfy-drive-assets-reactivate-bad-private-dir", privateDir },
      "dfy-drive-assets: PRIVATE_OBJECT_DIR malformed; skipping reactivation",
    );
    return;
  }
  const bucketName = parsed[0];
  const prefix = parsed.slice(1).join("/");
  const bucket = objectStorageClient.bucket(bucketName);

  const reactivateIds: number[] = [];
  let checked = 0;
  let missing = 0;
  let errors = 0;

  const work = candidates.slice();
  await Promise.all(
    Array.from({ length: REACTIVATE_CONCURRENCY }, async () => {
      while (work.length) {
        const next = work.shift();
        if (!next) break;
        const objectName = prefix ? `${prefix}/${next.key}` : next.key;
        try {
          const [exists] = await bucket.file(objectName).exists();
          checked += 1;
          if (exists) reactivateIds.push(next.id);
          else missing += 1;
        } catch {
          errors += 1;
        }
      }
    }),
  );

  if (reactivateIds.length === 0) {
    logger.info(
      {
        event: "dfy-drive-assets-reactivate-noop",
        candidates: candidates.length,
        checked,
        missing,
        errors,
      },
      "dfy-drive-assets: reactivation pass found no rows whose object storage payload still exists",
    );
    return;
  }

  try {
    const result: unknown = await db.execute(sql`
      UPDATE "dfy_drive_assets"
         SET "is_active" = true,
             "updated_at" = now()
       WHERE "id" = ANY(${reactivateIds}::int[])
         AND "is_active" = false
    `);
    const rowCount =
      (result as { rowCount?: number | null } | null)?.rowCount ?? 0;
    logger.info(
      {
        event: "dfy-drive-assets-reactivated",
        rowCount,
        candidates: candidates.length,
        checked,
        missing,
        errors,
      },
      `dfy-drive-assets: reactivated ${rowCount} soft-deleted rows after verifying their object storage payload still exists`,
    );
  } catch (err) {
    logger.warn(
      {
        event: "dfy-drive-assets-reactivate-update-failed",
        err: err instanceof Error ? err.message : String(err),
      },
      "dfy-drive-assets: reactivation UPDATE (int[]) failed (non-fatal)",
    );
  }
}
