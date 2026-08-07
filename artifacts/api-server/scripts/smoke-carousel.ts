// Smoke test: render a tiny carousel zip via the carousel-render lib.
// Run from artifacts/api-server: pnpm dlx tsx scripts/smoke-carousel.ts
import { renderCarouselToZip } from "../src/lib/carousel-render";
import { writeFileSync } from "node:fs";
import JSZip from "jszip";

async function main() {
  const slides = [
    {
      type: "cover" as const,
      headline: "The 3 prompts I run every Sunday",
      subhint: "(Swipe left for the breakdown)",
    },
    {
      type: "tweet" as const,
      body:
        "Most people show up Monday with no plan.\n\nI run the same 3 prompts every Sunday and walk into the week knowing exactly what to ship.",
    },
    {
      type: "tweet" as const,
      body:
        "Prompt 1: \"What did I learn this week that I want to lock in?\"\n\nWrite the answer raw. No edits. No filter.",
    },
    {
      type: "tweet" as const,
      body:
        "Want the full prompt set?\n\nI dropped them inside Room30 this week. Link in bio.",
    },
  ];
  const assets = {
    displayName: "Test User",
    handle: "@testuser",
    verified: true,
    profileImageUrl: "https://placehold.co/400x400/png",
  };

  // Tiny 1x1 transparent PNG so satori has a valid <img src> to embed
  const fakeImage =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const buf = await renderCarouselToZip(slides, assets, {
    resolveImage: async () => fakeImage,
  });
  writeFileSync("/tmp/carousel-smoke.zip", buf);

  // Inspect the zip to verify dimensions and contents
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).sort();
  console.log(`OK: wrote /tmp/carousel-smoke.zip (${buf.length} bytes), ${names.length} files`);
  for (const name of names) {
    const fileBuf = await zip.files[name].async("nodebuffer");
    // PNG IHDR chunk at byte 16: width/height as big-endian uint32
    const w = fileBuf.readUInt32BE(16);
    const h = fileBuf.readUInt32BE(20);
    console.log(`  ${name}: ${fileBuf.length} bytes, ${w}x${h}`);
    if (w !== 1080 || h !== 1350) {
      throw new Error(`Wrong dims for ${name}: ${w}x${h}`);
    }
  }
  console.log("All slides 1080x1350. PASS.");

  // SSRF guard test: default resolver must REJECT arbitrary URLs.
  let rejected = false;
  try {
    await renderCarouselToZip(
      [{ type: "tweet" as const, body: "test", bottomImageUrl: "http://169.254.169.254/latest/meta-data/" }],
      assets,
    );
  } catch (e: any) {
    rejected = /only \/api\/portal\/images/.test(String(e?.message || e));
  }
  if (!rejected) throw new Error("SSRF guard FAILED: arbitrary http URL was not rejected");
  console.log("SSRF guard PASS: arbitrary URLs rejected.");
}

main().catch((err) => {
  console.error("SMOKE FAIL:", err);
  process.exit(1);
});
