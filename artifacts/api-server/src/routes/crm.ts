import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth, clerkClient } from "../lib/auth-compat";
import { and, asc, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import {
  db,
  crmUsers,
  crmPipelineStages,
  crmContacts,
  crmDeals,
  crmProducts,
  crmActivities,
  crmContactEvents,
  type CrmUser,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { buildCalendlyRouter, reactToStageChange } from "./crm-calendly";

interface ClerkSessionClaimsLike {
  userId?: unknown;
  email?: unknown;
  email_address?: unknown;
  firstName?: unknown;
  first_name?: unknown;
  lastName?: unknown;
  last_name?: unknown;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function getEnvWebhookKey(): string | null {
  const v = process.env.CRM_WEBHOOK_API_KEY;
  return typeof v === "string" && v.length >= 16 ? v : null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const ADMIN_EMAILS = new Set(
  (process.env.CRM_BOOTSTRAP_ADMIN_EMAIL || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

declare global {
  namespace Express {
    interface Request {
      crmUser?: CrmUser;
    }
  }
}

async function loadCrmUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = getAuth(req);
    const clerkId = auth?.sessionClaims?.userId || auth?.userId;
    if (!clerkId || typeof clerkId !== "string") {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const claims = (auth?.sessionClaims ?? {}) as ClerkSessionClaimsLike;
    let email = strOrNull(claims.email) ?? strOrNull(claims.email_address);
    let firstName = strOrNull(claims.firstName) ?? strOrNull(claims.first_name);
    let lastName = strOrNull(claims.lastName) ?? strOrNull(claims.last_name);
    if (!email) {
      try {
        const u = await clerkClient.users.getUser(clerkId);
        email = u.emailAddresses?.[0]?.emailAddress ?? null;
        firstName ||= u.firstName ?? null;
        lastName ||= u.lastName ?? null;
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), clerkId },
          "[crm] clerk user lookup failed",
        );
      }
    }

    let [user] = await db
      .select()
      .from(crmUsers)
      .where(eq(crmUsers.clerkId, clerkId))
      .limit(1);

    if (!user && email) {
      const lower = email.trim().toLowerCase();
      const [byEmail] = await db
        .select()
        .from(crmUsers)
        .where(sql`lower(${crmUsers.email}) = ${lower}`)
        .limit(1);
      if (byEmail) {
        const [claimed] = await db
          .update(crmUsers)
          .set({ clerkId, updatedAt: new Date() })
          .where(eq(crmUsers.id, byEmail.id))
          .returning();
        user = claimed ?? byEmail;
      }
    }

    if (!user) {
      const fallbackEmail = email || `${clerkId}@crm.local`;
      const isAdmin = ADMIN_EMAILS.has(fallbackEmail.toLowerCase());
      const [inserted] = await db
        .insert(crmUsers)
        .values({
          clerkId,
          email: fallbackEmail,
          firstName,
          lastName,
          role: isAdmin ? "admin" : "member",
          isActive: true,
        })
        .returning();
      user = inserted;
    } else if (
      email &&
      ADMIN_EMAILS.has(email.toLowerCase()) &&
      user.role !== "admin"
    ) {
      const [promoted] = await db
        .update(crmUsers)
        .set({ role: "admin", updatedAt: new Date() })
        .where(eq(crmUsers.id, user.id))
        .returning();
      user = promoted ?? user;
    }

    if (!user.isActive) {
      res.status(403).json({ error: "User disabled" });
      return;
    }
    req.crmUser = user;
    next();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[crm] loadCrmUser failed",
    );
    res.status(500).json({ error: "Auth failed" });
    return;
  }
}

function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.crmUser || !roles.includes(req.crmUser.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

function requireWebhookKey(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = getEnvWebhookKey();
  if (!expected) {
    res.status(503).json({
      error: "CRM_WEBHOOK_API_KEY is not configured on the server",
    });
    return;
  }
  const got = req.header("x-api-key");
  if (!got || !safeEqual(got, expected)) {
    res.status(401).json({ error: "Invalid api key" });
    return;
  }
  next();
}

const crmRouter: IRouter = Router();

const DEFAULT_STAGES = [
  { key: "new", label: "New", sortOrder: 0, isWon: false, isLost: false },
  { key: "contacted", label: "Contacted", sortOrder: 1, isWon: false, isLost: false },
  { key: "qualified", label: "Qualified", sortOrder: 2, isWon: false, isLost: false },
  { key: "proposal", label: "Proposal", sortOrder: 3, isWon: false, isLost: false },
  { key: "won", label: "Won", sortOrder: 4, isWon: true, isLost: false },
  { key: "lost", label: "Lost", sortOrder: 5, isWon: false, isLost: true },
];

const DEFAULT_PRODUCTS = [
  { slug: "apex-dfy", name: "Apex DFY", priceCents: 1500000, commissionPct: 10 },
  { slug: "portugal-gold", name: "Portugal Gold", priceCents: 500000, commissionPct: 10 },
  { slug: "portugal-vip", name: "Portugal VIP", priceCents: 750000, commissionPct: 10 },
  { slug: "a-list", name: "A-List", priceCents: 500000, commissionPct: 10 },
  { slug: "strategy-call", name: "Strategy Call", priceCents: 49700, commissionPct: 20 },
  { slug: "dfy-pack", name: "DFY Pack", priceCents: 19700, commissionPct: 20 },
];

let seedRan = false;
async function ensureSeed(): Promise<void> {
  if (seedRan) return;
  seedRan = true;
  try {
    const stages = await db.select().from(crmPipelineStages).limit(1);
    if (stages.length === 0) {
      await db.insert(crmPipelineStages).values(DEFAULT_STAGES);
    }
    const products = await db.select().from(crmProducts).limit(1);
    if (products.length === 0) {
      await db.insert(crmProducts).values(
        DEFAULT_PRODUCTS.map((p, idx) => ({
          ...p,
          sortOrder: idx,
          isActive: true,
          commissionFlatCents: 0,
        })),
      );
    }
  } catch (err) {
    seedRan = false;
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[crm] seed failed",
    );
  }
}

crmRouter.use("/crm", async (_req, _res, next) => {
  await ensureSeed();
  next();
});

// Webhooks (gated by x-api-key only) - mounted BEFORE auth.
crmRouter.post(
  "/crm/webhook/contact",
  requireWebhookKey,
  async (req: Request, res: Response) => {
    try {
      const b = req.body ?? {};
      const email = String(b.email || "").trim();
      if (!email) {
        res.status(400).json({ error: "email required" });
        return;
      }
      const lower = email.toLowerCase();
      const stagesRows = await db.select().from(crmPipelineStages).orderBy(asc(crmPipelineStages.sortOrder));
      const newStage = stagesRows.find((s) => s.key === "new") ?? stagesRows[0];

      const [existing] = await db
        .select()
        .from(crmContacts)
        .where(sql`lower(${crmContacts.email}) = ${lower}`)
        .limit(1);

      const fields = {
        phone: b.phone ?? null,
        firstName: b.firstName ?? b.first_name ?? null,
        lastName: b.lastName ?? b.last_name ?? null,
        company: b.company ?? null,
        source: b.source ?? null,
        valueCents:
          typeof b.valueCents === "number"
            ? b.valueCents
            : typeof b.value_cents === "number"
              ? b.value_cents
              : 0,
        notes: b.notes ?? null,
        properties: b.properties ?? null,
      } as const;

      if (existing) {
        const [updated] = await db
          .update(crmContacts)
          .set({
            phone: fields.phone ?? existing.phone,
            firstName: fields.firstName ?? existing.firstName,
            lastName: fields.lastName ?? existing.lastName,
            company: fields.company ?? existing.company,
            source: fields.source ?? existing.source,
            valueCents: fields.valueCents || existing.valueCents,
            notes: fields.notes ?? existing.notes,
            properties: fields.properties ?? existing.properties,
            lastActivityAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(crmContacts.id, existing.id))
          .returning();
        res.json({ ok: true, id: updated.id, created: false });
        return;
      }

      const [inserted] = await db
        .insert(crmContacts)
        .values({
          email,
          ...fields,
          stageId: newStage?.id ?? null,
          lastActivityAt: new Date(),
        })
        .returning();
      res.json({ ok: true, id: inserted.id, created: true });
      return;
    } catch (err) {
      req.log?.error?.(
        { err: err instanceof Error ? err.message : String(err) },
        "[crm] webhook/contact failed",
      );
      res.status(500).json({ error: "ingest failed" });
      return;
    }
  },
);

crmRouter.post(
  "/crm/webhook/event",
  requireWebhookKey,
  async (req: Request, res: Response) => {
    try {
      const b = req.body ?? {};
      const email = String(b.email || "").trim().toLowerCase();
      const eventName = String(b.eventName || b.event_name || "").trim();
      if (!email || !eventName) {
        res.status(400).json({ error: "email and eventName required" });
        return;
      }
      const [contact] = await db
        .select()
        .from(crmContacts)
        .where(sql`lower(${crmContacts.email}) = ${email}`)
        .limit(1);
      if (!contact) {
        res.status(404).json({ error: "contact_not_found" });
        return;
      }
      await db.insert(crmContactEvents).values({
        contactId: contact.id,
        eventName,
        source: b.source ?? null,
        payload: b.payload ?? null,
      });
      await db
        .update(crmContacts)
        .set({ lastActivityAt: new Date(), updatedAt: new Date() })
        .where(eq(crmContacts.id, contact.id));
      res.json({ ok: true });
      return;
    } catch (err) {
      req.log?.error?.(
        { err: err instanceof Error ? err.message : String(err) },
        "[crm] webhook/event failed",
      );
      res.status(500).json({ error: "ingest failed" });
      return;
    }
  },
);

// Auth-gated routes below.
crmRouter.use("/crm", loadCrmUser);

// Task #608 - Calendly endpoints (calendar view, contact card tab,
// settings, manual resync, webhook subscribe). Mounted after
// loadCrmUser so all handlers run with `req.crmUser` populated.
crmRouter.use(buildCalendlyRouter({ requireRole }));

crmRouter.get("/crm/me", async (req: Request, res: Response) => {
  res.json({ user: req.crmUser });
});

crmRouter.get("/crm/bootstrap", async (req: Request, res: Response) => {
  const me = req.crmUser!;
  const isPrivileged = me.role === "admin" || me.role === "leader";
  const [stages, products, users] = await Promise.all([
    db.select().from(crmPipelineStages).orderBy(asc(crmPipelineStages.sortOrder)),
    db.select().from(crmProducts).orderBy(asc(crmProducts.sortOrder)),
    isPrivileged
      ? db.select().from(crmUsers).orderBy(asc(crmUsers.id))
      : Promise.resolve([
          {
            id: me.id,
            email: me.email,
            firstName: me.firstName,
            lastName: me.lastName,
            role: me.role,
            isActive: me.isActive,
          },
        ]),
  ]);
  res.json({ stages, products, users, me });
});

function canSeeAllContacts(user: CrmUser) {
  return user.role === "admin" || user.role === "leader";
}

crmRouter.get("/crm/contacts", async (req: Request, res: Response) => {
  const me = req.crmUser!;
  const search = (req.query.search as string | undefined)?.trim();
  const stageId = req.query.stageId ? Number(req.query.stageId) : undefined;
  const conds: any[] = [];
  if (!canSeeAllContacts(me)) {
    conds.push(eq(crmContacts.assignedTo, me.id));
  }
  if (stageId && Number.isFinite(stageId)) {
    conds.push(eq(crmContacts.stageId, stageId));
  }
  if (search) {
    const like = `%${search}%`;
    conds.push(
      or(
        ilike(crmContacts.email, like),
        ilike(crmContacts.firstName, like),
        ilike(crmContacts.lastName, like),
        ilike(crmContacts.company, like),
      )!,
    );
  }
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db
    .select()
    .from(crmContacts)
    .where(where as any)
    .orderBy(asc(crmContacts.boardOrder), desc(crmContacts.id))
    .limit(500);
  res.json({ contacts: rows });
});

crmRouter.post("/crm/contacts", async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const email = String(b.email || "").trim();
  if (!email) {
    res.status(400).json({ error: "email required" });
    return;
  }
  const stagesRows = await db.select().from(crmPipelineStages).orderBy(asc(crmPipelineStages.sortOrder));
  const stageId =
    typeof b.stageId === "number"
      ? b.stageId
      : (stagesRows[0]?.id ?? null);
  try {
    const [inserted] = await db
      .insert(crmContacts)
      .values({
        email,
        phone: b.phone ?? null,
        firstName: b.firstName ?? null,
        lastName: b.lastName ?? null,
        company: b.company ?? null,
        source: b.source ?? "manual",
        stageId,
        assignedTo: b.assignedTo ?? null,
        valueCents: typeof b.valueCents === "number" ? b.valueCents : 0,
        notes: b.notes ?? null,
        lastActivityAt: new Date(),
      })
      .returning();
    res.json({ contact: inserted });
    return;
  } catch (err: any) {
    if (String(err?.message || "").includes("crm_contacts_email_lower_uq")) {
      res.status(409).json({ error: "email_exists" });
      return;
    }
    throw err;
  }
});

crmRouter.get("/crm/contacts/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const me = req.crmUser!;
  const [contact] = await db
    .select()
    .from(crmContacts)
    .where(eq(crmContacts.id, id))
    .limit(1);
  if (!contact) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!canSeeAllContacts(me) && contact.assignedTo !== me.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [activities, events, deals] = await Promise.all([
    db
      .select()
      .from(crmActivities)
      .where(eq(crmActivities.contactId, id))
      .orderBy(desc(crmActivities.occurredAt))
      .limit(200),
    db
      .select()
      .from(crmContactEvents)
      .where(eq(crmContactEvents.contactId, id))
      .orderBy(desc(crmContactEvents.occurredAt))
      .limit(200),
    db
      .select()
      .from(crmDeals)
      .where(eq(crmDeals.contactId, id))
      .orderBy(desc(crmDeals.createdAt)),
  ]);
  res.json({ contact, activities, events, deals });
});

