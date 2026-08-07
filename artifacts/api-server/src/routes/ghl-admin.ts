/**
 * Admin API for the GoHighLevel template surfaces:
 *
 *   - GHL connection (Private Integration token + Location ID; token is
 *     verified on save and never returned to the frontend)
 *   - Purchase-webhook secret (view + rotate) and delivery log
 *   - Products catalog CRUD + one-click import from the connected GHL account
 *
 * Mounted at /api/portal/admin/ghl, auth: requireSuperAdmin (portal admins).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { asc, desc, eq, ne, and, sql } from "drizzle-orm";
import { db, productsTable, purchasesTable, webhookEventsTable, externalApiKeysTable } from "@workspace/db";
import { requireSuperAdmin } from "../middlewares/requireAuth";
import {
  getWebhookSecret,
  rotateWebhookSecret,
  getGhlConnection,
  saveGhlConnection,
  clearGhlConnection,
} from "../lib/ghl-settings";
import { fetchGhlProducts, verifyGhlCredentials, GhlApiError } from "../lib/ghl-client";
import {
  ENTITLEMENT_DEFS,
  ENTITLEMENT_KEYS,
  sanitizeEntitlements,
  UPGRADE_SLUGS,
  UPGRADE_SLUG_DEFS,
} from "../lib/ghl-entitlements";

/**
 * Upgrade slugs the portal's locked surfaces rely on that have no ACTIVE
 * product with a configured purchase URL. Those surfaces fall back to the
 * generic "contact hello@room30.ai" notice, so both the Setup checklist
 * and the Products page warn about them.
 */
async function findMissingPurchaseLinks() {
  const rows = await db
    .select({ slug: productsTable.slug, active: productsTable.active, purchaseUrl: productsTable.purchaseUrl })
    .from(productsTable);
  const configured = new Set(
    rows.filter((r) => r.active && r.purchaseUrl).map((r) => r.slug.toLowerCase()),
  );
  return UPGRADE_SLUGS.filter((slug) => !configured.has(slug)).map((slug) => ({
    slug,
    label: UPGRADE_SLUG_DEFS[slug],
  }));
}

const router: IRouter = Router();
router.use(requireSuperAdmin);

function appBaseUrl(req: Request): string {
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "";
  const proto = req.get("x-forwarded-proto") ?? req.protocol ?? "https";
  return host ? `${proto}://${host}` : "";
}

// ── Settings: webhook secret + GHL connection ────────────────────────────────
router.get("/settings", async (req: Request, res: Response) => {
  const [secret, conn] = await Promise.all([getWebhookSecret(), getGhlConnection()]);
  return res.json({
    webhookSecret: secret,
    webhookUrl: `${appBaseUrl(req)}/api/public/webhooks/ghl?secret=${secret}`,
    ghl: conn
      ? { connected: true, locationId: conn.locationId, tokenLast4: conn.token.slice(-4) }
      : { connected: false },
    entitlementKeys: ENTITLEMENT_KEYS.map((k) => ({ key: k, label: ENTITLEMENT_DEFS[k].label })),
  });
});

router.post("/settings/rotate-webhook-secret", async (req: Request, res: Response) => {
  const secret = await rotateWebhookSecret();
  return res.json({
    webhookSecret: secret,
    webhookUrl: `${appBaseUrl(req)}/api/public/webhooks/ghl?secret=${secret}`,
  });
});

const connectSchema = z.object({
  token: z.string().trim().min(10).max(2000),
  locationId: z.string().trim().min(3).max(200),
});

router.post("/settings/ghl-connection", async (req: Request, res: Response) => {
  const parsed = connectSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    await verifyGhlCredentials(parsed.data.token, parsed.data.locationId);
  } catch (err) {
    if (err instanceof GhlApiError) {
      return res.status(err.status === 401 || err.status === 403 ? 400 : 502).json({
        error: "ghl_verification_failed",
        message:
          err.status === 401 || err.status === 403
            ? "GoHighLevel rejected these credentials. Check the Private Integration token (needs the View Products scope) and Location ID."
            : err.message,
      });
    }
    throw err;
  }
  await saveGhlConnection({ token: parsed.data.token, locationId: parsed.data.locationId });
  return res.json({ ok: true, locationId: parsed.data.locationId, tokenLast4: parsed.data.token.slice(-4) });
});

router.delete("/settings/ghl-connection", async (_req: Request, res: Response) => {
  await clearGhlConnection();
  return res.json({ ok: true });
});

