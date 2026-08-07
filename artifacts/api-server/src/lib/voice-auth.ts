import { createHmac, timingSafeEqual } from "node:crypto";

if (!process.env.SESSION_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[voice-auth] FATAL: SESSION_SECRET must be set in production. Voice tokens cannot be safely signed without it.",
    );
  }
  console.warn(
    "[voice-auth] WARNING: SESSION_SECRET is not set. Using insecure dev-only fallback. DO NOT deploy.",
  );
}

const SECRET =
  process.env.SESSION_SECRET || "dev-only-internal-secret-do-not-use-in-prod";

const TOKEN_TTL_SECONDS = 30 * 60;

export interface VoiceTokenPayload {
  userId: number;
  clerkId: string;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payloadB64: string): string {
  return b64url(createHmac("sha256", SECRET).update(payloadB64).digest());
}

export function mintVoiceToken(payload: Omit<VoiceTokenPayload, "exp">): string {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const body: VoiceTokenPayload = { ...payload, exp };
  const payloadB64 = b64url(JSON.stringify(body));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyVoiceToken(token: string | undefined | null): VoiceTokenPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expected = sign(payloadB64);
  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(sig);
  if (expectedBuf.length !== sigBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, sigBuf)) return null;
  let body: VoiceTokenPayload;
  try {
    body = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof body?.exp !== "number" || Math.floor(Date.now() / 1000) >= body.exp) {
    return null;
  }
  if (typeof body.userId !== "number" || typeof body.clerkId !== "string") {
    return null;
  }
  return body;
}

export const VOICE_TOKEN_TTL_SECONDS = TOKEN_TTL_SECONDS;