crmRouter.patch("/crm/contacts/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const me = req.crmUser!;
  const [existing] = await db
    .select()
    .from(crmContacts)
    .where(eq(crmContacts.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!canSeeAllContacts(me) && existing.assignedTo !== me.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const b = req.body ?? {};
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of [
    "phone",
    "firstName",
    "lastName",
    "company",
    "source",
    "notes",
  ] as const) {
    if (k in b) patch[k] = b[k];
  }
  if (typeof b.valueCents === "number") patch.valueCents = b.valueCents;
  if (typeof b.stageId === "number") patch.stageId = b.stageId;
  if (typeof b.assignedTo === "number" || b.assignedTo === null) {
    if (me.role !== "admin" && me.role !== "leader") {
      res.status(403).json({ error: "Only leaders/admins can reassign" });
      return;
    }
    patch.assignedTo = b.assignedTo;
  }
  if (typeof b.boardOrder === "number") patch.boardOrder = b.boardOrder;
  const [updated] = await db
    .update(crmContacts)
    .set(patch)
    .where(eq(crmContacts.id, id))
    .returning();
  res.json({ contact: updated });
});

crmRouter.post(
  "/crm/contacts/:id/activities",
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const me = req.crmUser!;
    const [contact] = await db
      .select()
      .from(crmContacts)
      .where(eq(crmContacts.id, id))
      .limit(1);
    if (!contact) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!canSeeAllContacts(me) && contact.assignedTo !== me.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const b = req.body ?? {};
    const type = String(b.type || "note").trim();
    const [inserted] = await db
      .insert(crmActivities)
      .values({
        contactId: id,
        userId: me.id,
        type,
        subject: b.subject ?? null,
        body: b.body ?? null,
      })
      .returning();
    await db
      .update(crmContacts)
      .set({ lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(crmContacts.id, id));
    res.json({ activity: inserted });
  },
);

