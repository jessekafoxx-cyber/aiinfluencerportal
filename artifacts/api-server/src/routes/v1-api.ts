/**
 * External automation API (v1) — Bearer-key protected.
 *
 *   Authorization: Bearer <key>
 *
 * Keys are the same sha256-hashed keys managed on the admin "API Keys"
 * page (external_api_keys table): create/revoke there, shown once, with
 * last-used tracking. Built for Zapier/Make, GoHighLevel automations,
 * AI tools, and any other external integration.
 *
 * Mounted at /api/v1 (pre-auth: no Clerk session required).
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod/v4";
import crypto from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  externalApiKeysTable,
  productsTable,
  purchasesTable,
  portalUsersTable,
  coursePhasesTable,
  lessonsTable,
  type PortalUser,
} from "@workspace/db";
import {
  findOrCreateUserByEmail,
  findProductBySlug,
  grantProductToUser,
  revokeProductFromUser,
  getUserAccess,
  normalizeEmail,
  ENTITLEMENT_KEYS,
  ENTITLEMENT_DEFS,
} from "../lib/ghl-entitlements";
import { loadExternalApiSettings } from "../middlewares/requireExternalApiKey";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Bearer auth against external_api_keys (sha256 hash, revocable) ──────────
async function requireBearerKey(req: Request, res: Response, next: NextFunction) {
  const auth = req.header("authorization") ?? "";
  const presented = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!presented) {
    res.status(401).json({ error: "missing_api_key", message: "Send Authorization: Bearer <key>." });
    return;
  }
  try {
    const hash = crypto.createHash("sha256").update(presented, "utf8").digest("hex");
    const [key] = await db
      .select()
      .from(externalApiKeysTable)
      .where(and(eq(externalApiKeysTable.keyHash, hash), isNull(externalApiKeysTable.revokedAt)))
      .limit(1);
    if (!key) {
      res.status(401).json({ error: "invalid_api_key", message: "Key is unknown or has been revoked." });
      return;
    }
    const settings = await loadExternalApiSettings();
    if (settings.killSwitchEnabled) {
      res.status(503).json({ error: "kill_switch_enabled", message: "The external API is temporarily disabled by an administrator." });
      return;
    }
    void db
      .update(externalApiKeysTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(externalApiKeysTable.id, key.id))
      .catch(() => {});
    next();
  } catch (err) {
    logger.error({ err }, "[v1-api] key lookup failed");
    res.status(500).json({ error: "internal_error" });
  }
}

router.use("/v1", requireBearerKey);

function userDto(u: PortalUser) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt,
  };
}

async function findUserByEmail(email: string): Promise<PortalUser | null> {
  const [u] = await db
    .select()
    .from(portalUsersTable)
    .where(sql`lower(${portalUsersTable.email}) = ${normalizeEmail(email)}`)
    .limit(1);
  return u ?? null;
}

// ── Products ─────────────────────────────────────────────────────────────────
router.get("/v1/products", async (_req: Request, res: Response) => {
  const products = await db.select().from(productsTable).orderBy(asc(productsTable.id));
  return res.json({
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      kind: p.kind,
      description: p.description,
      grantsFullPortal: p.grantsFullPortal,
      entitlements: p.entitlements,
      active: p.active,
      ghlProductId: p.ghlProductId,
    })),
    entitlementKeys: ENTITLEMENT_KEYS.map((k) => ({ key: k, label: ENTITLEMENT_DEFS[k].label })),
  });
});

// ── Courses (masterclass phases + lessons) ───────────────────────────────────
router.get("/v1/courses", async (_req: Request, res: Response) => {
  const phases = await db.select().from(coursePhasesTable).orderBy(asc(coursePhasesTable.sortOrder));
  const lessons = await db
    .select({
      id: lessonsTable.id,
      phaseId: lessonsTable.phaseId,
      slug: lessonsTable.slug,
      title: lessonsTable.title,
      brief: lessonsTable.brief,
      sortOrder: lessonsTable.sortOrder,
      durationMinutes: lessonsTable.durationMinutes,
      isPublished: lessonsTable.isPublished,
    })
    .from(lessonsTable)
    .orderBy(asc(lessonsTable.sortOrder));
  return res.json({
    courses: phases.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      sortOrder: p.sortOrder,
      lessons: lessons.filter((l) => l.phaseId === p.id),
    })),
  });
});

// ── Users ────────────────────────────────────────────────────────────────────
router.get("/v1/users", async (req: Request, res: Response) => {
  const email = typeof req.query.email === "string" ? req.query.email : "";
  if (email) {
    const user = await findUserByEmail(email);
    if (!user) return res.status(404).json({ error: "user_not_found" });
    return res.json({ users: [userDto(user)] });
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const users = await db
    .select()
    .from(portalUsersTable)
    .orderBy(asc(portalUsersTable.id))
    .limit(limit)
    .offset(offset);
  return res.json({ users: users.map(userDto), limit, offset });
});

const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(240).optional(),
});

router.post("/v1/users", async (req: Request, res: Response) => {
  const parsed = createUserSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  const { user, created } = await findOrCreateUserByEmail(parsed.data.email, parsed.data.name);
  return res.status(created ? 201 : 200).json({ user: userDto(user), created });
});

// ── Access ───────────────────────────────────────────────────────────────────
router.get("/v1/access", async (req: Request, res: Response) => {
  const email = typeof req.query.email === "string" ? req.query.email : "";
  if (!email) return res.status(400).json({ error: "email_required" });
  const user = await findUserByEmail(email);
  if (!user) return res.status(404).json({ error: "user_not_found" });
  const access = await getUserAccess(user);
  return res.json({ user: userDto(user), access });
});

const grantSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(240).optional(),
  product: z.string().trim().min(1).max(200),
});

router.post("/v1/grants", async (req: Request, res: Response) => {
  const parsed = grantSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  const product = await findProductBySlug(parsed.data.product);
  if (!product) return res.status(404).json({ error: "unknown_product", product: parsed.data.product });
  const { user, created } = await findOrCreateUserByEmail(parsed.data.email, parsed.data.name);
  const result = await grantProductToUser(user, product, { source: "api" });
  return res.status(result.alreadyGranted ? 200 : 201).json({
    user: userDto(user),
    userCreated: created,
    product: product.slug,
    granted: result.granted,
    alreadyGranted: result.alreadyGranted,
  });
});

const revokeSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  product: z.string().trim().min(1).max(200),
});

router.post("/v1/revocations", async (req: Request, res: Response) => {
  const parsed = revokeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  const product = await findProductBySlug(parsed.data.product);
  if (!product) return res.status(404).json({ error: "unknown_product", product: parsed.data.product });
  const user = await findUserByEmail(parsed.data.email);
  if (!user) return res.status(404).json({ error: "user_not_found" });
  const revoked = await revokeProductFromUser(user, product);
  return res.json({ email: normalizeEmail(parsed.data.email), product: product.slug, revoked });
});

// ── Purchases (read-only ledger) ─────────────────────────────────────────────
router.get("/v1/purchases", async (req: Request, res: Response) => {
  const email = typeof req.query.email === "string" ? req.query.email : "";
  const conditions = [] as ReturnType<typeof eq>[];
  if (email) {
    const user = await findUserByEmail(email);
    if (!user) return res.status(404).json({ error: "user_not_found" });
    conditions.push(eq(purchasesTable.userId, user.id));
  }
  const rows = await db
    .select({
      id: purchasesTable.id,
      userId: purchasesTable.userId,
      email: portalUsersTable.email,
      product: productsTable.slug,
      source: purchasesTable.source,
      revokedAt: purchasesTable.revokedAt,
      createdAt: purchasesTable.createdAt,
    })
    .from(purchasesTable)
    .innerJoin(productsTable, eq(purchasesTable.productId, productsTable.id))
    .innerJoin(portalUsersTable, eq(purchasesTable.userId, portalUsersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(purchasesTable.id))
    .limit(500);
  return res.json({ purchases: rows });
});

export default router;
