import { Router } from "express";
import { getAuth } from "../lib/auth-compat";
import { db } from "@workspace/db";
import {
  portalUsersTable,
  aListCallsTable,
  aListTasksTable,
  aListRoadmapTable,
  dfyBuildAssetsTable,
  dfyClientUpdatesTable,
  dfyStripeConnectionsTable,
} from "@workspace/db";
import { eq, and, desc, asc, or } from "drizzle-orm";

const alistRouter = Router();

const requireAuth = async (req: any, res: any, next: any) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.clerkId, auth.userId));
  if (!user) { res.status(403).json({ error: "No portal account" }); return; }
  req.clerkId = auth.userId;
  req.portalUser = user;
  next();
};

// "DFY" = Done-For-You. We keep the underlying a_list_* table names — only the
// labels and the user-facing route are reworded. The flag column on
// portal_users (`is_a_list`) doubles as the DFY entitlement.
const requireAList = async (req: any, res: any, next: any) => {
  if (!req.portalUser.isActive && req.portalUser.role !== "admin") {
    res.status(403).json({ error: "Account not activated" }); return;
  }
  if (!req.portalUser.isAList && req.portalUser.role !== "admin") {
    res.status(403).json({ error: "Done-For-You access required" }); return;
  }
  next();
};

const requireAdmin = async (req: any, res: any, next: any) => {
  if (req.portalUser.role !== "admin") {
    res.status(403).json({ error: "Admin access required" }); return;
  }
  next();
};

function maskKey(key: string) {
  if (!key) return "";
  if (key.length <= 11) return key.substring(0, Math.min(3, key.length)) + "...";
  return key.substring(0, 7) + "..." + key.substring(key.length - 4);
}

// ─────────────────────────────────────────────────────────────────────────────
// Client dashboard — calls + tasks + roadmap (existing) plus DFY build assets
// and Stripe connection status.
// ─────────────────────────────────────────────────────────────────────────────
alistRouter.get("/portal/a-list/dashboard", requireAuth, requireAList, async (req: any, res) => {
  try {
    const userId = req.portalUser.id;

    const [calls, tasks, roadmap, buildAssets, stripeConn, clientUpdates] = await Promise.all([
      db.select().from(aListCallsTable).where(eq(aListCallsTable.userId, userId)).orderBy(desc(aListCallsTable.callDate)).limit(50),
      db.select().from(aListTasksTable).where(eq(aListTasksTable.userId, userId)).orderBy(desc(aListTasksTable.createdAt)),
      db.select().from(aListRoadmapTable).where(eq(aListRoadmapTable.userId, userId)).orderBy(asc(aListRoadmapTable.sortOrder)),
      db.select().from(dfyBuildAssetsTable).where(eq(dfyBuildAssetsTable.userId, userId)).orderBy(asc(dfyBuildAssetsTable.sortOrder), desc(dfyBuildAssetsTable.createdAt)),
      db.select().from(dfyStripeConnectionsTable).where(eq(dfyStripeConnectionsTable.userId, userId)),
      db.select().from(dfyClientUpdatesTable).where(eq(dfyClientUpdatesTable.userId, userId)).orderBy(desc(dfyClientUpdatesTable.createdAt)).limit(200),
    ]);

    const completedTasks = tasks.filter((t) => t.status === "completed").length;
    const completedMilestones = roadmap.filter((r) => r.status === "completed").length;

    const conn = stripeConn[0];
    const stripeConnection = conn
      ? {
          connected: true,
          maskedKey: maskKey(conn.stripeApiKey),
          accountLabel: conn.accountLabel,
          syncStatus: conn.syncStatus,
          lastSyncError: conn.lastSyncError,
          lastSyncAt: conn.lastSyncAt,
        }
      : { connected: false };

    res.json({
      user: {
        id: req.portalUser.id,
        firstName: req.portalUser.firstName,
        lastName: req.portalUser.lastName,
        email: req.portalUser.email,
        aListJoinedAt: req.portalUser.aListJoinedAt,
        avatarUrl: req.portalUser.avatarUrl,
        currentDfyPhase: req.portalUser.currentDfyPhase ?? 1,
        role: req.portalUser.role,
      },
      calls,
      tasks,
      roadmap,
      buildAssets,
      stripeConnection,
      clientUpdates,
      stats: {
        totalCalls: calls.length,
        totalTasks: tasks.length,
        completedTasks,
        totalMilestones: roadmap.length,
        completedMilestones,
        totalBuildAssets: buildAssets.length,
        openUpdates: clientUpdates.filter((u: any) => u.status === "open").length,
      },
    });
    return;
  } catch (err) {
    console.error("DFY dashboard error:", err);
    res.status(500).json({ error: "Failed to load Done-For-You dashboard" });
    return;
  }
});

