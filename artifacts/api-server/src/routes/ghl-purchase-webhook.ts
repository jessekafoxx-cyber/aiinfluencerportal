/**
 * GoHighLevel purchase webhook (template-ready, DB-configured secret).
 *
 *   POST /api/public/webhooks/ghl?secret=whsec_...
 *   Body: { email, name?, product, action? }   action: "grant" (default) | "revoke"
 *
 * The shared secret is generated per-install and stored in app_settings
 * (see lib/ghl-settings.ts); it can also be presented via the
 * X-Webhook-Secret header or Authorization: Bearer. Every delivery —
 * accepted or rejected — is logged to webhook_events for the admin
 * "API & Webhooks" page.
 *
 * This supersedes the legacy env-secret webhooks (/portal/ghl/enroll and
 * friends): products are looked up by slug in the products table, so a
 * client duplicating this template only configures things in the admin UI.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { db, webhookEventsTable } from "@workspace/db";
import { getWebhookSecret, secretsMatch } from "../lib/ghl-settings";
import {
  findProductBySlug,
  findOrCreateUserByEmail,
  grantProductToUser,
  revokeProductFromUser,
  normalizeEmail,
} from "../lib/ghl-entitlements";

const router: IRouter = Router();

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(240).optional(),
  product: z.string().trim().min(1).max(200),
  action: z.enum(["grant", "revoke"]).optional().default("grant"),
});

function presentedSecret(req: Request): string {
  const q = typeof req.query.secret === "string" ? req.query.secret : "";
  if (q) return q.trim();
  const h = req.header("x-webhook-secret");
  if (h) return h.trim();
  const auth = req.header("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

async function logEvent(fields: {
  status: string;
  email?: string | null;
  productSlug?: string | null;
  payload?: Record<string, unknown>;
  detail?: string;
}) {
  try {
    await db.insert(webhookEventsTable).values({
      source: "ghl",
      status: fields.status,
      email: fields.email ?? null,
      productSlug: fields.productSlug ?? null,
      payload: fields.payload ?? undefined,
      detail: fields.detail ?? null,
    });
  } catch {
    // Logging must never break webhook processing.
  }
}

// Strip anything secret-shaped (recursively) before persisting the payload
// for the admin delivery log.
function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/secret|token|password|authorization|api[_-]?key/i.test(k)) continue;
      out[k] = sanitizeValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

function sanitizePayload(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return sanitizeValue(body, 0) as Record<string, unknown>;
}

router.post("/public/webhooks/ghl", async (req: Request, res: Response) => {
  const payload = sanitizePayload(req.body);
  try {
    const expected = await getWebhookSecret();
    const presented = presentedSecret(req);
    if (!presented || !secretsMatch(presented, expected)) {
      await logEvent({ status: "rejected", payload, detail: "bad_secret" });
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // GHL workflows sometimes wrap Custom Data — flatten common wrappers.
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...raw };
    for (const key of ["customData", "custom_data", "data", "payload"]) {
      const v = raw[key];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          if (merged[k] === undefined) merged[k] = val;
        }
      }
    }
    // Unrendered {{contact.x}} tokens → treat as missing.
    for (const k of Object.keys(merged)) {
      const v = merged[k];
      if (typeof v === "string" && /^\{\{[^}]+\}\}$/.test(v.trim())) merged[k] = undefined;
    }

    const parsed = bodySchema.safeParse(merged);
    if (!parsed.success) {
      await logEvent({
        status: "rejected",
        payload,
        detail: `invalid_body: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      });
      return res.status(400).json({ ok: false, error: "invalid_body", issues: parsed.error.issues });
    }

    const { email, name, product: productSlug, action } = parsed.data;
    const product = await findProductBySlug(productSlug);
    if (!product) {
      await logEvent({ status: "rejected", email, productSlug, payload, detail: "unknown_product" });
      return res.status(404).json({ ok: false, error: "unknown_product", product: productSlug });
    }
    if (!product.active && action === "grant") {
      await logEvent({ status: "ignored", email, productSlug, payload, detail: "product_inactive" });
      return res.status(409).json({ ok: false, error: "product_inactive", product: productSlug });
    }

    if (action === "revoke") {
      const { user } = await findOrCreateUserByEmail(email, name);
      const revoked = await revokeProductFromUser(user, product);
      await logEvent({
        status: "processed",
        email,
        productSlug,
        payload,
        detail: revoked.length ? `revoked: ${revoked.join(", ")}` : "revoke_noop (no active purchase)",
      });
      return res.status(200).json({ ok: true, action: "revoke", email: normalizeEmail(email), product: product.slug, revoked });
    }

    const { user, created } = await findOrCreateUserByEmail(email, name);
    const receiptId =
      typeof merged.ghlOrderId === "string" && merged.ghlOrderId.trim()
        ? merged.ghlOrderId.trim()
        : undefined;
    const result = await grantProductToUser(user, product, {
      source: "webhook",
      receiptId,
      metadata: { via: "ghl_webhook" },
    });
    await logEvent({
      status: "processed",
      email,
      productSlug,
      payload,
      detail: result.alreadyGranted
        ? "grant_noop (already granted)"
        : `granted: ${result.granted.join(", ") || "(none)"}${created ? "; user created" : ""}`,
    });
    return res.status(200).json({
      ok: true,
      action: "grant",
      email: normalizeEmail(email),
      product: product.slug,
      granted: result.granted,
      alreadyGranted: result.alreadyGranted,
      userCreated: created,
    });
  } catch (err) {
    req.log?.error?.(
      { event: "ghl_purchase_webhook_error", err: err instanceof Error ? err.message : String(err) },
      "[ghl-purchase-webhook] failed",
    );
    await logEvent({ status: "error", payload, detail: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
