import { startBackgroundMusicImport, getBackgroundMusicJob } from "../src/lib/dfy-background-music-importer";

async function main() {
  const job = startBackgroundMusicImport();
  console.log("started job", job.id);
  while (true) {
    await new Promise(r => setTimeout(r, 3000));
    const j = getBackgroundMusicJob(job.id);
    if (!j) { console.log("job missing"); break; }
    console.log(`status=${j.status} processed=${j.processed}/${j.total} added=${j.added} updated=${j.updated} skipped=${j.skipped} failed=${j.failed} msg=${j.message} err=${j.error || ""}`);
    if (j.status === "done" || j.status === "failed") break;
  }
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
