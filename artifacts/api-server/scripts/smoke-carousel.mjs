// Smoke test: render a tiny carousel zip via the carousel-render lib.
// Run with: node --enable-source-maps artifacts/api-server/scripts/smoke-carousel.mjs
import { renderCarouselToZip } from "../dist/carousel-render.mjs";
import { writeFileSync } from "node:fs";

async function main() {
  const slides = [
    {
      type: "cover",
      headline: "The 3 prompts I run every Sunday",
      subhint: "(Swipe left for the breakdown)",
    },
    {
      type: "tweet",
      body:
        "Most people show up Monday with no plan.\n\nI run the same 3 prompts every Sunday and walk into the week knowing exactly what to ship.",
    },
    {
      type: "tweet",
      body:
        "Prompt 1: \"What did I learn this week that I want to lock in?\"\n\nWrite the answer raw. No edits. No filter.",
    },
    {
      type: "tweet",
      body:
        "Want the full prompt set?\n\nI dropped them inside Room30 this week. Link in bio.",
    },
  ];
  const assets = {
    displayName: "Test User",
    handle: "@testuser",
    verified: true,
  };

  const fakeImage =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const buf = await renderCarouselToZip(slides, assets, {
    resolveImage: async () => fakeImage,
  });
  writeFileSync("/tmp/carousel-smoke.zip", buf);
  console.log(`OK: wrote /tmp/carousel-smoke.zip (${buf.length} bytes)`);
}

main().catch((err) => {
  console.error("SMOKE FAIL:", err);
  process.exit(1);
});