alistRouter.post("/portal/a-list/calls", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const { userId, title, description, callDate, duration, recordingUrl, notes, callType } = req.body;
    if (!userId || !title || !callDate) {
      res.status(400).json({ error: "userId, title, and callDate are required" }); return;
    }
    const [call] = await db
      .insert(aListCallsTable)
      .values({
        userId,
        title,
        description: description || null,
        callDate: new Date(callDate),
        duration: duration || null,
        recordingUrl: recordingUrl || null,
        notes: notes || null,
        callType: callType || "one-on-one",
      })
      .returning();
    res.json(call);
    return;
  } catch (err) {
    console.error("Create call error:", err);
    res.status(500).json({ error: "Failed to create call" });
    return;
  }
});

alistRouter.patch("/portal/a-list/calls/:callId", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const callId = parseInt(req.params.callId);
    if (isNaN(callId)) { res.status(400).json({ error: "Invalid call ID" }); return; }
    const { title, description, callDate, duration, recordingUrl, notes, callType } = req.body;
    const updates: any = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (callDate !== undefined) updates.callDate = new Date(callDate);
    if (duration !== undefined) updates.duration = duration;
    if (recordingUrl !== undefined) updates.recordingUrl = recordingUrl || null;
    if (notes !== undefined) updates.notes = notes;
    if (callType !== undefined) updates.callType = callType;
    const [updated] = await db
      .update(aListCallsTable)
      .set(updates)
      .where(eq(aListCallsTable.id, callId))
      .returning();
    if (!updated) { res.status(404).json({ error: "Call not found" }); return; }
    res.json(updated);
    return;
  } catch (err) {
    console.error("Update call error:", err);
    res.status(500).json({ error: "Failed to update call" });
    return;
  }
});

alistRouter.delete("/portal/a-list/calls/:callId", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const callId = parseInt(req.params.callId);
    if (isNaN(callId)) { res.status(400).json({ error: "Invalid call ID" }); return; }
    await db.delete(aListCallsTable).where(eq(aListCallsTable.id, callId));
    res.json({ ok: true });
    return;
  } catch (err) {
    console.error("Delete call error:", err);
    res.status(500).json({ error: "Failed to delete call" });
    return;
  }
});

alistRouter.post("/portal/a-list/tasks", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const { userId, title, description, priority, dueDate } = req.body;
    if (!userId || !title) {
      res.status(400).json({ error: "userId and title are required" }); return;
    }
    const [task] = await db
      .insert(aListTasksTable)
      .values({
        userId,
        title,
        description: description || null,
        priority: priority || "medium",
        dueDate: dueDate ? new Date(dueDate) : null,
      })
      .returning();
    res.json(task);
    return;
  } catch (err) {
    console.error("Create task error:", err);
    res.status(500).json({ error: "Failed to create task" });
    return;
  }
});

alistRouter.patch("/portal/a-list/tasks/:taskId", requireAuth, requireAList, async (req: any, res) => {
  try {
    const taskId = parseInt(req.params.taskId);
    if (isNaN(taskId)) { res.status(400).json({ error: "Invalid task ID" }); return; }

    const [task] = await db.select().from(aListTasksTable).where(eq(aListTasksTable.id, taskId));
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    if (task.userId !== req.portalUser.id && req.portalUser.role !== "admin") {
      res.status(403).json({ error: "Not authorized" }); return;
    }

    const { status, title, description, priority, dueDate } = req.body;
    const updates: any = { updatedAt: new Date() };
    if (status) {
      updates.status = status;
      if (status === "completed") updates.completedAt = new Date();
    }
    if (title) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (priority) updates.priority = priority;
    if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;

    const [updated] = await db
      .update(aListTasksTable)
      .set(updates)
      .where(eq(aListTasksTable.id, taskId))
      .returning();
    res.json(updated);
    return;
  } catch (err) {
    console.error("Update task error:", err);
    res.status(500).json({ error: "Failed to update task" });
    return;
  }
});

alistRouter.post("/portal/a-list/roadmap", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const { userId, milestone, description, targetDate, sortOrder, phaseNumber, status } = req.body;
    if (!userId || !milestone) {
      res.status(400).json({ error: "userId and milestone are required" }); return;
    }
    const phase = [1, 2, 3, 4].includes(phaseNumber) ? phaseNumber : 2;
    const validStatuses = ["upcoming", "in-progress", "completed", "pending"];
    const st = typeof status === "string" && validStatuses.includes(status) ? status : "upcoming";
    const [item] = await db
      .insert(aListRoadmapTable)
      .values({
        userId,
        milestone,
        description: description || null,
        targetDate: targetDate ? new Date(targetDate) : null,
        sortOrder: sortOrder || 0,
        phaseNumber: phase,
        status: st,
      })
      .returning();
    res.json(item);
    return;
  } catch (err) {
    console.error("Create roadmap error:", err);
    res.status(500).json({ error: "Failed to create roadmap item" });
    return;
  }
});

