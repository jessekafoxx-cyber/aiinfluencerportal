import { Resend } from "resend";
import { db, emailLogsTable } from "@workspace/db";
import {
  DEFAULT_FROM_EMAIL,
  resolveFromEmail,
  bodyToHtml,
  getBrandConfig,
  type EmailBrand,
} from "./email-render";

export {
  DEFAULT_FROM_EMAIL,
  resolveFromEmail,
  bodyToHtml,
  getBrandConfig,
  type EmailBrand,
} from "./email-render";

type ResendCredentials = { apiKey: string; fromEmail: string };

type ConnectorSettings = {
  api_key?: string;
  from_email?: string;
};

type ConnectorItem = {
  settings?: ConnectorSettings;
};

type ConnectorResponse = {
  items?: ConnectorItem[];
};

let cachedSettings: ResendCredentials | null = null;
let cachedAt = 0;
const CREDENTIAL_TTL_MS = 60_000;

async function getCredentials(): Promise<ResendCredentials> {
  // Prefer the project's explicit key in both preview and production. A
  // connector is optional when Resend is configured through Replit Secrets.
  const apiKeyFromEnv = process.env.RESEND_API_KEY?.trim();
  if (apiKeyFromEnv) {
    return { apiKey: apiKeyFromEnv, fromEmail: resolveFromEmail(undefined) };
  }
  if (cachedSettings && Date.now() - cachedAt < CREDENTIAL_TTL_MS) {
    return cachedSettings;
  }
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;

  if (!hostname || !xReplitToken) {
    throw new Error("Replit connector credentials not available for Resend");
  }

  const res = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=resend`,
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    },
  );
  if (!res.ok) {
    throw new Error(`Resend connector lookup failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as ConnectorResponse;
  const item = data.items?.[0];
  const apiKey = item?.settings?.api_key;
  if (!apiKey) {
    throw new Error("Resend not connected");
  }
  const fromEmail = resolveFromEmail(item?.settings?.from_email);
  cachedSettings = { apiKey, fromEmail };
  cachedAt = Date.now();
  return cachedSettings;
}

export async function getUncachableResendClient(): Promise<{
  client: Resend;
  fromEmail: string;
}> {
  const { apiKey, fromEmail } = await getCredentials();
  return { client: new Resend(apiKey), fromEmail };
}

export type SendEmailOptions = {
  userId?: number | null;
  email: string;
  subject: string;
  body: string;
  // Optional HTML to render inside the branded card. When set, this replaces
  // the auto-converted plain-text body so callers can include rich elements
  // like buttons. The plain-text "body" still gets used as the text/plain
  // alternative for clients that strip HTML.
  bodyHtml?: string;
  templateType: string;
  metadata?: Record<string, unknown> | null;
  from?: string;
  replyTo?: string;
  sentAt?: Date;
  // Optional redacted body to write to email_logs.body. Use for emails
  // that contain transient secrets (one-time passwords, magic links)
  // that we do not want to keep in the database forever. The real
  // body and bodyHtml are still sent to the recipient as normal.
  logBody?: string;
  // Optional file attachments forwarded to Resend. Use a Buffer for binary
  // payloads (PDFs, etc) — Resend SDK accepts the Buffer directly under
  // `content` and base64-encodes it on send.
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
  // Brand wrapper to render around the email. Always renders as
  // Room30 AI (Task #661). The parameter is kept for back-compat with
  // call sites that still thread a brand through (legacy `"main"` is
  // accepted but routes to the Room30 shell).
  brand?: EmailBrand;
};

export type SendEmailResult = {
  status: "sent" | "failed";
  messageId: string | null;
  error?: string;
};

export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const recipient = opts.email.trim().toLowerCase();
  const sentAt = opts.sentAt ?? new Date();

  let status: "sent" | "failed" = "sent";
  let messageId: string | null = null;
  let errorMessage: string | undefined;
  const extraMeta: Record<string, unknown> = {};

  try {
    const { client, fromEmail } = await getUncachableResendClient();
    // Every email is sent with the Room30 AI friendly From: name
    // (Task #661). `getBrandConfig` ignores the brand argument now,
    // but we still resolve through it so any future per-brand swap
    // would automatically pick up the right friendly name.
    const brandFrom = opts.brand ? getBrandConfig(opts.brand).fromEmail : fromEmail;
    const from = opts.from || brandFrom;
    const result = await client.emails.send({
      from,
      to: recipient,
      subject: opts.subject,
      text: opts.body,
      html: bodyToHtml(opts.body, opts.subject, opts.bodyHtml, opts.brand),
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      ...(opts.attachments && opts.attachments.length > 0
        ? {
            attachments: opts.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              ...(a.contentType ? { contentType: a.contentType } : {}),
            })),
          }
        : {}),
    });
    if (result.error) {
      status = "failed";
      const err = result.error;
      errorMessage = err.message || err.name || "Unknown Resend error";
      extraMeta.providerError = { name: err.name, message: err.message };
    } else {
      messageId = result.data?.id ?? null;
      extraMeta.provider = "resend";
    }
  } catch (err: unknown) {
    status = "failed";
    errorMessage = err instanceof Error ? err.message : String(err);
    extraMeta.providerError = errorMessage;
  }

  try {
    const mergedMetadata = {
      ...(opts.metadata || {}),
      ...extraMeta,
      ...(errorMessage ? { error: errorMessage } : {}),
    };
    await db.insert(emailLogsTable).values({
      userId: opts.userId ?? null,
      email: recipient,
      subject: opts.subject,
      body: opts.logBody ?? opts.body,
      templateType: opts.templateType,
      status,
      metadata: mergedMetadata,
      messageId,
      sentAt,
    });
  } catch (logErr) {
    console.error("Failed to write email_logs row:", logErr);
  }

  if (status === "failed") {
    console.error(
      `Email send failed (template=${opts.templateType}, to=${recipient}): ${errorMessage}`,
    );
  }

  return { status, messageId, error: errorMessage };
}
