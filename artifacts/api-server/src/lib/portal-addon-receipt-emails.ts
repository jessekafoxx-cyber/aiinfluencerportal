// Pure body-builder for portal sidebar add-on purchase receipt emails
// (Tasks #814, #816). Kept free of DB / Resend imports so it mirrors
// `purchase-enrollment-emails.ts` and can be unit-tested in isolation.
//
// Output is pure HTML (never raw markdown) and uses regular hyphens with
// spaces only - no em or en dashes - per the project style rules. The
// returned string is the inner card body; `sendEmail` wraps it in the
// shared AI Influencer Portfolio branded shell.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ctaButton(url: string, label: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 28px auto;">
      <tr>
        <td align="center" style="border-radius:12px;background:linear-gradient(135deg,#7c3aed 0%,#a855f7 50%,#c026d3 100%);box-shadow:0 12px 32px rgba(124,58,237,0.35);">
          <a href="${url}" style="display:inline-block;padding:16px 36px;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:bold;letter-spacing:0.18em;text-transform:uppercase;color:#ffffff;text-decoration:none;border-radius:12px;">
            ${label}
          </a>
        </td>
      </tr>
    </table>
  `;
}

export function portalAddonReceiptBodyHtml(opts: {
  productName: string;
  amountCents: number;
  ctaUrl: string;
  ctaLabel: string;
  /** When true the amount line reads "$X.XX / month" and copy reflects a membership. */
  recurring?: boolean;
  brandLabel?: string;
}): string {
  const brandLabel = opts.brandLabel ?? "AI Influencer Portfolio";
  const baseAmount = `$${(opts.amountCents / 100).toFixed(2)}`;
  const amountLabel = opts.recurring ? `${baseAmount} / month` : baseAmount;

  const safeUrl = escapeHtml(opts.ctaUrl);
  const safeBrand = escapeHtml(brandLabel);
  const safeAmount = escapeHtml(amountLabel);
  const safeProduct = escapeHtml(opts.productName);

  const intro = opts.recurring
    ? `Thanks for joining. Your <strong style="color:#ffffff;">${safeProduct}</strong> membership is active and ready inside your account.`
    : `Thanks for your purchase. Your <strong style="color:#ffffff;">${safeProduct}</strong> is unlocked and ready inside your account.`;

  const signoff = opts.recurring ? "Welcome to the club." : "Enjoy it.";

  return `
    <p style="margin:0 0 18px 0;">${intro}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 28px 0;border-collapse:separate;">
      <tr>
        <td style="padding:14px 18px;border:1px solid rgba(201,164,76,0.25);border-radius:12px;background:rgba(201,164,76,0.06);">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
            <tr>
              <td style="font-size:14px;color:rgba(255,255,255,0.75);">${safeProduct}</td>
              <td align="right" style="font-size:14px;font-weight:bold;color:#ffffff;">${safeAmount}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    ${ctaButton(opts.ctaUrl, opts.ctaLabel)}
    <p style="margin:0 0 8px 0;font-size:13px;color:rgba(255,255,255,0.55);">If the button does not work, copy and paste this link into your browser:</p>
    <p style="margin:0 0 24px 0;font-size:13px;word-break:break-all;"><a href="${safeUrl}" style="color:#C9A44C;text-decoration:underline;">${safeUrl}</a></p>
    <p style="margin:0 0 6px 0;font-size:13px;color:rgba(255,255,255,0.55);">Questions about your order? Just reply to this email and we will help you out.</p>
    <p style="margin:24px 0 0 0;">${signoff}<br /><span style="color:rgba(255,255,255,0.55);">The ${safeBrand} team</span></p>
  `;
}

// AI Influencer account rentals (the /rent matrix) get a payment receipt with
// rental-specific copy. Unlike the portal add-on receipt above, a rental does
// not unlock anything "inside your account" yet (setup + transfer takes a few
// working days), so the copy is a clean transaction receipt. The amount line
// reflects the recurring period (monthly vs annual) and the CTA is optional.
export function rentReceiptBodyHtml(opts: {
  productName: string;
  amountCents: number;
  billing: "monthly" | "annual";
  ctaUrl?: string;
  ctaLabel?: string;
  brandLabel?: string;
}): string {
  const brandLabel = opts.brandLabel ?? "AI Influencer Portfolio";
  const baseAmount = `$${(opts.amountCents / 100).toFixed(2)}`;
  const amountLabel =
    opts.billing === "annual" ? `${baseAmount} / year` : `${baseAmount} / month`;

  const safeBrand = escapeHtml(brandLabel);
  const safeAmount = escapeHtml(amountLabel);
  const safeProduct = escapeHtml(opts.productName);

  const ctaBlock =
    opts.ctaUrl && opts.ctaLabel
      ? `${ctaButton(opts.ctaUrl, opts.ctaLabel)}
    <p style="margin:0 0 24px 0;font-size:13px;color:rgba(255,255,255,0.55);">Prefer email? Reach our Done For You team any time at <a href="${escapeHtml(
      opts.ctaUrl,
    )}" style="color:#C9A44C;text-decoration:underline;">${escapeHtml(
      opts.ctaLabel,
    )}</a>.</p>`
      : "";

  return `
    <p style="margin:0 0 18px 0;">Thanks for your order. Your <strong style="color:#ffffff;">${safeProduct}</strong> is confirmed and your payment has cleared. Here is your receipt.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 28px 0;border-collapse:separate;">
      <tr>
        <td style="padding:14px 18px;border:1px solid rgba(201,164,76,0.25);border-radius:12px;background:rgba(201,164,76,0.06);">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
            <tr>
              <td style="font-size:14px;color:rgba(255,255,255,0.75);">${safeProduct}</td>
              <td align="right" style="font-size:14px;font-weight:bold;color:#ffffff;">${safeAmount}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    ${ctaBlock}
    <p style="margin:0 0 6px 0;font-size:13px;color:rgba(255,255,255,0.55);">Questions about your order? Just reply to this email and we will help you out.</p>
    <p style="margin:24px 0 0 0;">Thank you.<br /><span style="color:rgba(255,255,255,0.55);">The ${safeBrand} team</span></p>
  `;
}

// Influencer Generation credit top-ups (Task #818) are a variable-qty
// purchase rather than a single fixed-price add-on, so the receipt shows
// quantity, total paid, and the buyer's new available balance. Reuses the
// same shared helpers + branded shell as the add-on receipts above.
export function influencerCreditReceiptBodyHtml(opts: {
  qty: number;
  amountCents: number;
  newQuota: number | null;
  ctaUrl: string;
  ctaLabel: string;
  brandLabel?: string;
}): string {
  const brandLabel = opts.brandLabel ?? "AI Influencer Portfolio";
  const total = `$${(opts.amountCents / 100).toFixed(2)}`;
  const creditsLabel = `${opts.qty} Influencer Generation${opts.qty === 1 ? "" : "s"}`;

  const safeUrl = escapeHtml(opts.ctaUrl);
  const safeBrand = escapeHtml(brandLabel);
  const safeTotal = escapeHtml(total);
  const safeCredits = escapeHtml(creditsLabel);

  const balanceRow =
    typeof opts.newQuota === "number"
      ? `
      <tr>
        <td style="padding-top:10px;font-size:14px;color:rgba(255,255,255,0.75);">New balance</td>
        <td align="right" style="padding-top:10px;font-size:14px;font-weight:bold;color:#ffffff;">${escapeHtml(
          `${opts.newQuota} generation${opts.newQuota === 1 ? "" : "s"}`,
        )}</td>
      </tr>`
      : "";

  return `
    <p style="margin:0 0 18px 0;">Thanks for your purchase. Your <strong style="color:#ffffff;">${safeCredits}</strong> have been added to your account and are ready to use.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 28px 0;border-collapse:separate;">
      <tr>
        <td style="padding:14px 18px;border:1px solid rgba(201,164,76,0.25);border-radius:12px;background:rgba(201,164,76,0.06);">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
            <tr>
              <td style="font-size:14px;color:rgba(255,255,255,0.75);">${safeCredits}</td>
              <td align="right" style="font-size:14px;font-weight:bold;color:#ffffff;">${safeTotal}</td>
            </tr>
            ${balanceRow}
          </table>
        </td>
      </tr>
    </table>
    ${ctaButton(opts.ctaUrl, opts.ctaLabel)}
    <p style="margin:0 0 8px 0;font-size:13px;color:rgba(255,255,255,0.55);">If the button does not work, copy and paste this link into your browser:</p>
    <p style="margin:0 0 24px 0;font-size:13px;word-break:break-all;"><a href="${safeUrl}" style="color:#C9A44C;text-decoration:underline;">${safeUrl}</a></p>
    <p style="margin:0 0 6px 0;font-size:13px;color:rgba(255,255,255,0.55);">Questions about your order? Just reply to this email and we will help you out.</p>
    <p style="margin:24px 0 0 0;">Enjoy it.<br /><span style="color:rgba(255,255,255,0.55);">The ${safeBrand} team</span></p>
  `;
}
