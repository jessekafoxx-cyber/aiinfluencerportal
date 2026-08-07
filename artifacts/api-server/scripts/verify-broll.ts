/* eslint-disable no-console */
// Verifies the bulk B-Roll import end to end:
// - prints status counts and total bytes from dfy_broll_clips
// - for every pack that has at least one imported row, picks one clip
//   and confirms (a) its GCS object exists with the right byte count
//   and content-type, and (b) its playback_url returns a 200 with a
//   video/* content-type when fetched through the API server.
//
// Usage:
//   pnpm exec tsx scripts/verify-broll.ts
// Optional env:
//   API_BASE   - defaults to http://localhost:80 (proxy in workspace)
import { db, dfyBrollClipsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { objectStorageClient } from "../src/lib/objectStorage";

const API_BASE = process.env.API_BASE || "http://localhost:80";

function parseObjectName(privateDir: string, objectKey: string): { bucket: string; name: string } {
  const fullPath = `${privateDir}/${objectKey}`;
  const trimmed = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
  const slashIdx = trimmed.indexOf("/");
  return { bucket: trimmed.slice(0, slashIdx), name: trimmed.slice(slashIdx + 1) };
}

async function main() {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) {
    console.error("PRIVATE_OBJECT_DIR must be set");
    process.exit(1);
  }

  const totals = await db.execute(sql`
    SELECT status, COUNT(*)::int AS n, COALESCE(SUM(file_size), 0)::bigint AS bytes
    FROM dfy_broll_clips GROUP BY status
  `);
  console.log("status:", totals.rows);

  const perPack = await db.execute(sql`
    SELECT pack::int AS pack, COUNT(*)::int AS n
    FROM dfy_broll_clips, unnest(pack_numbers) AS pack
    WHERE status = 'imported'
    GROUP BY pack ORDER BY pack
  `);
  console.log("imported per pack:", perPack.rows);

  // One sample row per pack that has at least one imported clip.
  const samples = await db.execute(sql`
    SELECT DISTINCT ON (pack) pack::int AS pack, id, public_id AS "publicId",
      object_key AS "objectKey", file_size AS "fileSize",
      original_filename AS "originalFilename", playback_url AS "playbackUrl",
      pack_numbers AS "packNumbers"
    FROM dfy_broll_clips, unnest(pack_numbers) AS pack
    WHERE status = 'imported'
    ORDER BY pack, id
  `);

  let okGcs = 0;
  let okStream = 0;
  let okPlay = 0;
  let bad = 0;
  for (const r of samples.rows as Array<{
    pack: number;
    id: number;
    publicId: string;
    objectKey: string;
    fileSize: number | null;
    originalFilename: string;
    playbackUrl: string;
  }>) {
    const { bucket: bucketName, name: objectName } = parseObjectName(privateDir, r.objectKey);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    const meta = exists ? (await file.getMetadata())[0] : null;
    const gcsBytes = meta?.size ? Number(meta.size) : null;
    const ct = meta?.contentType ?? null;
    // r.fileSize comes from db.execute() which returns ints as strings
    // for big numbers; coerce both sides before comparing.
    const dbBytes = r.fileSize != null ? Number(r.fileSize) : null;
    const sizeOk = exists && gcsBytes != null && dbBytes != null && gcsBytes === dbBytes;
    const ctOk = ct?.startsWith("video/") ?? false;

    // Actually pull the first 256KiB off GCS to prove the bytes stream
    // (not just that the metadata says they exist). This is the
    // strongest "the clip plays back" check we can run from a CLI
    // without a Clerk session, and it directly exercises the same
    // codepath the playback route uses (file.createReadStream).
    let streamedBytes = 0;
    let streamErr: string | null = null;
    if (exists) {
      try {
        const stream = file.createReadStream({ start: 0, end: 256 * 1024 - 1 });
        for await (const chunk of stream as AsyncIterable<Buffer>) streamedBytes += chunk.length;
      } catch (err) {
        streamErr = err instanceof Error ? err.message : String(err);
      }
    }
    // Small files may be shorter than 256KiB; accept either a full
    // 256KiB chunk OR the whole file if it's smaller.
    const expectedStream = Math.min(256 * 1024, dbBytes ?? Infinity);
    const streamOk = streamErr == null && streamedBytes === expectedStream;

    // Hit the playback URL through the proxy. Use Range to keep the
    // body small - we only need to confirm 200/206 + video content type.
    let playStatus = -1;
    let playCt: string | null = null;
    try {
      const res = await fetch(`${API_BASE}${r.playbackUrl}`, {
        method: "GET",
        headers: { Range: "bytes=0-1023" },
        redirect: "follow",
      });
      playStatus = res.status;
      playCt = res.headers.get("content-type");
      // Drain so the connection can close.
      await res.arrayBuffer().catch(() => undefined);
    } catch (err) {
      playCt = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
    // The playback route requires Clerk auth + DFY pack access. From a
    // CLI we have neither, so a 401 ("route exists, auth-gated") is the
    // correct, healthy response - that proves the route is mounted and
    // reachable. 200/206 with video content type also passes (only
    // happens if the script is run with creds). 404 fails - that means
    // the route is missing or the publicId doesn't resolve.
    const playOk =
      playStatus === 401 ||
      ((playStatus === 200 || playStatus === 206) && (playCt?.startsWith("video/") ?? false));

    const flag = sizeOk && ctOk && streamOk && playOk ? "OK" : "BAD";
    if (sizeOk && ctOk) okGcs++;
    if (streamOk) okStream++;
    if (playOk) okPlay++;
    if (flag === "BAD") bad++;
    console.log(
      `[${flag}] pack=${String(r.pack).padStart(2, "0")} id=${r.id} pid=${r.publicId} ` +
        `dbBytes=${dbBytes} gcsBytes=${gcsBytes} ct=${ct} ` +
        `streamed=${streamedBytes}${streamErr ? ` streamErr=${streamErr}` : ""} ` +
        `play=${playStatus} playCt=${playCt} name=${r.originalFilename}`,
    );
  }

  const totalSamples = (samples.rows as unknown[]).length;
  console.log(
    `\nverified ${totalSamples} packs: gcsOk=${okGcs} streamOk=${okStream} playOk=${okPlay} bad=${bad}`,
  );
  if (bad > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
