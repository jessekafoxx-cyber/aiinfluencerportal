/**
 * Remote MCP server — lets Claude (Settings → Connectors → Add custom
 * connector) work against the portal with the SAME capabilities as the
 * /api/v1 external API.
 *
 *   Endpoint:  POST /api/mcp   (Streamable HTTP transport, stateless)
 *   Auth:      Authorization: Bearer <key> — the exact same sha256-hashed
 *              keys from the admin "API Keys" page (external_api_keys).
 *              No second auth scheme, no new secrets.
 *
 * Every tool is a thin wrapper over the same lib functions the v1 REST
 * routes call (ghl-entitlements.ts) — one implementation, not two.
 * Read tools carry readOnlyHint; write tools are marked non-destructive
 * except revoke_product.
 *
 * Stateless mode: each POST creates a fresh server + transport
 * (sessionIdGenerator: undefined), so no session bookkeeping and the
 * endpoint works behind load balancers / republishes. GET/DELETE return
 * 405 per the stateless Streamable HTTP pattern.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import { z } from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
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

const PAGE_LIMIT = 50; // hard cap on list responses; cursor-paginated

// ── Bearer auth (same keys/kill-switch as /api/v1) ───────────────────────────
async function authenticateBearer(req: Request): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const auth = req.header("authorization") ?? "";
  const presented = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!presented) return { ok: false, status: 401, message: "Send Authorization: Bearer <key>." };
  const hash = crypto.createHash("sha256").update(presented, "utf8").digest("hex");
  const [key] = await db
    .select()
    .from(externalApiKeysTable)
    .where(and(eq(externalApiKeysTable.keyHash, hash), isNull(externalApiKeysTable.revokedAt)))
    .limit(1);
  if (!key) return { ok: false, status: 401, message: "Key is unknown or has been revoked." };
  const settings = await loadExternalApiSettings();
  if (settings.killSwitchEnabled) {
    return { ok: false, status: 503, message: "The external API is temporarily disabled by an administrator." };
  }
  void db
    .update(externalApiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(externalApiKeysTable.id, key.id))
    .catch(() => {});
  return { ok: true };
}

// ── Shared helpers (same shapes as v1-api.ts) ────────────────────────────────
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

function jsonResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

/** Real MCP tool errors (isError: true), not 200-with-error-body. */
function toolError(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

// ── Server factory: one fresh server per request (stateless) ─────────────────
function buildServer(): McpServer {
  const server = new McpServer({ name: "room30-portal", version: "1.0.0" });

  server.registerTool(
    "list_products",
    {
      title: "List products",
      description:
        "List sellable products (max 50 per page; pass nextCursor to page) with slug, kind, entitlement keys, and active flag. Product slugs are the identifiers grant_product/revoke_product expect.",
      inputSchema: {
        cursor: z.number().int().min(0).optional().describe("Return products with id greater than this value (from a previous nextCursor)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cursor }) => {
      const products = await db
        .select()
        .from(productsTable)
        .where(cursor ? gt(productsTable.id, cursor) : undefined)
        .orderBy(asc(productsTable.id))
        .limit(PAGE_LIMIT);
      return jsonResult({
        nextCursor: products.length === PAGE_LIMIT ? products[products.length - 1].id : null,
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          kind: p.kind,
          description: p.description,
          grantsFullPortal: p.grantsFullPortal,
          entitlements: p.entitlements,
          active: p.active,
        })),
        entitlementKeys: ENTITLEMENT_KEYS.map((k) => ({ key: k, label: ENTITLEMENT_DEFS[k].label })),
      });
    },
  );

  server.registerTool(
    "list_courses",
    {
      title: "List courses",
      description: "List masterclass course phases with their lessons (titles, slugs, durations, published state).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
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
      return jsonResult({
        courses: phases.map((p) => ({
          id: p.id,
          slug: p.slug,
          title: p.title,
          description: p.description,
          sortOrder: p.sortOrder,
          lessons: lessons.filter((l) => l.phaseId === p.id),
        })),
      });
    },
  );

  server.registerTool(
    "list_users",
    {
      title: "List users",
      description:
        "List portal users, max 50 per page. Pass the returned nextCursor to fetch the next page. To find one user by email use get_user instead.",
      inputSchema: {
        cursor: z.number().int().min(0).optional().describe("Return users with id greater than this value (from a previous nextCursor)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cursor }) => {
      const rows = await db
        .select()
        .from(portalUsersTable)
        .where(cursor ? gt(portalUsersTable.id, cursor) : undefined)
        .orderBy(asc(portalUsersTable.id))
        .limit(PAGE_LIMIT);
      return jsonResult({
        users: rows.map(userDto),
        nextCursor: rows.length === PAGE_LIMIT ? rows[rows.length - 1].id : null,
      });
    },
  );

  server.registerTool(
    "get_user",
    {
      title: "Get user",
      description: "Look up one portal user by email. Returns their profile or an error if no user exists.",
      inputSchema: { email: z.string().email().describe("The user's email address.") },
      annotations: { readOnlyHint: true },
    },
    async ({ email }) => {
      const user = await findUserByEmail(email);
      if (!user) return toolError(`No portal user with email ${normalizeEmail(email)}.`);
      return jsonResult({ user: userDto(user) });
    },
  );

  server.registerTool(
    "create_user",
    {
      title: "Create user",
      description: "Find or create a portal user by email. Idempotent: returns the existing user if one exists.",
      inputSchema: {
        email: z.string().email().describe("Email address for the account."),
        name: z.string().max(240).optional().describe("Optional full name."),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ email, name }) => {
      const { user, created } = await findOrCreateUserByEmail(email, name);
      return jsonResult({ user: userDto(user), created });
    },
  );

  server.registerTool(
    "get_access",
    {
      title: "Get user access",
      description: "Return a user's current entitlements and active purchases, aggregated across every payment source.",
      inputSchema: { email: z.string().email().describe("The user's email address.") },
      annotations: { readOnlyHint: true },
    },
    async ({ email }) => {
      const user = await findUserByEmail(email);
      if (!user) return toolError(`No portal user with email ${normalizeEmail(email)}.`);
      const access = await getUserAccess(user);
      return jsonResult({ user: userDto(user), access });
    },
  );

  server.registerTool(
    "grant_product",
    {
      title: "Grant product",
      description:
        "Grant a product (by slug from list_products) to a user by email, creating the user if needed. Idempotent and retry-safe: replays re-apply entitlements.",
      inputSchema: {
        email: z.string().email().describe("Buyer's email; the account is created if missing."),
        product: z.string().min(1).max(200).describe("Product slug from list_products."),
        name: z.string().max(240).optional().describe("Optional buyer name for new accounts."),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ email, product: productSlug, name }) => {
      const product = await findProductBySlug(productSlug);
      if (!product) return toolError(`Unknown product slug "${productSlug}". Call list_products for valid slugs.`);
      const { user, created } = await findOrCreateUserByEmail(email, name);
      const result = await grantProductToUser(user, product, { source: "api" });
      return jsonResult({
        user: userDto(user),
        userCreated: created,
        product: product.slug,
        granted: result.granted,
        alreadyGranted: result.alreadyGranted,
      });
    },
  );

  server.registerTool(
    "revoke_product",
    {
      title: "Revoke product",
      description:
        "Revoke a previously granted product from a user. Only reverses what this purchase model granted; access proven by other payment sources is untouched.",
      inputSchema: {
        email: z.string().email().describe("The user's email address."),
        product: z.string().min(1).max(200).describe("Product slug from list_products."),
      },
      annotations: { idempotentHint: true },
    },
    async ({ email, product: productSlug }) => {
      const product = await findProductBySlug(productSlug);
      if (!product) return toolError(`Unknown product slug "${productSlug}". Call list_products for valid slugs.`);
      const user = await findUserByEmail(email);
      if (!user) return toolError(`No portal user with email ${normalizeEmail(email)}.`);
      const revoked = await revokeProductFromUser(user, product);
      return jsonResult({ email: normalizeEmail(email), product: product.slug, revoked });
    },
  );

  server.registerTool(
    "list_purchases",
    {
      title: "List purchases",
      description:
        "Read-only purchase ledger (max 50 per page, oldest first). Optionally filter by user email; pass nextCursor to page.",
      inputSchema: {
        email: z.string().email().optional().describe("Only purchases for this user."),
        cursor: z.number().int().min(0).optional().describe("Return purchases with id greater than this value."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ email, cursor }) => {
      const conditions = [];
      if (email) {
        const user = await findUserByEmail(email);
        if (!user) return toolError(`No portal user with email ${normalizeEmail(email)}.`);
        conditions.push(eq(purchasesTable.userId, user.id));
      }
      if (cursor) conditions.push(gt(purchasesTable.id, cursor));
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
        .limit(PAGE_LIMIT);
      return jsonResult({
        purchases: rows,
        nextCursor: rows.length === PAGE_LIMIT ? rows[rows.length - 1].id : null,
      });
    },
  );

  return server;
}

// ── Transport: stateless Streamable HTTP ─────────────────────────────────────
router.post("/mcp", async (req: Request, res: Response) => {
  try {
    const auth = await authenticateBearer(req);
    if (!auth.ok) {
      res.status(auth.status).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: auth.message },
        id: null,
      });
      return;
    }
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      void transport.close();
      void server.close();
    };
    // "finish" fires when the response is fully flushed (keep-alive included);
    // "close" covers aborted connections.
    res.on("finish", cleanup);
    res.on("close", cleanup);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error({ err }, "[mcp] request failed");
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless server: no SSE stream to resume, no session to delete.
const methodNotAllowed = (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. This MCP endpoint is stateless; use POST." },
    id: null,
  });
};
router.get("/mcp", methodNotAllowed);
router.delete("/mcp", methodNotAllowed);

export default router;
