// Pure body-builders for the post-purchase enrollment emails. Kept in a
// separate file (no DB / Clerk / Resend imports) so brand-regression unit
// tests can load them without pulling in `@workspace/db`. The runtime
// flow in `purchase-enrollment.ts` re-exports these for actual use.
//
// `brandLabel` is threaded in by the caller and defaults to "AI Influencer Portfolio"
// for back-compat with existing tests and any callsite that has not yet
// been threaded with a portal-aware label.

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

export function newAccountBodyHtml(
  email: string,
  ctaUrl: string,
  brandLabel: string = "AI Influencer Portfolio",
): string {
  const safeEmail = escapeHtml(email);
  const safeUrl = escapeHtml(ctaUrl);
  const safeBrand = escapeHtml(brandLabel);
  return `
    <p style="margin:0 0 18px 0;">Thanks for joining ${safeBrand}. Your account has been created and your training is unlocked.</p>
    <p style="margin:0 0 28px 0;">Click below to set your password using <strong style="color:#ffffff;">${safeEmail}</strong>, then step inside.</p>
    ${ctaButton(ctaUrl, "Set Up Your Account")}
    <p style="margin:0 0 8px 0;font-size:13px;color:rgba(255,255,255,0.55);">If the button does not work, copy and paste this link into your browser:</p>
    <p style="margin:0 0 24px 0;font-size:13px;word-break:break-all;"><a href="${safeUrl}" style="color:#C9A44C;text-decoration:underline;">${safeUrl}</a></p>
    <p style="margin:0 0 6px 0;font-size:13px;color:rgba(255,255,255,0.55);">Already have a ${safeBrand} account? You can log in with the same email and your new training will appear automatically.</p>
    <p style="margin:24px 0 0 0;">See you inside.<br /><span style="color:rgba(255,255,255,0.55);">The ${safeBrand} team</span></p>
  `;
}

export function existingAccountBodyHtml(
  signInUrl: string,
  brandLabel: string = "AI Influencer Portfolio",
): string {
  const safeUrl = escapeHtml(signInUrl);
  const safeBrand = escapeHtml(brandLabel);
  return `
    <p style="margin:0 0 18px 0;">Thanks for the purchase. Your new training is unlocked under the same ${safeBrand} account you already use.</p>
    ${ctaButton(signInUrl, "Open The Portal")}
    <p style="margin:0 0 8px 0;font-size:13px;color:rgba(255,255,255,0.55);">If the button does not work, copy and paste this link into your browser:</p>
    <p style="margin:0 0 24px 0;font-size:13px;word-break:break-all;"><a href="${safeUrl}" style="color:#C9A44C;text-decoration:underline;">${safeUrl}</a></p>
    <p style="margin:24px 0 0 0;">See you inside.<br /><span style="color:rgba(255,255,255,0.55);">The ${safeBrand} team</span></p>
  `;
}
