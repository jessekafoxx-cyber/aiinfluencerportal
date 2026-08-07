import { db, portalUsersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { sendEmail } from "./email";
import { getBrandBaseUrl } from "./brand-url";
import { logger } from "./logger";

// Every Room30 AI user has the first $10 of AI usage included in their
// purchase. We never mention this number anywhere in the product. Once the
// user crosses the threshold we send a one-time email and surface a
// dismissible banner + a "buy more credits" CTA in their settings.
export const AI_USAGE_FREE_CENTS = 1000;

type RecordOptions = {
  userId: number;
  cents: number;
  source: string;
};

// Best-effort: bumps ai_usage_cents and, on the same update, stamps
// ai_overlimit_notified_at the first time the user crosses the threshold.
// The CASE expression makes the stamp idempotent at the database layer so
// concurrent calls cannot trigger two notifications.
export async function recordAiUsage(opts: RecordOptions): Promise<void> {
  const { userId, cents, source } = opts;
  if (!userId || !Number.isFinite(cents) || cents <= 0) return;

  try {
    const [row] = await db
      .update(portalUsersTable)
      .set({
        aiUsageCents: sql`${portalUsersTable.aiUsageCents} + ${cents}`,
        aiOverlimitNotifiedAt: sql`CASE
          WHEN ${portalUsersTable.aiOverlimitNotifiedAt} IS NOT NULL
            THEN ${portalUsersTable.aiOverlimitNotifiedAt}
          WHEN ${portalUsersTable.aiUsageCents} + ${cents} >= ${AI_USAGE_FREE_CENTS}
            THEN NOW()
          ELSE NULL
        END`,
        updatedAt: new Date(),
      })
      .where(eq(portalUsersTable.id, userId))
      .returning({
        id: portalUsersTable.id,
        email: portalUsersTable.email,
        firstName: portalUsersTable.firstName,
        previous: sql<number>`(${portalUsersTable.aiUsageCents} - ${cents})::int`,
        current: portalUsersTable.aiUsageCents,
        notifiedAt: portalUsersTable.aiOverlimitNotifiedAt,
      });

    if (!row) return;

    // Send the one-time email only the first time we cross the line. We rely
    // on the previous value still being below the threshold to prevent
    // double-sends if two updates land in the same instant.
    const justCrossed =
      row.previous < AI_USAGE_FREE_CENTS &&
      row.current >= AI_USAGE_FREE_CENTS &&
      !!row.notifiedAt;

    if (justCrossed && row.email) {
      await sendOverlimitEmail({
        userId: row.id,
        email: row.email,
        firstName: row.firstName,
      });
    }

    logger.info(
      { userId, cents, source, totalCents: row.current, notified: !!row.notifiedAt },
      "ai_usage_recorded",
    );
  } catch (err: any) {
    logger.warn(
      { err: err?.message, userId, cents, source },
      "ai_usage_record_failed",
    );
  }
}

async function sendOverlimitEmail(opts: {
  userId: number;
  email: string;
  firstName: string | null;
}) {
  try {
    const baseUrl = getBrandBaseUrl();
    const settingsUrl = `${baseUrl}/portal/settings`;
    const greeting = opts.firstName ? `Hi ${escapeHtml(opts.firstName)},` : "Hi,";

    const bodyHtml = `
      <p style="margin:0 0 18px 0;">${greeting}</p>
      <p style="margin:0 0 18px 0;">Quick heads up. You have used your included AI credits across the portal AI tools.</p>
      <p style="margin:0 0 22px 0;">To keep generating research, ad copy, and the rest of the OS, top up your credits from the Settings page.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 28px auto;">
        <tr>
          <td align="center" style="border-radius:12px;background:linear-gradient(135deg,#7c3aed 0%,#a855f7 50%,#c026d3 100%);box-shadow:0 12px 32px rgba(124,58,237,0.35);">
            <a href="${settingsUrl}" style="display:inline-block;padding:16px 36px;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:bold;letter-spacing:0.18em;text-transform:uppercase;color:#ffffff;text-decoration:none;border-radius:12px;">
              Open Settings
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 12px 0;font-size:13px;color:rgba(255,255,255,0.55);">Your existing generations and saved work stay exactly where they are. Top-ups only unlock new generations.</p>
      <p style="margin:24px 0 0 0;">Keep building.<br /><span style="color:rgba(255,255,255,0.55);">The AI Influencer Portfolio team</span></p>
    `;

    const plain = [
      opts.firstName ? `Hi ${opts.firstName},` : "Hi,",
      "",
      "Quick heads up. You have used your included AI credits across the portal AI tools.",
      "",
      "To keep generating research, ad copy, and the rest of the OS, top up your credits from the Settings page.",
      "",
      `Open Settings: ${settingsUrl}`,
      "",
      "Your existing generations and saved work stay where they are. Top-ups only unlock new generations.",
      "",
      "Keep building.",
      "The AI Influencer Portfolio team",
    ].join("\n");

    await sendEmail({
      userId: opts.userId,
      email: opts.email,
      subject: "Your AI credits need a top up",
      body: plain,
      bodyHtml,
      templateType: "ai_credits_threshold",
      metadata: { thresholdCents: AI_USAGE_FREE_CENTS },
    });
  } catch (err: any) {
    logger.warn(
      { err: err?.message, userId: opts.userId },
      "ai_overlimit_email_failed",
    );
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