// ── Setup checklist status ───────────────────────────────────────────────────
// Live done/not-done status for each template onboarding step, consumed by the
// admin Setup page. Read-only aggregation — no side effects.
router.get("/setup-status", async (req: Request, res: Response) => {
  const [conn, secret, missingPurchaseLinks, [productCounts], [webhookCounts], [apiKeyCounts]] = await Promise.all([
    getGhlConnection(),
    getWebhookSecret(),
    findMissingPurchaseLinks(),
    db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${productsTable.active})::int`,
      })
      .from(productsTable),
    db
      .select({
        total: sql<number>`count(*)::int`,
        processed: sql<number>`count(*) filter (where ${webhookEventsTable.status} = 'processed')::int`,
      })
      .from(webhookEventsTable),
    db
      .select({
        active: sql<number>`count(*) filter (where ${externalApiKeysTable.revokedAt} is null)::int`,
      })
      .from(externalApiKeysTable),
  ]);
  return res.json({
    steps: {
      ghlConnected: {
        done: !!conn,
        locationId: conn?.locationId ?? null,
      },
      productsConfigured: {
        done: Number(productCounts.active) > 0,
        totalProducts: Number(productCounts.total),
        activeProducts: Number(productCounts.active),
      },
      purchaseLinksConfigured: {
        // Every known upgrade slug should have an ACTIVE product with a
        // purchase URL; otherwise its locked surface shows the generic
        // "contact hello@room30.ai" fallback instead of a checkout link.
        done: missingPurchaseLinks.length === 0,
        totalUpgradeSlugs: UPGRADE_SLUGS.length,
        missing: missingPurchaseLinks,
      },
      webhookReceived: {
        done: Number(webhookCounts.processed) > 0,
        totalDeliveries: Number(webhookCounts.total),
        processedDeliveries: Number(webhookCounts.processed),
        webhookUrl: `${appBaseUrl(req)}/api/public/webhooks/ghl?secret=${secret}`,
      },
      apiKeyCreated: {
        // Optional step — the external REST API is only needed when other
        // systems will call into the portal.
        done: Number(apiKeyCounts.active) > 0,
        activeKeys: Number(apiKeyCounts.active),
      },
      adminEmailsSet: {
        // The middleware falls back to a hard-coded default when ADMIN_EMAILS
        // is unset, so "done" means the env var itself was configured.
        done: Boolean(process.env.ADMIN_EMAILS?.trim()),
      },
    },
  });
});

// ── Webhook delivery log ─────────────────────────────────────────────────────
router.get("/webhook-events", async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const rows = await db
    .select()
    .from(webhookEventsTable)
    .orderBy(desc(webhookEventsTable.createdAt))
    .limit(limit);
  return res.json({ events: rows });
});

// ── Products CRUD ────────────────────────────────────────────────────────────
router.get("/products", async (_req: Request, res: Response) => {
  const products = await db.select().from(productsTable).orderBy(asc(productsTable.id));
  const counts = await db
    .select({
      productId: purchasesTable.productId,
      active: sql<number>`count(*) filter (where ${purchasesTable.revokedAt} is null)`,
    })
    .from(purchasesTable)
    .groupBy(purchasesTable.productId);
  const countMap = new Map(counts.map((c) => [c.productId, Number(c.active)]));
  const configured = new Set(products.filter((p) => p.active && p.purchaseUrl).map((p) => p.slug.toLowerCase()));
  return res.json({
    products: products.map((p) => ({ ...p, activePurchases: countMap.get(p.id) ?? 0 })),
    entitlementKeys: ENTITLEMENT_KEYS.map((k) => ({ key: k, label: ENTITLEMENT_DEFS[k].label })),
    missingPurchaseLinks: UPGRADE_SLUGS.filter((slug) => !configured.has(slug)).map((slug) => ({
      slug,
      label: UPGRADE_SLUG_DEFS[slug],
    })),
  });
});

const productSchema = z.object({
  name: z.string().trim().min(1).max(240),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9-_]*$/, "lowercase letters, numbers, dashes, underscores"),
  kind: z.enum(["main", "bump", "upsell", "addon"]).default("main"),
  description: z.string().trim().max(2000).optional().nullable(),
  grantsFullPortal: z.boolean().default(false),
  entitlements: z.array(z.string()).default([]),
  active: z.boolean().default(true),
  ghlProductId: z.string().trim().max(200).optional().nullable(),
  // GHL-hosted sales page opened by locked upgrade surfaces in the portal.
  // Must be an http(s) URL; empty string / null clears it.
  purchaseUrl: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().url().max(2000).refine((u) => /^https?:\/\//i.test(u), "must be http(s)").optional().nullable(),
    ),
});

router.post("/products", async (req: Request, res: Response) => {
  const parsed = productSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  const d = parsed.data;
  const [dupe] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(sql`lower(${productsTable.slug}) = ${d.slug.toLowerCase()}`)
    .limit(1);
  if (dupe) return res.status(409).json({ error: "slug_taken" });
  const [product] = await db
    .insert(productsTable)
    .values({
      name: d.name,
      slug: d.slug.toLowerCase(),
      kind: d.kind,
      description: d.description ?? null,
      grantsFullPortal: d.grantsFullPortal,
      entitlements: sanitizeEntitlements(d.entitlements),
      active: d.active,
      ghlProductId: d.ghlProductId || null,
      purchaseUrl: d.purchaseUrl ?? null,
    })
    .returning();
  return res.status(201).json({ product });
});

router.put("/products/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid_id" });
  const parsed = productSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  const d = parsed.data;
  const [dupe] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(sql`lower(${productsTable.slug}) = ${d.slug.toLowerCase()}`, ne(productsTable.id, id)))
    .limit(1);
  if (dupe) return res.status(409).json({ error: "slug_taken" });
  const [product] = await db
    .update(productsTable)
    .set({
      name: d.name,
      slug: d.slug.toLowerCase(),
      kind: d.kind,
      description: d.description ?? null,
      grantsFullPortal: d.grantsFullPortal,
      entitlements: sanitizeEntitlements(d.entitlements),
      active: d.active,
      ghlProductId: d.ghlProductId || null,
      purchaseUrl: d.purchaseUrl ?? null,
      updatedAt: new Date(),
    })
    .where(eq(productsTable.id, id))
    .returning();
  if (!product) return res.status(404).json({ error: "not_found" });
  return res.json({ product });
});

router.delete("/products/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid_id" });
  const [{ activeCount }] = await db
    .select({ activeCount: sql<number>`count(*)` })
    .from(purchasesTable)
    .where(and(eq(purchasesTable.productId, id), sql`${purchasesTable.revokedAt} is null`));
  if (Number(activeCount) > 0) {
    return res.status(409).json({
      error: "has_active_purchases",
      message: `This product has ${activeCount} active purchase(s). Deactivate it instead, or revoke access first.`,
    });
  }
  const deleted = await db.delete(productsTable).where(eq(productsTable.id, id)).returning({ id: productsTable.id });
  if (deleted.length === 0) return res.status(404).json({ error: "not_found" });
  return res.json({ ok: true });
});

// ── Import products from the connected GHL account ──────────────────────────
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "product"
  );
}

router.post("/products/import-from-ghl", async (_req: Request, res: Response) => {
  const conn = await getGhlConnection();
  if (!conn) {
    return res.status(400).json({ error: "ghl_not_connected", message: "Connect your GoHighLevel account first." });
  }
  let ghlProducts;
  try {
    ghlProducts = await fetchGhlProducts(conn.token, conn.locationId);
  } catch (err) {
    if (err instanceof GhlApiError) {
      return res.status(502).json({ error: "ghl_fetch_failed", message: err.message });
    }
    throw err;
  }

  const existing = await db.select().from(productsTable);
  const byGhlId = new Map(existing.filter((p) => p.ghlProductId).map((p) => [p.ghlProductId!, p]));
  const takenSlugs = new Set(existing.map((p) => p.slug.toLowerCase()));

  let created = 0;
  let updated = 0;
  for (const gp of ghlProducts) {
    const match = byGhlId.get(gp.id);
    if (match) {
      await db
        .update(productsTable)
        .set({ name: gp.name, description: gp.description ?? match.description, updatedAt: new Date() })
        .where(eq(productsTable.id, match.id));
      updated += 1;
      continue;
    }
    let slug = slugify(gp.name);
    let suffix = 2;
    while (takenSlugs.has(slug)) slug = `${slugify(gp.name)}-${suffix++}`;
    takenSlugs.add(slug);
    await db.insert(productsTable).values({
      name: gp.name,
      slug,
      kind: "main",
      description: gp.description ?? null,
      grantsFullPortal: false,
      entitlements: [],
      active: false, // imported products start inactive until configured
      ghlProductId: gp.id,
    });
    created += 1;
  }
  return res.json({ ok: true, imported: ghlProducts.length, created, updated });
});

export default router;