crmRouter.post(
  "/crm/contacts/:id/deals",
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const me = req.crmUser!;
    const [contact] = await db
      .select()
      .from(crmContacts)
      .where(eq(crmContacts.id, id))
      .limit(1);
    if (!contact) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!canSeeAllContacts(me) && contact.assignedTo !== me.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const b = req.body ?? {};
    const productId = typeof b.productId === "number" ? b.productId : null;
    let amountCents = typeof b.amountCents === "number" ? b.amountCents : 0;
    let commissionCents = 0;
    if (productId) {
      const [product] = await db
        .select()
        .from(crmProducts)
        .where(eq(crmProducts.id, productId))
        .limit(1);
      if (product) {
        if (!amountCents) amountCents = product.priceCents;
        commissionCents =
          Math.round((amountCents * product.commissionPct) / 100) +
          product.commissionFlatCents;
      }
    }
    // Members can only attribute deals to themselves; only leaders/admins
    // may set ownerId to another user. Default = contact owner if visible
    // to the caller, otherwise self.
    const requestedOwner =
      typeof b.ownerId === "number"
        ? b.ownerId
        : (contact.assignedTo ?? me.id);
    const ownerId =
      requestedOwner !== me.id && me.role !== "admin" && me.role !== "leader"
        ? me.id
        : requestedOwner;
    const status = String(b.status || "open");
    const [inserted] = await db
      .insert(crmDeals)
      .values({
        contactId: id,
        productId,
        ownerId,
        amountCents,
        commissionCents,
        status,
        notes: b.notes ?? null,
        closedAt: status === "won" || status === "lost" ? new Date() : null,
      })
      .returning();
    res.json({ deal: inserted });
  },
);

