// Task #742 one-shot sanity check for the Drive URL normaliser.
// Not a real test runner - just prints PASS/FAIL for each case so we
// know the helper handles every shape Greg pastes into the form.
//
//   pnpm --filter @workspace/scripts exec tsx ./src/check-drive-image-url.ts

import {
  normalizeDriveImageUrl,
  ensureAbsoluteUrl,
} from "../../artifacts/api-server/src/lib/drive-image-url";

const FILE_ID = "1WpR_oHjgXOW-qNrc6YwFu8AidhtipuMJ";
const DIRECT = `https://lh3.googleusercontent.com/d/${FILE_ID}=s2048`;

const cases: Array<{ name: string; input: string | null; expected: string | null }> = [
  { name: "file/d/<id>/view", input: `https://drive.google.com/file/d/${FILE_ID}/view`, expected: DIRECT },
  { name: "file/d/<id>/view?usp=sharing", input: `https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`, expected: DIRECT },
  { name: "file/d/<id>/preview", input: `https://drive.google.com/file/d/${FILE_ID}/preview`, expected: DIRECT },
  { name: "open?id=", input: `https://drive.google.com/open?id=${FILE_ID}`, expected: DIRECT },
  { name: "uc?id=", input: `https://drive.google.com/uc?id=${FILE_ID}`, expected: DIRECT },
  { name: "uc?export=view&id=", input: `https://drive.google.com/uc?export=view&id=${FILE_ID}`, expected: DIRECT },
  { name: "thumbnail?id=", input: `https://drive.google.com/thumbnail?id=${FILE_ID}&sz=w1600`, expected: DIRECT },
  { name: "docs.google.com host", input: `https://docs.google.com/file/d/${FILE_ID}/view`, expected: DIRECT },
  { name: "raw https png pass-through", input: "https://example.com/foo.png", expected: "https://example.com/foo.png" },
  { name: "GCS URL pass-through", input: "https://storage.googleapis.com/bucket/foo.webp", expected: "https://storage.googleapis.com/bucket/foo.webp" },
  { name: "null input", input: null, expected: null },
  { name: "empty string", input: "", expected: "" },
  { name: "garbage input", input: "not-a-url", expected: "not-a-url" },
];

let failed = 0;
for (const c of cases) {
  const got = normalizeDriveImageUrl(c.input);
  const ok = got === c.expected;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
  if (!ok) console.log(`        expected: ${c.expected}\n        got:      ${got}`);
}

const absCases: Array<{ name: string; input: string | null; expected: string | null }> = [
  { name: "bare host+path → https://", input: "app.gohighlevel.com/v2/preview/abc", expected: "https://app.gohighlevel.com/v2/preview/abc" },
  { name: "already https pass-through", input: "https://app.gohighlevel.com/x", expected: "https://app.gohighlevel.com/x" },
  { name: "http pass-through", input: "http://example.com/x", expected: "http://example.com/x" },
  { name: "protocol-relative → https:", input: "//cdn.example.com/x.png", expected: "https://cdn.example.com/x.png" },
  { name: "null", input: null, expected: null },
  { name: "empty", input: "", expected: null },
  { name: "non-url junk pass-through", input: "not a url", expected: "not a url" },
];
for (const c of absCases) {
  const got = ensureAbsoluteUrl(c.input);
  const ok = got === c.expected;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ensureAbsoluteUrl: ${c.name}`);
  if (!ok) console.log(`        expected: ${c.expected}\n        got:      ${got}`);
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed.");