alistRouter.patch("/portal/a-list/roadmap/:itemId", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const itemId = parseInt(req.params.itemId);
    if (isNaN(itemId)) { res.status(400).json({ error: "Invalid item ID" }); return; }

    const { status, milestone, description, targetDate, sortOrder } = req.body;
    const updates: any = {};
    if (status) {
      updates.status = status;
      if (status === "completed") updates.completedAt = new Date();
    }
    if (milestone) updates.milestone = milestone;
    if (description !== undefined) updates.description = description;
    if (targetDate !== undefined) updates.targetDate = targetDate ? new Date(targetDate) : null;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;

    const [updated] = await db
      .update(aListRoadmapTable)
      .set(updates)
      .where(eq(aListRoadmapTable.id, itemId))
      .returning();
    res.json(updated);
    return;
  } catch (err) {
    console.error("Update roadmap error:", err);
    res.status(500).json({ error: "Failed to update roadmap item" });
    return;
  }
});

alistRouter.delete("/portal/a-list/roadmap/:itemId", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const itemId = parseInt(req.params.itemId);
    if (isNaN(itemId)) { res.status(400).json({ error: "Invalid item ID" }); return; }
    await db.delete(aListRoadmapTable).where(eq(aListRoadmapTable.id, itemId));
    res.json({ ok: true });
    return;
  } catch (err) {
    console.error("Delete roadmap error:", err);
    res.status(500).json({ error: "Failed to delete roadmap item" });
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DFY build assets — admin manages, client views via dashboard.
// ─────────────────────────────────────────────────────────────────────────────

const VALID_ASSET_TYPES = ["link", "file", "doc"];
const VALID_ASSET_STATUSES = ["in-progress", "ready", "needs-review"];

function validateUrlOrNull(raw: unknown): string | null | "invalid" {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return "invalid";
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "invalid";
    return u.toString();
  } catch {
    return "invalid";
  }
}

alistRouter.get("/portal/a-list/admin/build-assets/:userId", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }
    const rows = await db
      .select()
      .from(dfyBuildAssetsTable)
      .where(eq(dfyBuildAssetsTable.userId, userId))
      .orderBy(asc(dfyBuildAssetsTable.sortOrder), desc(dfyBuildAssetsTable.createdAt));
    res.json({ buildAssets: rows });
    return;
  } catch (err) {
    console.error("List build assets error:", err);
    res.status(500).json({ error: "Failed to list build assets" });
    return;
  }
});

// Admin per-user list endpoints for calls and roadmap so the DFY admin
// panel can read & edit any client's data, not just their own.
alistRouter.get("/portal/a-list/admin/calls/:userId", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }
    const rows = await db
      .select()
      .from(aListCallsTable)
      .where(eq(aListCallsTable.userId, userId))
      .orderBy(desc(aListCallsTable.callDate))
      .limit(100);
    res.json({ calls: rows });
    return;
  } catch (err) {
    console.error("Admin list calls error:", err);
    res.status(500).json({ error: "Failed to list calls" });
    return;
  }
});

alistRouter.get("/portal/a-list/admin/roadmap/:userId", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }
    const rows = await db
      .select()
      .from(aListRoadmapTable)
      .where(eq(aListRoadmapTable.userId, userId))
      .orderBy(asc(aListRoadmapTable.sortOrder));
    res.json({ roadmap: rows });
    return;
  } catch (err) {
    console.error("Admin list roadmap error:", err);
    res.status(500).json({ error: "Failed to list roadmap" });
    return;
  }
});

alistRouter.post("/portal/a-list/build-assets", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const { userId, title, category, assetType, url, notes, status, sortOrder, phaseNumber } = req.body ?? {};
    if (!userId || typeof userId !== "number") {
      res.status(400).json({ error: "userId is required" }); return;
    }
    if (!title || typeof title !== "string" || !title.trim()) {
      res.status(400).json({ error: "title is required" }); return;
    }
    const at = typeof assetType === "string" && VALID_ASSET_TYPES.includes(assetType) ? assetType : "link";
    const st = typeof status === "string" && VALID_ASSET_STATUSES.includes(status) ? status : "ready";
    const cleanUrl = validateUrlOrNull(url);
    if (cleanUrl === "invalid") {
      res.status(400).json({ error: "url must be a valid http(s) URL or empty" }); return;
    }
    const phase = [1, 2, 3, 4].includes(phaseNumber) ? phaseNumber : 2;
    const [row] = await db
      .insert(dfyBuildAssetsTable)
      .values({
        userId,
        title: title.trim(),
        category: typeof category === "string" && category.trim() ? category.trim() : "general",
        assetType: at,
        url: cleanUrl,
        notes: typeof notes === "string" ? notes : null,
        status: st,
        sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
        phaseNumber: phase,
      })
      .returning();
    res.json({ buildAsset: row });
    return;
  } catch (err) {
    console.error("Create build asset error:", err);
    res.status(500).json({ error: "Failed to create build asset" });
    return;
  }
});