crmRouter.patch("/crm/deals/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const me = req.crmUser!;
  const [existing] = await db
    .select()
    .from(crmDeals)
    .where(eq(crmDeals.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (
    !canSeeAllContacts(me) &&
    existing.ownerId !== me.id
  ) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const b = req.body ?? {};
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof b.amountCents === "number") patch.amountCents = b.amountCents;
  if (typeof b.commissionCents === "number")
    patch.commissionCents = b.commissionCents;
  if (typeof b.status === "string") {
    patch.status = b.status;
    if (b.status === "won" || b.status === "lost") {
      patch.closedAt = new Date();
    }
  }
  if ("notes" in b) patch.notes = b.notes;
  const [updated] = await db
    .update(crmDeals)
    .set(patch)
    .where(eq(crmDeals.id, id))
    .returning();
  res.json({ deal: updated });
});

function periodCutoff(period: string): Date | null {
  const now = new Date();
  if (period === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  if (period === "month") {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return d;
  }
  return null;
}

crmRouter.get("/crm/leaderboard", async (req: Request, res: Response) => {
  const period = String(req.query.period || "all");
  const cutoff = periodCutoff(period);
  const wonFilter = cutoff
    ? and(eq(crmDeals.status, "won"), gte(crmDeals.closedAt, cutoff))
    : eq(crmDeals.status, "won");
  const openFilter = eq(crmDeals.status, "open");

  const rows = await db
    .select({
      userId: crmUsers.id,
      firstName: crmUsers.firstName,
      lastName: crmUsers.lastName,
      email: crmUsers.email,
      role: crmUsers.role,
      wonCount: sql<number>`coalesce(count(${crmDeals.id}) filter (where ${wonFilter}),0)::int`,
      wonAmountCents: sql<number>`coalesce(sum(${crmDeals.amountCents}) filter (where ${wonFilter}),0)::int`,
      commissionCents: sql<number>`coalesce(sum(${crmDeals.commissionCents}) filter (where ${wonFilter}),0)::int`,
      openCount: sql<number>`coalesce(count(${crmDeals.id}) filter (where ${openFilter}),0)::int`,
    })
    .from(crmUsers)
    .leftJoin(crmDeals, eq(crmDeals.ownerId, crmUsers.id))
    .where(eq(crmUsers.isActive, true))
    .groupBy(crmUsers.id)
    .orderBy(
      desc(sql`coalesce(sum(${crmDeals.amountCents}) filter (where ${wonFilter}),0)`),
    );

  const productRows = await db
    .select({
      userId: crmDeals.ownerId,
      productId: crmDeals.productId,
      productName: crmProducts.name,
      productSlug: crmProducts.slug,
      wonCount: sql<number>`count(${crmDeals.id})::int`,
      wonAmountCents: sql<number>`coalesce(sum(${crmDeals.amountCents}),0)::int`,
      commissionCents: sql<number>`coalesce(sum(${crmDeals.commissionCents}),0)::int`,
    })
    .from(crmDeals)
    .leftJoin(crmProducts, eq(crmDeals.productId, crmProducts.id))
    .where(wonFilter)
    .groupBy(crmDeals.ownerId, crmDeals.productId, crmProducts.name, crmProducts.slug);

  const byUser = new Map<number, typeof productRows>();
  for (const r of productRows) {
    if (r.userId == null) continue;
    const arr = byUser.get(r.userId) ?? [];
    arr.push(r);
    byUser.set(r.userId, arr);
  }
  const enriched = rows.map((r) => ({
    ...r,
    products: (byUser.get(r.userId) ?? []).map((p) => ({
      productId: p.productId,
      productName: p.productName ?? "Custom",
      productSlug: p.productSlug,
      wonCount: p.wonCount,
      wonAmountCents: p.wonAmountCents,
      commissionCents: p.commissionCents,
    })),
  }));
  res.json({ leaderboard: enriched, period });
});

crmRouter.get("/crm/pipeline-stages", async (_req: Request, res: Response) => {
  const stages = await db
    .select()
    .from(crmPipelineStages)
    .orderBy(asc(crmPipelineStages.sortOrder));
  res.json({ stages });
});

crmRouter.patch(
  "/crm/pipeline-stages/:id",
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const b = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (typeof b.label === "string") patch.label = b.label;
    if (typeof b.sortOrder === "number") patch.sortOrder = b.sortOrder;
    if (typeof b.isWon === "boolean") patch.isWon = b.isWon;
    if (typeof b.isLost === "boolean") patch.isLost = b.isLost;
    const [updated] = await db
      .update(crmPipelineStages)
      .set(patch)
      .where(eq(crmPipelineStages.id, id))
      .returning();
    res.json({ stage: updated });
  },
);

