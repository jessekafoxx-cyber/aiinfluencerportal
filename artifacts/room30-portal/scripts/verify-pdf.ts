import { writeFileSync } from "node:fs";
import { generateVslMasterclassPdf } from "../src/lib/vsl-masterclass-pdf";

const doc = generateVslMasterclassPdf();
const buf = Buffer.from(doc.output("arraybuffer"));
const out = "/tmp/vsl-masterclass-verify.pdf";
writeFileSync(out, buf);

const text = buf.toString("latin1");
const literals = [
  "Page 1 of ",
  "Chapter Index",
  "VSL MASTERCLASS",
  "PROMPT & BUILD",
  "VSL Masterclass",
];
const literalChecks = Object.fromEntries(
  literals.map((s) => [
    s,
    (
      text.match(
        new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      ) || []
    ).length,
  ]),
);

console.log(
  JSON.stringify(
    {
      filename: out,
      size: buf.length,
      magicOk: buf.slice(0, 4).toString() === "%PDF",
      pageCount: doc.getNumberOfPages(),
      literalChecks,
    },
    null,
    2,
  ),
);