alistRouter.patch("/portal/a-list/build-assets/:id", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { title, category, assetType, url, notes, status, sortOrder } = req.body ?? {};
    const updates: any = { updatedAt: new Date() };
    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim()) {
        res.status(400).json({ error: "title must be a non-empty string" }); return;
      }
      updates.title = title.trim();
    }
    if (category !== undefined) {
      updates.category = typeof category === "string" && category.trim() ? category.trim() : "general";
    }
    if (assetType !== undefined) {
      if (typeof assetType !== "string" || !VALID_ASSET_TYPES.includes(assetType)) {
        res.status(400).json({ error: `assetType must be one of ${VALID_ASSET_TYPES.join(", ")}` }); return;
      }
      updates.assetType = assetType;
    }
    if (url !== undefined) {
      const cleanUrl = validateUrlOrNull(url);
      if (cleanUrl === "invalid") {
        res.status(400).json({ error: "url must be a valid http(s) URL or empty" }); return;
      }
      updates.url = cleanUrl;
    }
    if (notes !== undefined) updates.notes = notes;
    if (status !== undefined) {
      if (typeof status !== "string" || !VALID_ASSET_STATUSES.includes(status)) {
        res.status(400).json({ error: `status must be one of ${VALID_ASSET_STATUSES.join(", ")}` }); return;
      }
      updates.status = status;
    }
    if (sortOrder !== undefined && typeof sortOrder === "number") updates.sortOrder = sortOrder;
    const [row] = await db
      .update(dfyBuildAssetsTable)
      .set(updates)
      .where(eq(dfyBuildAssetsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Build asset not found" }); return; }
    res.json({ buildAsset: row });
    return;
  } catch (err) {
    console.error("Update build asset error:", err);
    res.status(500).json({ error: "Failed to update build asset" });
    return;
  }
});