crmRouter.delete(
  "/crm/contacts/:id",
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const me = req.crmUser!;
    const [contact] = await db
      .select()
      .from(crmContacts)
      .where(eq(crmContacts.id, id))
      .limit(1);
    if (!contact) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (me.role !== "admin" && contact.assignedTo !== me.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await db.delete(crmContacts).where(eq(crmContacts.id, id));
    res.json({ ok: true });
  },
);

crmRouter.patch(
  "/crm/contacts/:id/stage",
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const me = req.crmUser!;
    const stageId = Number(req.body?.stageId);
    if (!Number.isFinite(stageId)) {
      res.status(400).json({ error: "stageId required" });
      return;
    }
    const [contact] = await db
      .select()
      .from(crmContacts)
      .where(eq(crmContacts.id, id))
      .limit(1);
    if (!contact) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!canSeeAllContacts(me) && contact.assignedTo !== me.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [stage] = await db
      .select()
      .from(crmPipelineStages)
      .where(eq(crmPipelineStages.id, stageId))
      .limit(1);
    if (!stage) {
      res.status(400).json({ error: "stage not found" });
      return;
    }
    const fromStageId = contact.stageId;
    const [updated] = await db
      .update(crmContacts)
      .set({ stageId, lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(crmContacts.id, id))
      .returning();
    if (fromStageId !== stageId) {
      await db.insert(crmContactEvents).values({
        contactId: id,
        eventName: "stage_changed",
        source: "crm",
        payload: {
          fromStageId,
          toStageId: stageId,
          toStageKey: stage.key,
          byUserId: me.id,
        },
      });
    }
    // Task #608 - Calendly stage-change reactor (fire-and-forget; tolerant
    // to partial failure so a Calendly outage never rolls back the move).
    if (fromStageId !== stageId) {
      void reactToStageChange({
        contactId: id,
        fromStageId,
        toStageId: stageId,
        byUserId: me.id,
      }).catch((err) =>
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), contactId: id },
          "[crm] reactToStageChange threw",
        ),
      );
    }
    res.json({ contact: updated });
    return;
  },
);

