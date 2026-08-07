// Task #608 (review fix): encrypt the Calendly webhook signing key at
// rest in `crm_calendly_settings.webhook_signing_key`. The signing key
// is the only thing standing between an unauthenticated POST to
// /api/crm/webhooks/calendly and arbitrary contact / activity writes,
// so a plaintext-at-rest copy is treated like any other secret in
// this project (see facebook-cookies.ts for the same envelope).
//
// AES-256-GCM keyed off `CALENDLY_WEBHOOK_SECRET`. Backward-compatible
// read: if the stored bytes are not an envelope (legacy plaintext, or
// rows written before this helper existed) the bytes are returned
// verbatim so verification keeps working until the next subscribe call
// rewrites them.

import crypto from "node:crypto";

interface EncryptedBlob {
  alg: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  authTag: string;
}

function getKey(): Buffer {
  const raw = process.env.CALENDLY_WEBHOOK_SECRET;
  if (!raw) {
    throw new Error(
      "CALENDLY_WEBHOOK_SECRET env var is not set. Set it before subscribing the Calendly webhook.",
    );
  }
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function isCalendlyWebhookSecretConfigured(): boolean {
  return !!process.env.CALENDLY_WEBHOOK_SECRET;
}

export function encryptCalendlyWebhookKey(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const blob: EncryptedBlob = {
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    ciphertext: ct.toString("base64"),
    authTag: authTag.toString("base64"),
  };
  return JSON.stringify(blob);
}

/**
 * Decrypt the stored signing key. Returns the plaintext key for HMAC
 * verification. Falls through to verbatim text for legacy plaintext
 * rows so an existing subscription keeps verifying until the operator
 * re-subscribes and the row is rewritten as an envelope.
 */
export function decryptCalendlyWebhookKey(stored: string): string {
  const trimmed = stored.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed
        && typeof parsed === "object"
        && parsed.alg === "aes-256-gcm"
        && typeof parsed.iv === "string"
        && typeof parsed.ciphertext === "string"
        && typeof parsed.authTag === "string"
      ) {
        const key = getKey();
        const iv = Buffer.from(parsed.iv, "base64");
        const ct = Buffer.from(parsed.ciphertext, "base64");
        const authTag = Buffer.from(parsed.authTag, "base64");
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
      }
    } catch {
      // Not an envelope - fall through to legacy plaintext.
    }
  }
  return stored;
}
