// Email ownership verification for support-bot refunds. The chat
// widget is anonymous, so before issuing a refund we email a one-time
// 6-digit code to the checkout email and require the customer to paste
// it back in the chat. This stops a third party who merely knows a
// buyer's email from triggering refunds (griefing: money only ever
// returns to the buyer's own card, but access would be revoked).
//
// State lives in the session metadata: only a sha256 hash of the code
// is stored, keyed to the session + email so a code can't be replayed
// across sessions or after the customer switches email mid-chat.

import { createHash, randomInt } from "crypto";
import { sendEmail } from "../lib/email";
import { logger } from "../lib/logger";

export const REFUND_CODE_TTL_MS = 15 * 60 * 1000;
export const REFUND_CODE_MAX_ATTEMPTS = 5;
export const REFUND_CODE_RESEND_COOLDOWN_MS = 60 * 1000;

export function generateRefundCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashRefundCode(
  sessionId: string,
  email: string,
  code: string,
): string {
  return createHash("sha256")
    .update(`${sessionId}:${email.trim().toLowerCase()}:${code}`)
    .digest("hex");
}

export function extractSixDigitCode(message: string): string | null {
  const match = message.match(/(?<!\d)(\d{6})(?!\d)/);
  return match ? match[1]! : null;
}

export function isResendRequest(message: string): boolean {
  return /resend|re-send|another code|new code|send (it|the code) again|didn'?t (get|arrive|receive|come)|(no|not?) (code|email)|nothing (arrived|came)|haven'?t (got|received)/i.test(
    message,
  );
}

export function isCodeExpired(sentAtIso: string): boolean {
  const sentAt = Date.parse(sentAtIso);
  return !Number.isFinite(sentAt) || Date.now() - sentAt > REFUND_CODE_TTL_MS;
}

export function isResendCoolingDown(sentAtIso: string): boolean {
  const sentAt = Date.parse(sentAtIso);
  return (
    Number.isFinite(sentAt) &&
    Date.now() - sentAt < REFUND_CODE_RESEND_COOLDOWN_MS
  );
}

export async function sendRefundCodeEmail(
  email: string,
  code: string,
  sessionId: string,
): Promise<boolean> {
  try {
    const result = await sendEmail({
      email: email.trim().toLowerCase(),
      subject: `${code} is your refund confirmation code`,
      body:
        `Hey,\n\n` +
        `You (or someone in our support chat) asked to refund the masterclass on this email address.\n\n` +
        `Your confirmation code is: ${code}\n\n` +
        `Paste it into the support chat to confirm the refund. The code expires in 15 minutes.\n\n` +
        `If you didn't ask for a refund, you can safely ignore this email - nothing happens without the code.\n\n` +
        `AI Influencer Portfolio Support`,
      templateType: "support_bot_refund_code",
      metadata: { sessionId, purpose: "refund_verification" },
    });
    return result.status === "sent";
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), sessionId },
      "[support-bot] refund verification code email failed",
    );
    return false;
  }
}