crmRouter.get("/crm/deals", async (req: Request, res: Response) => {
  const me = req.crmUser!;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const conds: Array<ReturnType<typeof eq>> = [];
  if (!canSeeAllContacts(me)) conds.push(eq(crmDeals.ownerId, me.id));
  if (status === "open" || status === "won" || status === "lost") {
    conds.push(eq(crmDeals.status, status));
  }
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db
    .select({
      id: crmDeals.id,
      contactId: crmDeals.contactId,
      contactEmail: crmContacts.email,
      contactFirstName: crmContacts.firstName,
      contactLastName: crmContacts.lastName,
      productId: crmDeals.productId,
      productName: crmProducts.name,
      ownerId: crmDeals.ownerId,
      amountCents: crmDeals.amountCents,
      commissionCents: crmDeals.commissionCents,
      status: crmDeals.status,
      notes: crmDeals.notes,
      closedAt: crmDeals.closedAt,
      createdAt: crmDeals.createdAt,
    })
    .from(crmDeals)
    .leftJoin(crmContacts, eq(crmContacts.id, crmDeals.contactId))
    .leftJoin(crmProducts, eq(crmProducts.id, crmDeals.productId))
    .where(where)
    .orderBy(desc(crmDeals.createdAt))
    .limit(500);
  res.json({ deals: rows });
});

crmRouter.get(
  "/crm/admin/webhook",
  requireRole("admin"),
  (_req: Request, res: Response) => {
    const key = getEnvWebhookKey();
    res.json({
      configured: Boolean(key),
      envVarName: "CRM_WEBHOOK_API_KEY",
    });
  },
);

// Admin-only Settings endpoints.
crmRouter.get(
  "/crm/admin/team",
  requireRole("admin"),
  async (_req: Request, res: Response) => {
    const rows = await db.select().from(crmUsers).orderBy(asc(crmUsers.id));
    res.json({ users: rows });
  },
);

