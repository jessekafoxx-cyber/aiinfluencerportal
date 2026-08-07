// One-shot Steph masterclass knowledge ingest. Run with:
//   cd artifacts/api-server && pnpm exec tsx scripts/run-support-knowledge-ingest.ts
import { ingestSupportKnowledge } from "../src/support-bot/knowledge-ingest";

async function main() {
  const summary = await ingestSupportKnowledge();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