alistRouter.delete("/portal/a-list/build-assets/:id", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    await db.delete(dfyBuildAssetsTable).where(eq(dfyBuildAssetsTable.id, id));
    res.json({ ok: true });
    return;
  } catch (err) {
    console.error("Delete build asset error:", err);
    res.status(500).json({ error: "Failed to delete build asset" });
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DFY client Stripe connection — the client pastes their Stripe restricted
// key so admin can read 7/30/90-day revenue totals from the DFY page.
// ─────────────────────────────────────────────────────────────────────────────

const STRIPE_RK_RE = /^rk_(live|test)_[A-Za-z0-9]+$/;

alistRouter.post("/portal/a-list/connect-stripe", requireAuth, requireAList, async (req: any, res) => {
  try {
    const { stripeApiKey, accountLabel } = req.body ?? {};
    if (!stripeApiKey || typeof stripeApiKey !== "string") {
      res.status(400).json({ error: "Stripe restricted API key is required" }); return;
    }
    const trimmed = stripeApiKey.trim();
    if (!STRIPE_RK_RE.test(trimmed)) {
      res.status(400).json({
        error: "That doesn't look like a Stripe restricted key. It must start with rk_live_ or rk_test_.",
      }); return;
    }
    // Validate against Stripe.
    try {
      const r = await fetch("https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (!r.ok) {
        const body: any = await r.json().catch(() => ({}));
        const msg = body?.error?.message || "Could not authenticate with Stripe.";
        res.status(400).json({ error: `Invalid Stripe key. ${msg}` }); return;
      }
    } catch {
      res.status(400).json({ error: "Could not verify Stripe API key" }); return;
    }

    const userId = req.portalUser.id;
    const label = typeof accountLabel === "string" ? accountLabel.trim() || null : null;
    const now = new Date();
    const [existing] = await db
      .select()
      .from(dfyStripeConnectionsTable)
      .where(eq(dfyStripeConnectionsTable.userId, userId));
    let row;
    if (existing) {
      [row] = await db
        .update(dfyStripeConnectionsTable)
        .set({
          stripeApiKey: trimmed,
          accountLabel: label,
          syncStatus: "ok",
          lastSyncError: null,
          updatedAt: now,
        })
        .where(eq(dfyStripeConnectionsTable.userId, userId))
        .returning();
    } else {
      [row] = await db
        .insert(dfyStripeConnectionsTable)
        .values({
          userId,
          stripeApiKey: trimmed,
          accountLabel: label,
        })
        .returning();
    }
    res.json({
      success: true,
      connection: {
        connected: true,
        maskedKey: maskKey(row.stripeApiKey),
        accountLabel: row.accountLabel,
        syncStatus: row.syncStatus,
        lastSyncError: row.lastSyncError,
        lastSyncAt: row.lastSyncAt,
      },
    });
    return;
  } catch (err) {
    console.error("DFY Stripe connect error:", err);
    res.status(500).json({ error: "Failed to connect Stripe" });
    return;
  }
});

alistRouter.post("/portal/a-list/disconnect-stripe", requireAuth, requireAList, async (req: any, res) => {
  try {
    await db
      .delete(dfyStripeConnectionsTable)
      .where(eq(dfyStripeConnectionsTable.userId, req.portalUser.id));
    res.json({ success: true });
    return;
  } catch (err) {
    console.error("DFY Stripe disconnect error:", err);
    res.status(500).json({ error: "Failed to disconnect Stripe" });
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin DFY revenue snapshot — 7 / 30 / 90 day rolling totals from the
// client's connected Stripe account.
// ─────────────────────────────────────────────────────────────────────────────

async function fetchStripeChargeTotals(apiKey: string, sinceTs: number): Promise<
  | { totalCents: number; charges: number }
  | { error: string; authFailed?: boolean }
> {
  let totalCents = 0;
  let charges = 0;
  let hasMore = true;
  let startingAfter: string | null = null;
  let pages = 0;
  while (hasMore && pages < 50) {
    const url = new URL("https://api.stripe.com/v1/charges");
    url.searchParams.set("created[gte]", String(sinceTs));
    url.searchParams.set("limit", "100");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) {
      const body: any = await resp.json().catch(() => ({}));
      const msg = body?.error?.message || `HTTP ${resp.status}`;
      if (resp.status === 401 || resp.status === 403) {
        return { error: `Stripe rejected the key: ${msg}`, authFailed: true };
      }
      return { error: `Failed to fetch charges from Stripe: ${msg}` };
    }
    const data = await resp.json() as any;
    const items: any[] = data.data || [];
    for (const c of items) {
      const amount = Number(c.amount || 0);
      if (c.status === "succeeded" && amount > 0) {
        totalCents += amount;
        charges++;
      }
    }
    hasMore = !!data.has_more && items.length > 0;
    if (hasMore) startingAfter = items[items.length - 1].id;
    pages++;
  }
  return { totalCents, charges };
}

alistRouter.get("/portal/a-list/admin/revenue/:userId", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }

    const [conn] = await db
      .select()
      .from(dfyStripeConnectionsTable)
      .where(eq(dfyStripeConnectionsTable.userId, userId));

    if (!conn) {
      res.json({
        connected: false,
        windows: null,
      }); return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const sinceMap = {
      "7": nowSec - 7 * 24 * 60 * 60,
      "30": nowSec - 30 * 24 * 60 * 60,
      "90": nowSec - 90 * 24 * 60 * 60,
    };

    const [w7, w30, w90] = await Promise.all([
      fetchStripeChargeTotals(conn.stripeApiKey, sinceMap["7"]),
      fetchStripeChargeTotals(conn.stripeApiKey, sinceMap["30"]),
      fetchStripeChargeTotals(conn.stripeApiKey, sinceMap["90"]),
    ]);

    // If any window failed with auth error, persist auth_failed status so the
    // client sees it on their dashboard and can re-enter the key.
    const anyAuthFailure = [w7, w30, w90].some((r) => "error" in r && r.authFailed);
    if (anyAuthFailure) {
      await db
        .update(dfyStripeConnectionsTable)
        .set({
          syncStatus: "auth_failed",
          lastSyncError: ((w7 as any).error || (w30 as any).error || (w90 as any).error || "Stripe rejected the key"),
          updatedAt: new Date(),
        })
        .where(eq(dfyStripeConnectionsTable.userId, userId));
      res.status(400).json({
        connected: true,
        authFailed: true,
        error: (w7 as any).error || (w30 as any).error || (w90 as any).error,
      }); return;
    }

    const anyError = [w7, w30, w90].find((r) => "error" in r);
    if (anyError) {
      res.status(502).json({ connected: true, error: (anyError as any).error }); return;
    }

    await db
      .update(dfyStripeConnectionsTable)
      .set({
        syncStatus: "ok",
        lastSyncError: null,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(dfyStripeConnectionsTable.userId, userId));

    res.json({
      connected: true,
      accountLabel: conn.accountLabel,
      maskedKey: maskKey(conn.stripeApiKey),
      windows: {
        last7Days: w7,
        last30Days: w30,
        last90Days: w90,
      },
    });
    return;
  } catch (err) {
    console.error("DFY admin revenue error:", err);
    res.status(500).json({ error: "Failed to load DFY revenue" });
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DFY phase management — admin sets which phase the client is currently in.
// Drives which tab opens by default and which milestones are highlighted.
// ─────────────────────────────────────────────────────────────────────────────

alistRouter.patch("/portal/a-list/admin/set-phase/:userId", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const targetId = parseInt(req.params.userId);
    if (isNaN(targetId)) { res.status(400).json({ error: "Invalid user ID" }); return; }
    const phase = parseInt(req.body?.phase);
    if (![1, 2, 3, 4].includes(phase)) {
      res.status(400).json({ error: "phase must be 1, 2, 3 or 4" }); return;
    }
    const [row] = await db
      .update(portalUsersTable)
      .set({ currentDfyPhase: phase, updatedAt: new Date() })
      .where(eq(portalUsersTable.id, targetId))
      .returning();
    if (!row) { res.status(404).json({ error: "User not found" }); return; }
    res.json({ ok: true, currentDfyPhase: row.currentDfyPhase });
    return;
  } catch (err) {
    console.error("Set DFY phase error:", err);
    res.status(500).json({ error: "Failed to set phase" });
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DFY client updates / requests channel.
// Both admin and client can post. Admin posts default to kind="update";
// client posts default to kind="request". Replies use parentId.
// ─────────────────────────────────────────────────────────────────────────────

const VALID_UPDATE_KINDS = ["update", "request", "reply"];
const VALID_UPDATE_STATUSES = ["open", "answered", "archived"];

alistRouter.get("/portal/a-list/client-updates", requireAuth, requireAList, async (req: any, res) => {
  try {
    const userId = req.portalUser.id;
    const rows = await db
      .select()
      .from(dfyClientUpdatesTable)
      .where(eq(dfyClientUpdatesTable.userId, userId))
      .orderBy(desc(dfyClientUpdatesTable.createdAt))
      .limit(200);
    res.json({ updates: rows });
    return;
  } catch (err) {
    console.error("List client updates error:", err);
    res.status(500).json({ error: "Failed to list updates" });
    return;
  }
});

// Admin can list any client's channel.
alistRouter.get("/portal/a-list/admin/client-updates/:userId", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }
    const rows = await db
      .select()
      .from(dfyClientUpdatesTable)
      .where(eq(dfyClientUpdatesTable.userId, userId))
      .orderBy(desc(dfyClientUpdatesTable.createdAt))
      .limit(200);
    res.json({ updates: rows });
    return;
  } catch (err) {
    console.error("Admin list client updates error:", err);
    res.status(500).json({ error: "Failed to list updates" });
    return;
  }
});

alistRouter.post("/portal/a-list/client-updates", requireAuth, requireAList, async (req: any, res) => {
  try {
    const isAdmin = req.portalUser.role === "admin";
    const { userId: bodyUserId, title, body, kind, phaseNumber, parentId } = req.body ?? {};
    const targetUserId = isAdmin && typeof bodyUserId === "number" ? bodyUserId : req.portalUser.id;

    if (!body || typeof body !== "string" || !body.trim()) {
      res.status(400).json({ error: "body is required" }); return;
    }
    const k = typeof kind === "string" && VALID_UPDATE_KINDS.includes(kind)
      ? kind
      : isAdmin ? "update" : "request";
    const phase = [1, 2, 3, 4].includes(phaseNumber) ? phaseNumber : 2;
    const authorRole = isAdmin ? "admin" : "client";
    const authorName = [req.portalUser.firstName, req.portalUser.lastName]
      .filter(Boolean).join(" ").trim() || req.portalUser.email;

    // Validate parentId: must exist, belong to the same channel (userId), and
    // be a root post (not a reply to a reply). Otherwise reject so we don't
    // create dangling cross-channel references.
    let resolvedParentId: number | null = null;
    if (typeof parentId === "number" && Number.isFinite(parentId)) {
      const [parent] = await db
        .select()
        .from(dfyClientUpdatesTable)
        .where(eq(dfyClientUpdatesTable.id, parentId));
      if (!parent) {
        res.status(400).json({ error: "parentId does not exist" }); return;
      }
      if (parent.userId !== targetUserId) {
        res.status(400).json({ error: "parentId belongs to a different channel" }); return;
      }
      if (parent.parentId !== null) {
        res.status(400).json({ error: "parentId must be a root post, not a reply" }); return;
      }
      resolvedParentId = parentId;
    }

    const [row] = await db
      .insert(dfyClientUpdatesTable)
      .values({
        userId: targetUserId,
        authorRole,
        authorName,
        kind: k,
        title: typeof title === "string" && title.trim() ? title.trim() : null,
        body: body.trim(),
        phaseNumber: phase,
        parentId: resolvedParentId,
        status: "open",
      })
      .returning();
    res.json({ update: row });
    return;
  } catch (err) {
    console.error("Create client update error:", err);
    res.status(500).json({ error: "Failed to post update" });
    return;
  }
});

alistRouter.patch("/portal/a-list/client-updates/:id", requireAuth, requireAList, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [existing] = await db
      .select()
      .from(dfyClientUpdatesTable)
      .where(eq(dfyClientUpdatesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const isAdmin = req.portalUser.role === "admin";
    // Non-admins must own the channel (be the user_id) to touch a row at all.
    if (!isAdmin && existing.userId !== req.portalUser.id) {
      res.status(403).json({ error: "Not authorized" }); return;
    }
    const isAuthor = existing.authorRole === "client" && existing.userId === req.portalUser.id;
    const { status, body, title } = req.body ?? {};
    const updates: any = { updatedAt: new Date() };
    if (status !== undefined) {
      if (!VALID_UPDATE_STATUSES.includes(status)) {
        res.status(400).json({ error: "invalid status" }); return;
      }
      // Status changes: admins anywhere; non-admin clients only on posts they
      // themselves authored. Prevents a client from archiving / re-opening
      // admin-authored updates in their channel.
      if (!isAdmin && !isAuthor) {
        res.status(403).json({ error: "Only the author can change status" }); return;
      }
      updates.status = status;
    }
    if (body !== undefined) {
      if (!isAdmin && !isAuthor) {
        res.status(403).json({ error: "Only the author can edit the body" }); return;
      }
      if (typeof body !== "string" || !body.trim()) {
        res.status(400).json({ error: "body must be non-empty" }); return;
      }
      updates.body = body.trim();
    }
    if (title !== undefined) {
      if (!isAdmin && !isAuthor) {
        res.status(403).json({ error: "Only the author can edit the title" }); return;
      }
      updates.title = typeof title === "string" && title.trim() ? title.trim() : null;
    }
    const [row] = await db
      .update(dfyClientUpdatesTable)
      .set(updates)
      .where(eq(dfyClientUpdatesTable.id, id))
      .returning();
    res.json({ update: row });
    return;
  } catch (err) {
    console.error("Update client update error:", err);
    res.status(500).json({ error: "Failed to update" });
    return;
  }
});

alistRouter.delete("/portal/a-list/client-updates/:id", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    await db.delete(dfyClientUpdatesTable).where(eq(dfyClientUpdatesTable.id, id));
    res.json({ ok: true });
    return;
  } catch (err) {
    console.error("Delete client update error:", err);
    res.status(500).json({ error: "Failed to delete" });
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// One-shot demo seed for greg@cookemedia.io. Idempotent: only seeds if the
// user has zero milestones, assets and updates. Sets phase to 2 (Build).
// ─────────────────────────────────────────────────────────────────────────────

alistRouter.post("/portal/a-list/admin/seed-demo", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const targetEmail = (typeof req.body?.email === "string" ? req.body.email : "greg@cookemedia.io").toLowerCase();
    const [target] = await db
      .select()
      .from(portalUsersTable)
      .where(eq(portalUsersTable.email, targetEmail));
    if (!target) { res.status(404).json({ error: `No portal user for ${targetEmail}` }); return; }

    // Always re-assert DFY entitlement + phase so the seed converges even on
    // partial / re-runs. Insertion of demo content is still gated by the
    // "no existing rows" check below.
    await db
      .update(portalUsersTable)
      .set({
        currentDfyPhase: 2,
        isAList: true,
        aListJoinedAt: target.aListJoinedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(portalUsersTable.id, target.id));

    const [existingMilestones, existingAssets, existingUpdates] = await Promise.all([
      db.select().from(aListRoadmapTable).where(eq(aListRoadmapTable.userId, target.id)),
      db.select().from(dfyBuildAssetsTable).where(eq(dfyBuildAssetsTable.userId, target.id)),
      db.select().from(dfyClientUpdatesTable).where(eq(dfyClientUpdatesTable.userId, target.id)),
    ]);
    if (existingMilestones.length || existingAssets.length || existingUpdates.length) {
      res.json({ ok: true, alreadySeeded: true, userId: target.id }); return;
    }

    const now = Date.now();
    const day = 86400000;

    // Milestones across all 4 phases.
    const milestones = [
      // Phase 1 War Map
      { milestone: "War Map call booked", description: "30-minute strategy session locked in.", status: "completed", phaseNumber: 1, sortOrder: 10, completedAt: new Date(now - 18 * day), targetDate: new Date(now - 18 * day) },
      { milestone: "Offer math approved", description: "Price, margins and rev targets signed off.", status: "completed", phaseNumber: 1, sortOrder: 20, completedAt: new Date(now - 17 * day), targetDate: new Date(now - 17 * day) },
      { milestone: "Build brief delivered", description: "Final brief sent to the build team.", status: "completed", phaseNumber: 1, sortOrder: 30, completedAt: new Date(now - 16 * day), targetDate: new Date(now - 16 * day) },
      // Phase 2 Build (current)
      { milestone: "Cold open recordings finalized", description: "Three top-of-funnel hooks recorded and approved.", status: "completed", phaseNumber: 2, sortOrder: 40, completedAt: new Date(now - 9 * day), targetDate: new Date(now - 9 * day) },
      { milestone: "Funnel pages built", description: "Sales page, order form, upsell and thank-you live in staging.", status: "in-progress", phaseNumber: 2, sortOrder: 50, targetDate: new Date(now + 3 * day) },
      { milestone: "Email sequences written", description: "Welcome, post-purchase and abandoned cart drafted.", status: "in-progress", phaseNumber: 2, sortOrder: 60, targetDate: new Date(now + 5 * day) },
      { milestone: "Ad creative cut and queued", description: "Six static and four video creatives produced.", status: "upcoming", phaseNumber: 2, sortOrder: 70, targetDate: new Date(now + 7 * day) },
      // Phase 3 Launch
      { milestone: "Launch call scheduled", description: "Walk through the live funnel and push it live with Greg.", status: "upcoming", phaseNumber: 3, sortOrder: 80, targetDate: new Date(now + 12 * day) },
      { milestone: "First 7-day push", description: "Daily review of performance and quick fixes.", status: "upcoming", phaseNumber: 3, sortOrder: 90, targetDate: new Date(now + 19 * day) },
      // Phase 4 Live Workshops
      { milestone: "Weekly workshop access", description: "Standing live workshops every Tuesday for 12 weeks.", status: "upcoming", phaseNumber: 4, sortOrder: 100, targetDate: new Date(now + 14 * day) },
    ];
    await db.insert(aListRoadmapTable).values(milestones.map((m) => ({ ...m, userId: target.id })));

    // Build assets pinned to phase 2.
    const assets = [
      { title: "Cold open recordings - master folder", category: "creative", assetType: "link" as const, url: "https://drive.google.com/drive/folders/cold-opens-demo", notes: "All three hooks plus B-roll. Final cuts approved.", status: "ready" as const, phaseNumber: 2, sortOrder: 10 },
      { title: "Funnel build - staging link", category: "funnel", assetType: "link" as const, url: "https://staging.apexoffers.io/cooke", notes: "Sales page, order form and upsell. Final QA pass underway.", status: "in-progress" as const, phaseNumber: 2, sortOrder: 20 },
      { title: "Welcome email sequence (5 emails)", category: "emails", assetType: "doc" as const, url: "https://docs.google.com/document/d/welcome-seq-demo", notes: "Day 0 to day 14, indoctrination plus first soft pitch.", status: "needs-review" as const, phaseNumber: 2, sortOrder: 30 },
      { title: "Ad creative pack - V1", category: "ads", assetType: "link" as const, url: "https://drive.google.com/drive/folders/ad-pack-v1", notes: "Six statics and four 30-second videos. Ready to upload to Ads Manager.", status: "ready" as const, phaseNumber: 2, sortOrder: 40 },
      { title: "Automation map (Zapier)", category: "automation", assetType: "doc" as const, url: "https://miro.com/board/automation-map-demo", notes: "Lead capture into CRM, tag application, slack alerts on purchase.", status: "in-progress" as const, phaseNumber: 2, sortOrder: 50 },
      // Phase 1 deliverables (completed)
      { title: "War Map document - final", category: "war-map", assetType: "doc" as const, url: "https://docs.google.com/document/d/war-map-final-demo", notes: "Locked offer, math, build scope and launch plan.", status: "ready" as const, phaseNumber: 1, sortOrder: 10 },
    ];
    await db.insert(dfyBuildAssetsTable).values(assets.map((a) => ({ ...a, userId: target.id })));

    // Updates / requests channel content.
    const updates = [
      { authorRole: "admin", authorName: "Apex Build Team", kind: "update", title: "Build kickoff complete", body: "Funnel pages are wireframed and the copy is in review. We will have a staging link for you by end of day Thursday.", phaseNumber: 2, status: "open" },
      { authorRole: "admin", authorName: "Apex Build Team", kind: "request", title: "Brand assets needed", body: "Please drop your logo (SVG and PNG transparent), brand fonts and three hero shots in the shared folder so we can finalize the funnel pages.", phaseNumber: 2, status: "open" },
      { authorRole: "client", authorName: "Gregory Cooke", kind: "reply", title: null, body: "Logo and fonts uploaded to the Drive folder. Hero shots coming Tuesday from the photo shoot.", phaseNumber: 2, status: "open" },
      { authorRole: "admin", authorName: "Apex Build Team", kind: "update", title: "Cold open recordings approved", body: "Hook 3 tested strongest in the focus pull. We are leading the ad rotation with that one.", phaseNumber: 2, status: "open" },
      { authorRole: "admin", authorName: "Apex Build Team", kind: "update", title: "War Map locked", body: "Offer math approved, build brief signed off and handed to the team. Phase 2 is officially in motion.", phaseNumber: 1, status: "answered" },
    ];
    await db.insert(dfyClientUpdatesTable).values(updates.map((u) => ({ ...u, userId: target.id })));

    res.json({ ok: true, seeded: true, userId: target.id });
    return;
  } catch (err: any) {
    console.error("Seed demo error:", err);
    res.status(500).json({ error: err?.message || "Failed to seed" });
    return;
  }
});

export default alistRouter;