crmRouter.post(
  "/crm/admin/team",
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const b = req.body ?? {};
    const email = String(b.email || "").trim();
    if (!email) {
      res.status(400).json({ error: "email required" });
      return;
    }
    const role = ["admin", "leader", "member"].includes(b.role) ? b.role : "member";
    try {
      const [inserted] = await db
        .insert(crmUsers)
        .values({
          email,
          firstName: b.firstName ?? null,
          lastName: b.lastName ?? null,
          role,
          isActive: true,
        })
        .returning();
      res.json({ user: inserted });
      return;
    } catch (err: any) {
      if (String(err?.message || "").includes("crm_users_email_lower_uq")) {
        res.status(409).json({ error: "email_exists" });
        return;
      }
      throw err;
    }
  },
);

crmRouter.patch(
  "/crm/admin/team/:id",
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const b = req.body ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof b.role === "string" && ["admin", "leader", "member"].includes(b.role)) {
      patch.role = b.role;
    }
    if (typeof b.isActive === "boolean") patch.isActive = b.isActive;
    if ("firstName" in b) patch.firstName = b.firstName;
    if ("lastName" in b) patch.lastName = b.lastName;
    const [updated] = await db
      .update(crmUsers)
      .set(patch)
      .where(eq(crmUsers.id, id))
      .returning();
    res.json({ user: updated });
  },
);

crmRouter.get(
  "/crm/admin/products",
  requireRole("admin"),
  async (_req: Request, res: Response) => {
    const rows = await db.select().from(crmProducts).orderBy(asc(crmProducts.sortOrder));
    res.json({ products: rows });
  },
);

crmRouter.post(
  "/crm/admin/products",
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const b = req.body ?? {};
    const slug = String(b.slug || "").trim();
    const name = String(b.name || "").trim();
    if (!slug || !name) {
      res.status(400).json({ error: "slug and name required" });
      return;
    }
    try {
      const [inserted] = await db
        .insert(crmProducts)
        .values({
          slug,
          name,
          priceCents: Number(b.priceCents) || 0,
          commissionPct: Number(b.commissionPct) || 0,
          commissionFlatCents: Number(b.commissionFlatCents) || 0,
          isActive: b.isActive !== false,
          sortOrder: Number(b.sortOrder) || 0,
        })
        .returning();
      res.json({ product: inserted });
      return;
    } catch (err: any) {
      if (String(err?.message || "").includes("crm_products_slug_unique") || String(err?.message || "").includes("duplicate")) {
        res.status(409).json({ error: "slug_exists" });
        return;
      }
      throw err;
    }
  },
);

crmRouter.patch(
  "/crm/admin/products/:id",
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const b = req.body ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if ("name" in b) patch.name = b.name;
    if (typeof b.priceCents === "number") patch.priceCents = b.priceCents;
    if (typeof b.commissionPct === "number") patch.commissionPct = b.commissionPct;
    if (typeof b.commissionFlatCents === "number")
      patch.commissionFlatCents = b.commissionFlatCents;
    if (typeof b.isActive === "boolean") patch.isActive = b.isActive;
    if (typeof b.sortOrder === "number") patch.sortOrder = b.sortOrder;
    const [updated] = await db
      .update(crmProducts)
      .set(patch)
      .where(eq(crmProducts.id, id))
      .returning();
    res.json({ product: updated });
  },
);

// Public read-only aliases (any authenticated CRM user). Writes stay
// under /crm/admin/* and remain admin-gated so the role boundary is
// preserved while still satisfying GET /crm/{products,team,deals}.
crmRouter.get("/crm/products", async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(crmProducts)
    .where(eq(crmProducts.isActive, true))
    .orderBy(asc(crmProducts.sortOrder));
  res.json({ products: rows });
});

// /crm/team is admin/leader only - non-privileged users must not see the
// org-wide roster (emails, roles). Members get their own record only.
crmRouter.get("/crm/team", async (req: Request, res: Response) => {
  const me = req.crmUser!;
  if (me.role !== "admin" && me.role !== "leader") {
    res.json({
      users: [
        {
          id: me.id,
          email: me.email,
          firstName: me.firstName,
          lastName: me.lastName,
          role: me.role,
          isActive: me.isActive,
        },
      ],
    });
    return;
  }
  const rows = await db
    .select({
      id: crmUsers.id,
      email: crmUsers.email,
      firstName: crmUsers.firstName,
      lastName: crmUsers.lastName,
      role: crmUsers.role,
      isActive: crmUsers.isActive,
    })
    .from(crmUsers)
    .where(eq(crmUsers.isActive, true))
    .orderBy(asc(crmUsers.id));
  res.json({ users: rows });
});

