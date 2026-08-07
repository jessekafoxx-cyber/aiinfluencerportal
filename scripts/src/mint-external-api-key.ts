/**
 * Mint a fresh External Admin API key directly against the DB.
 *
 * Use this as a fallback when the admin panel at
 * /members/admin/external-api is unreachable (or a partner agent like
 * GetViktor needs a new key right now and you don't want to log in
 * through the UI).
 *
 * Usage:
 *   DATABASE_URL=... pnpm --filter @workspace/scripts run mint:external-api-key -- <name>
 *
 * Against prod:
 *   DATABASE_URL=$PROD_DATABASE_URL pnpm --filter @workspace/scripts \
 *     run mint:external-api-key -- "viktor-2026-05-16"
 *
 * Prints the plaintext key exactly once. Copy it immediately; the DB
 * only stores the SHA-256 hash. Format: `gregk_<43 base64url chars>`.
 *
 * Mirrors the logic in
 * artifacts/api-server/src/routes/external-api.ts (POST /keys) and
 * artifacts/api-server/src/middlewares/requireExternalApiKey.ts
 * (hashExternalApiKey).
 */
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { externalApiKeysTable } from "@workspace/db/schema";

function hashExternalApiKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

async function main(): Promise<void> {
  const rawName = process.argv.slice(2).join(" ").trim();
  const name = rawName || `cli-mint-${new Date().toISOString().slice(0, 10)}`;
  if (name.length > 120) {
    console.error(`[mint] name too long (${name.length} > 120)`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("[mint] DATABASE_URL is required.");
    process.exit(1);
  }

  const raw = crypto.randomBytes(32).toString("base64url");
  const plaintext = `gregk_${raw}`;
  const keyHash = hashExternalApiKey(plaintext);
  const last4 = plaintext.slice(-4);

  const [row] = await db
    .insert(externalApiKeysTable)
    .values({
      keyHash,
      name,
      last4,
      createdByEmail: "cli:mint-external-api-key",
    })
    .returning({
      id: externalApiKeysTable.id,
      name: externalApiKeysTable.name,
      last4: externalApiKeysTable.last4,
      createdAt: externalApiKeysTable.createdAt,
    });

  console.log("");
  console.log("=== External Admin API key minted ===");
  console.log(`  id:        ${row!.id}`);
  console.log(`  name:      ${row!.name}`);
  console.log(`  last4:     ${row!.last4}`);
  console.log(`  createdAt: ${row!.createdAt.toISOString()}`);
  console.log("");
  console.log("  plaintext (shown ONCE - copy now):");
  console.log("");
  console.log(`    ${plaintext}`);
  console.log("");
  console.log("Send as: x-api-key: <plaintext>");
  console.log("");
  process.exit(0);
}

main().catch((err) => {
  console.error("[mint] failed:", err);
  process.exit(1);
});
