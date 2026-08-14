// Pure rendering + from-address helpers for outbound email. Kept in a
// separate file (no DB / Resend imports) so unit tests can load them
// without pulling in `@workspace/db`. `email.ts` re-exports these for the
// rest of the app, so existing import paths keep working.

// All outbound email renders as Room30 AI (Task #661). The historical
// `"main"` brand (Apex Offers) was retired with the funnel migration
// (Task #491) and the email layer now refuses to render an Apex shell
// regardless of what legacy callers still pass. The `EmailBrand` type
// is kept (and still accepts `"main"`) so the dozens of existing call
// sites that thread a brand through compile without churn, but every
// value resolves to the Room30 config below.
export type EmailBrand = "room30" | "main";

type BrandConfig = {
  fromEmail: string;
  // Text wordmark rendered at the top of every email. We render type
  // rather than an image asset so the header never depends on a
  // hosted logo file being reachable from the recipient's client.
  wordmark: string;
  kicker: string;
  footerCopy: string;
};

const ROOM30_CONFIG: BrandConfig = {
  fromEmail: "AI Influencer Portfolio <team@aiinfluencerpublishing.com>",
  wordmark: "AI Influencer Portfolio",
  kicker: "AI Influencer Portfolio",
  footerCopy:
    "You are receiving this because you have an account in your member portal.<br />AI Influencer Portfolio.",
};

export function getBrandConfig(_brand?: EmailBrand): BrandConfig {
  // Every brand routes to Room30 (Task #661). The `_brand` argument is
  // accepted for back-compat with callers that still pass `"main"`.
  return ROOM30_CONFIG;
}

// Hard-coded default so emails always go from a Resend-verified address even
// if the integration's "from_email" still points at an old, unverified domain.
// Override with RESEND_FROM_EMAIL if you ever change the verified sender.
export const DEFAULT_FROM_EMAIL = ROOM30_CONFIG.fromEmail;

export function resolveFromEmail(
  connectorFromEmail: string | undefined,
  _brand: EmailBrand = "room30",
): string {
  const envOverride = process.env.RESEND_FROM_EMAIL?.trim();
  if (envOverride) return envOverride;
  // Only trust the connector value if it points at the verified sending
  // subdomain (users.room30.ai) AND its friendly name is not a legacy
  // brand (Task #661). A connector still configured with e.g.
  // `Apex Offers <team@users.room30.ai>` would otherwise leak a stale
  // display name into the inbox From: header even though the address
  // itself is on the verified domain. Only the display-name portion is
  // inspected so the verified sending domain never trips the check.
  if (connectorFromEmail && /users\.room30\.ai>?\s*$/i.test(connectorFromEmail)) {
    const displayName = connectorFromEmail.split("<")[0] ?? "";
    if (!/apex/i.test(displayName) && !/room\s*30/i.test(displayName)) {
      return connectorFromEmail;
    }
  }
  return ROOM30_CONFIG.fromEmail;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function bodyToHtml(
  text: string,
  subject: string,
  customBodyHtml?: string,
  _brand: EmailBrand = "room30",
): string {
  const cfg = ROOM30_CONFIG;

  const bodyHtml = customBodyHtml ?? escapeHtml(text).replace(/\r?\n/g, "<br />");
  const preheader = escapeHtml(subject).slice(0, 140);

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="dark only" />
<meta name="supported-color-schemes" content="dark only" />
<title>${escapeHtml(subject)}</title>
<style>
  :root { color-scheme: dark only; supported-color-schemes: dark only; }
  @media only screen and (max-width: 620px) {
    .ao-card { padding: 28px 22px !important; }
    .ao-outer { padding: 24px 12px 16px 12px !important; }
    .ao-logo { width: 140px !important; }
  }
  /* Gmail mobile auto-inversion guard: when Gmail recolors the email
     for "light mode" it wraps content in [data-ogsc]/[data-ogsb]; we
     re-pin the dark palette so the white logo and white headlines
     stay visible. */
  [data-ogsc] body, [data-ogsb] body { background:#0A0A0A !important; color:#ffffff !important; }
  [data-ogsc] .ao-bg, [data-ogsb] .ao-bg { background:#0A0A0A !important; }
  [data-ogsc] .ao-card, [data-ogsb] .ao-card { background:#141417 !important; color:#E8E8E8 !important; }
  [data-ogsc] .ao-headline, [data-ogsb] .ao-headline { color:#ffffff !important; }
  [data-ogsc] .ao-body, [data-ogsb] .ao-body { color:#E8E8E8 !important; }
  a { color: #C9A44C; }
</style>
</head>
<body bgcolor="#0A0A0A" style="margin:0;padding:0;background:#0A0A0A;font-family:Helvetica,Arial,sans-serif;color:#ffffff;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<span style="display:none !important;visibility:hidden;mso-hide:all;font-size:1px;color:#0A0A0A;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>
<table role="presentation" class="ao-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0A0A0A" style="background:#0A0A0A;width:100%;">
  <tr>
    <td class="ao-outer ao-bg" align="center" bgcolor="#0A0A0A" style="padding:40px 20px 24px 20px;background:#0A0A0A;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
        <tr>
          <td align="center" bgcolor="#0A0A0A" style="padding:18px 0 28px 0;background:#0A0A0A;border-radius:12px;">
            <div class="ao-logo" style="font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.3;letter-spacing:0.18em;text-transform:uppercase;color:#ffffff;font-weight:bold;">
              ${escapeHtml(cfg.wordmark)}
            </div>
          </td>
        </tr>
        <tr>
          <td class="ao-card" style="background:#141417;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:36px 34px;">
            <div style="height:3px;width:48px;background:#C9A44C;margin:0 0 24px 0;border-radius:2px;line-height:3px;font-size:0;">&nbsp;</div>
            <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.4;letter-spacing:0.22em;text-transform:uppercase;color:#C9A44C;font-weight:bold;margin-bottom:14px;">
              ${escapeHtml(cfg.kicker)}
            </div>
            <h1 class="ao-headline" style="margin:0 0 18px 0;font-family:Helvetica,Arial,sans-serif;font-size:22px;line-height:1.25;letter-spacing:0.01em;text-transform:uppercase;color:#ffffff;font-weight:bold;">
              ${escapeHtml(subject)}
            </h1>
            <div class="ao-body" style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#E8E8E8;">
              ${bodyHtml}
            </div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:28px 20px 8px 20px;">
            <span style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#C9A44C;font-weight:bold;">
              ${escapeHtml(cfg.kicker)}
            </span>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:6px 20px 32px 20px;">
            <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.32);line-height:1.6;">
              ${cfg.footerCopy}
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// The "from" identity used for every Clerk-originated email we relay through
// Resend. The address must live on the Resend-verified subdomain
// (users.room30.ai) so deliverability matches the portal invite emails
// that already land cleanly in inbox.