// Canonical write endpoints. Same handlers as /crm/admin/*; kept admin-gated.
crmRouter.post(
  "/crm/team",
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const b = req.body ?? {};
    const email = String(b.email || "").trim();
    if (!email) {
      res.status(400).json({ error: "email required" });
      return;
    }
    const role = ["admin", "leader", "member"].includes(b.role) ? b.role : "member";
    try {
      const [inserted] = await db
        .insert(crmUsers)
        .values({
          email,
          firstName: b.firstName ?? null,
          lastName: b.lastName ?? null,
          role,
          isActive: true,
        })
        .returning();
      res.json({ user: inserted });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("crm_users_email_lower_uq")) {
        res.status(409).json({ error: "email_exists" });
        return;
      }
      throw err;
    }
  },
);

crmRouter.patch(
  "/crm/team/:id",
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const b = req.body ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof b.role === "string" && ["admin", "leader", "member"].includes(b.role)) {
      patch.role = b.role;
    }
    if (typeof b.isActive === "boolean") patch.isActive = b.isActive;
    if ("firstName" in b) patch.firstName = b.firstName;
    if ("lastName" in b) patch.lastName = b.lastName;
    const [updated] = await db
      .update(crmUsers)
      .set(patch)
      .where(eq(crmUsers.id, id))
      .returning();
    res.json({ user: updated });
  },
);

crmRouter.post(
  "/crm/products",
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const b = req.body ?? {};
    const slug = String(b.slug || "").trim();
    const name = String(b.name || "").trim();
    if (!slug || !name) {
      res.status(400).json({ error: "slug and name required" });
      return;
    }
    try {
      const [inserted] = await db
        .insert(crmProducts)
        .values({
          slug,
          name,
          priceCents: Number(b.priceCents) || 0,
          commissionPct: Number(b.commissionPct) || 0,
          commissionFlatCents: Number(b.commissionFlatCents) || 0,
          isActive: b.isActive !== false,
          sortOrder: Number(b.sortOrder) || 0,
        })
        .returning();
      res.json({ product: inserted });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("crm_products_slug_unique") || msg.includes("duplicate")) {
        res.status(409).json({ error: "slug_exists" });
        return;
      }
      throw err;
    }
  },
);

crmRouter.patch(
  "/crm/products/:id",
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const b = req.body ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if ("name" in b) patch.name = b.name;
    if (typeof b.priceCents === "number") patch.priceCents = b.priceCents;
    if (typeof b.commissionPct === "number") patch.commissionPct = b.commissionPct;
    if (typeof b.commissionFlatCents === "number")
      patch.commissionFlatCents = b.commissionFlatCents;
    if (typeof b.isActive === "boolean") patch.isActive = b.isActive;
    if (typeof b.sortOrder === "number") patch.sortOrder = b.sortOrder;
    const [updated] = await db
      .update(crmProducts)
      .set(patch)
      .where(eq(crmProducts.id, id))
      .returning();
    res.json({ product: updated });
  },
);

// POST /crm/deals - any authed CRM user can create a deal on a contact
// they can see; reps cannot create deals on contacts they don't own.
crmRouter.post("/crm/deals", async (req: Request, res: Response) => {
  const me = req.crmUser!;
  const b = req.body ?? {};
  const contactId = Number(b.contactId);
  if (!Number.isFinite(contactId)) {
    res.status(400).json({ error: "contactId required" });
    return;
  }
  const [contact] = await db
    .select()
    .from(crmContacts)
    .where(eq(crmContacts.id, contactId))
    .limit(1);
  if (!contact) {
    res.status(404).json({ error: "contact_not_found" });
    return;
  }
  if (!canSeeAllContacts(me) && contact.assignedTo !== me.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // Only leaders/admins can attribute a deal to someone other than
  // themselves; reps always own deals they create.
  const requestedOwner =
    typeof b.ownerId === "number" && b.ownerId !== me.id ? b.ownerId : me.id;
  const ownerId =
    requestedOwner !== me.id && me.role !== "admin" && me.role !== "leader"
      ? me.id
      : requestedOwner;
  const [inserted] = await db
    .insert(crmDeals)
    .values({
      contactId,
      productId: b.productId ?? null,
      ownerId,
      amountCents: Number(b.amountCents) || 0,
      commissionCents: Number(b.commissionCents) || 0,
      status: ["open", "won", "lost"].includes(b.status) ? b.status : "open",
      closedAt: b.status === "won" || b.status === "lost" ? new Date() : null,
    })
    .returning();
  res.json({ deal: inserted });
});

export default crmRouter;
