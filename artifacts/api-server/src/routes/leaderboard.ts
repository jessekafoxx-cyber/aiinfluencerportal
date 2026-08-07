import { Router } from "express";
import { getAuth } from "../lib/auth-compat";
import { db } from "@workspace/db";
import {
  portalUsersTable,
  leaderboardProfilesTable,
  leaderboardRevenueTable,
  ordersTable,
} from "@workspace/db";
import { eq, and, desc, sql, gte, lte, sum, count, ne, isNotNull } from "drizzle-orm";
import { sendEmail } from "../lib/email.js";

const leaderboardRouter = Router();

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

function getDateRange(period: string) {
  const now = new Date();
  const start = new Date(now);
  if (period === "day") {
    start.setHours(0, 0, 0, 0);
  } else if (period === "week") {
    const dayOfWeek = start.getDay();
    start.setDate(start.getDate() - dayOfWeek);
    start.setHours(0, 0, 0, 0);
  } else if (period === "all") {
    start.setTime(0);
  } else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
  return { start, end: now };
}

// Public read-only leaderboard for the marketing/sales pages.
// Mirrors the data shown to logged-in members at /portal/leaderboard so the
// public-facing leaderboard always matches the live portal.
leaderboardRouter.get("/public/leaderboard", async (req, res) => {
  try {
    const period = (req.query.period as string) || "month";
    const limit = Math.min(parseInt((req.query.limit as string) || "10", 10) || 10, 50);
    const { start, end } = getDateRange(period);

    const results = await db
      .select({
        profileId: leaderboardProfilesTable.id,
        tagName: leaderboardProfilesTable.tagName,
        niche: leaderboardProfilesTable.niche,
        totalRevenue: sql<number>`COALESCE(SUM(CASE WHEN ${leaderboardRevenueTable.recordedAt} >= ${start} AND ${leaderboardRevenueTable.recordedAt} <= ${end} THEN ${leaderboardRevenueTable.amount} ELSE 0 END), 0)`.as("total_revenue"),
      })
      .from(leaderboardProfilesTable)
      .leftJoin(
        leaderboardRevenueTable,
        eq(leaderboardProfilesTable.id, leaderboardRevenueTable.profileId)
      )
      .where(eq(leaderboardProfilesTable.isPublic, true))
      .groupBy(
        leaderboardProfilesTable.id,
        leaderboardProfilesTable.tagName,
        leaderboardProfilesTable.niche
      )
      .orderBy(sql`total_revenue DESC`)
      .limit(limit);

    const leaderboard = results.map((r, index) => ({
      rank: index + 1,
      profileId: r.profileId,
      tagName: r.tagName,
      niche: r.niche || "",
      totalRevenue: Number(r.totalRevenue),
    }));

    const totalRevenueAll = leaderboard.reduce((s, r) => s + r.totalRevenue, 0);

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.json({
      leaderboard,
      stats: {
        totalParticipants: leaderboard.length,
        totalRevenue: totalRevenueAll,
        period,
      },
    });
    return;
  } catch (err) {
    console.error("Public leaderboard fetch error:", err);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
    return;
  }
});

leaderboardRouter.get("/portal/leaderboard", requireAuth, async (req: any, res) => {
  try {
    const period = (req.query.period as string) || "month";
    const { start, end } = getDateRange(period);

    const results = await db
      .select({
        profileId: leaderboardProfilesTable.id,
        tagName: leaderboardProfilesTable.tagName,
        avatarUrl: leaderboardProfilesTable.avatarUrl,
        niche: leaderboardProfilesTable.niche,
        isConnected: leaderboardProfilesTable.isConnected,
        totalRevenue: sql<number>`COALESCE(SUM(CASE WHEN ${leaderboardRevenueTable.recordedAt} >= ${start} AND ${leaderboardRevenueTable.recordedAt} <= ${end} THEN ${leaderboardRevenueTable.amount} ELSE 0 END), 0)`.as("total_revenue"),
        lowTicketCount: sql<number>`COALESCE(SUM(CASE WHEN ${leaderboardRevenueTable.saleType} = 'low-ticket' AND ${leaderboardRevenueTable.recordedAt} >= ${start} AND ${leaderboardRevenueTable.recordedAt} <= ${end} THEN 1 ELSE 0 END), 0)`.as("low_ticket_count"),
        highTicketCount: sql<number>`COALESCE(SUM(CASE WHEN ${leaderboardRevenueTable.saleType} = 'high-ticket' AND ${leaderboardRevenueTable.recordedAt} >= ${start} AND ${leaderboardRevenueTable.recordedAt} <= ${end} THEN 1 ELSE 0 END), 0)`.as("high_ticket_count"),
        lowTicketRevenue: sql<number>`COALESCE(SUM(CASE WHEN ${leaderboardRevenueTable.saleType} = 'low-ticket' AND ${leaderboardRevenueTable.recordedAt} >= ${start} AND ${leaderboardRevenueTable.recordedAt} <= ${end} THEN ${leaderboardRevenueTable.amount} ELSE 0 END), 0)`.as("low_ticket_revenue"),
        highTicketRevenue: sql<number>`COALESCE(SUM(CASE WHEN ${leaderboardRevenueTable.saleType} = 'high-ticket' AND ${leaderboardRevenueTable.recordedAt} >= ${start} AND ${leaderboardRevenueTable.recordedAt} <= ${end} THEN ${leaderboardRevenueTable.amount} ELSE 0 END), 0)`.as("high_ticket_revenue"),
      })
      .from(leaderboardProfilesTable)
      .leftJoin(
        leaderboardRevenueTable,
        eq(leaderboardProfilesTable.id, leaderboardRevenueTable.profileId)
      )
      .where(eq(leaderboardProfilesTable.isPublic, true))
      .groupBy(
        leaderboardProfilesTable.id,
        leaderboardProfilesTable.tagName,
        leaderboardProfilesTable.avatarUrl,
        leaderboardProfilesTable.niche,
        leaderboardProfilesTable.isConnected
      )
      .orderBy(sql`total_revenue DESC`)
      .limit(100);

    const previousStart = new Date(start);
    const previousEnd = new Date(start);
    if (period === "day") {
      previousStart.setDate(previousStart.getDate() - 1);
    } else if (period === "week") {
      previousStart.setDate(previousStart.getDate() - 7);
    } else {
      previousStart.setMonth(previousStart.getMonth() - 1);
    }

    const previousResults = await db
      .select({
        profileId: leaderboardRevenueTable.profileId,
        totalRevenue: sql<number>`COALESCE(SUM(${leaderboardRevenueTable.amount}), 0)`.as("total_revenue"),
      })
      .from(leaderboardRevenueTable)
      .where(
        and(
          gte(leaderboardRevenueTable.recordedAt, previousStart),
          lte(leaderboardRevenueTable.recordedAt, previousEnd)
        )
      )
      .groupBy(leaderboardRevenueTable.profileId);

    const previousMap = new Map(previousResults.map((r) => [r.profileId, Number(r.totalRevenue)]));

    const leaderboard = results.map((r, index) => {
      const currentRev = Number(r.totalRevenue);
      const prevRev = previousMap.get(r.profileId) || 0;
      const improvement = prevRev > 0 ? ((currentRev - prevRev) / prevRev) * 100 : currentRev > 0 ? 100 : 0;

      let badge = null;
      if (index === 0) badge = "champion";
      else if (index <= 2) badge = "top3";
      else if (index <= 9) badge = "top10";
      if (improvement >= 50 && currentRev > 0) badge = badge || "rising-star";

      return {
        rank: index + 1,
        profileId: r.profileId,
        tagName: r.tagName,
        avatarUrl: r.avatarUrl,
        niche: r.niche,
        isConnected: r.isConnected,
        totalRevenue: currentRev,
        lowTicketCount: Number(r.lowTicketCount),
        highTicketCount: Number(r.highTicketCount),
        lowTicketRevenue: Number(r.lowTicketRevenue),
        highTicketRevenue: Number(r.highTicketRevenue),
        improvement: Math.round(improvement),
        badge,
      };
    });

    const myProfile = await db
      .select()
      .from(leaderboardProfilesTable)
      .where(eq(leaderboardProfilesTable.userId, req.portalUser.id));

    const totalParticipants = results.length;
    const totalRevenueAll = results.reduce((sum, r) => sum + Number(r.totalRevenue), 0);

    res.json({
      leaderboard,
      myProfile: myProfile[0] ? sanitizeProfile(myProfile[0]) : null,
      stats: {
        totalParticipants,
        totalRevenue: totalRevenueAll,
        period,
      },
    });
    return;
  } catch (err) {
    console.error("Leaderboard fetch error:", err);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
    return;
  }
});

function maskKey(key: string) {
  if (!key) return "";
  if (key.length <= 11) return key.substring(0, Math.min(3, key.length)) + "...";
  return key.substring(0, 7) + "..." + key.substring(key.length - 4);
}

function sanitizeProfile(profile: any) {
  if (!profile) return null;
  const { whopApiKey, stripeApiKey, ...safe } = profile;
  safe.paymentProvider = profile.paymentProvider || null;
  safe.syncStatus = profile.syncStatus || "ok";
  safe.lastSyncError = profile.lastSyncError || null;
  safe.lastSyncErrorAt = profile.lastSyncErrorAt || null;
  safe.lastSyncSuccessAt = profile.lastSyncSuccessAt || null;
  if (profile.paymentProvider === "stripe" && stripeApiKey) {
    safe.maskedKey = maskKey(stripeApiKey);
  } else if (whopApiKey) {
    safe.maskedKey = maskKey(whopApiKey);
  } else if (stripeApiKey) {
    safe.maskedKey = maskKey(stripeApiKey);
  }
  return safe;
}

leaderboardRouter.get("/portal/leaderboard/my-profile", requireAuth, async (req: any, res) => {
  try {
    const [profile] = await db
      .select()
      .from(leaderboardProfilesTable)
      .where(eq(leaderboardProfilesTable.userId, req.portalUser.id));
    res.json({ profile: sanitizeProfile(profile) });
    return;
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
    return;
  }
});

leaderboardRouter.post("/portal/leaderboard/profile", requireAuth, async (req: any, res) => {
  try {
    const { tagName, niche, avatarUrl, isPublic } = req.body;
    if (!tagName || typeof tagName !== "string" || tagName.length > 30) {
      res.status(400).json({ error: "Tag name required (max 30 chars)" }); return;
    }

    const [existing] = await db
      .select()
      .from(leaderboardProfilesTable)
      .where(eq(leaderboardProfilesTable.userId, req.portalUser.id));

    if (existing) {
      const [updated] = await db
        .update(leaderboardProfilesTable)
        .set({
          tagName,
          niche: niche || null,
          avatarUrl: avatarUrl || null,
          isPublic: isPublic !== false,
          updatedAt: new Date(),
        })
        .where(eq(leaderboardProfilesTable.id, existing.id))
        .returning();
      res.json({ profile: sanitizeProfile(updated) }); return;
    }

    const [created] = await db
      .insert(leaderboardProfilesTable)
      .values({
        userId: req.portalUser.id,
        tagName,
        niche: niche || null,
        avatarUrl: avatarUrl || null,
        isPublic: isPublic !== false,
      })
      .returning();

    res.json({ profile: sanitizeProfile(created) });
    return;
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ error: "Failed to update profile" });
    return;
  }
});

leaderboardRouter.post("/portal/leaderboard/connect-whop", requireAuth, async (req: any, res) => {
  try {
    const { whopApiKey } = req.body;
    if (!whopApiKey || typeof whopApiKey !== "string") {
      res.status(400).json({ error: "Whop API key required" }); return;
    }

    const [profile] = await db
      .select()
      .from(leaderboardProfilesTable)
      .where(eq(leaderboardProfilesTable.userId, req.portalUser.id));

    if (!profile) {
      res.status(400).json({ error: "Create a leaderboard profile first" }); return;
    }

    try {
      const response = await fetch("https://api.whop.com/api/v2/me", {
        headers: { Authorization: `Bearer ${whopApiKey}` },
      });
      if (!response.ok) {
        res.status(400).json({ error: "Invalid Whop API key. Could not authenticate with Whop." }); return;
      }
    } catch {
      res.status(400).json({ error: "Could not verify Whop API key" }); return;
    }

    const maskedKey = maskKey(whopApiKey);

    const { updated, initialSync } = await applyConnectionSwitch({
      profileId: profile.id,
      update: {
        whopApiKey: whopApiKey,
        stripeApiKey: null,
        paymentProvider: "whop",
        isConnected: true,
      },
    });

    res.json({
      success: true,
      maskedKey,
      profile: sanitizeProfile(updated),
      initialSync,
    });
    return;
  } catch (err) {
    console.error("Whop connect error:", err);
    res.status(500).json({ error: "Failed to connect Whop" });
    return;
  }
});

leaderboardRouter.post("/portal/leaderboard/disconnect-whop", requireAuth, async (req: any, res) => {
  try {
    const [profile] = await db
      .select()
      .from(leaderboardProfilesTable)
      .where(eq(leaderboardProfilesTable.userId, req.portalUser.id));

    if (!profile) {
      res.status(400).json({ error: "No profile found" }); return;
    }

    await db
      .update(leaderboardProfilesTable)
      .set({
        whopApiKey: null,
        stripeApiKey: null,
        paymentProvider: null,
        isConnected: false,
        syncStatus: "ok",
        lastSyncError: null,
        lastSyncErrorAt: null,
        updatedAt: new Date(),
      })
      .where(eq(leaderboardProfilesTable.id, profile.id));

    res.json({ success: true });
    return;
  } catch (err) {
    console.error("Whop disconnect error:", err);
    res.status(500).json({ error: "Failed to disconnect Whop" });
    return;
  }
});

leaderboardRouter.post("/portal/leaderboard/connect-stripe", requireAuth, async (req: any, res) => {
  try {
    const { stripeApiKey } = req.body;
    if (!stripeApiKey || typeof stripeApiKey !== "string") {
      res.status(400).json({ error: "Stripe restricted API key required" }); return;
    }
    const trimmed = stripeApiKey.trim();
    if (!/^rk_(live|test)_[A-Za-z0-9]+$/.test(trimmed)) {
      res.status(400).json({
        error: "That doesn't look like a Stripe restricted key. It must start with rk_live_ or rk_test_.",
      }); return;
    }

    const [profile] = await db
      .select()
      .from(leaderboardProfilesTable)
      .where(eq(leaderboardProfilesTable.userId, req.portalUser.id));

    if (!profile) {
      res.status(400).json({ error: "Create a leaderboard profile first" }); return;
    }

    try {
      const response = await fetch("https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (!response.ok) {
        const body: any = await response.json().catch(() => ({}));
        const msg = body?.error?.message || "Could not authenticate with Stripe.";
        res.status(400).json({ error: `Invalid Stripe key. ${msg}` }); return;
      }
    } catch {
      res.status(400).json({ error: "Could not verify Stripe API key" }); return;
    }

    const maskedKey = maskKey(trimmed);

    const { updated, initialSync } = await applyConnectionSwitch({
      profileId: profile.id,
      update: {
        stripeApiKey: trimmed,
        whopApiKey: null,
        paymentProvider: "stripe",
        isConnected: true,
      },
    });

    res.json({
      success: true,
      maskedKey,
      profile: sanitizeProfile(updated),
      initialSync,
    });
    return;
  } catch (err) {
    console.error("Stripe connect error:", err);
    res.status(500).json({ error: "Failed to connect Stripe" });
    return;
  }
});

leaderboardRouter.post("/portal/leaderboard/disconnect-stripe", requireAuth, async (req: any, res) => {
  try {
    const [profile] = await db
      .select()
      .from(leaderboardProfilesTable)
      .where(eq(leaderboardProfilesTable.userId, req.portalUser.id));

    if (!profile) {
      res.status(400).json({ error: "No profile found" }); return;
    }

    await db
      .update(leaderboardProfilesTable)
      .set({
        stripeApiKey: null,
        whopApiKey: null,
        paymentProvider: null,
        isConnected: false,
        syncStatus: "ok",
        lastSyncError: null,
        lastSyncErrorAt: null,
        updatedAt: new Date(),
      })
      .where(eq(leaderboardProfilesTable.id, profile.id));

    res.json({ success: true });
    return;
  } catch (err) {
    console.error("Stripe disconnect error:", err);
    res.status(500).json({ error: "Failed to disconnect Stripe" });
    return;
  }
});

type NormalizedCharge = {
  amount: number;
  description: string;
  recordedAt: Date;
};

type SyncFetchError = { error: string; authFailed?: boolean };

async function fetchWhopReceipts(apiKey: string, sinceTs: number, maxRecords = Infinity): Promise<NormalizedCharge[] | SyncFetchError> {
  const out: NormalizedCharge[] = [];
  let hasMore = true;
  let startingAfter: string | null = null;
  let pagesFetched = 0;
  while (hasMore && pagesFetched < 50) {
    const url = new URL("https://api.whop.com/api/v2/payments");
    url.searchParams.set("after", String(sinceTs));
    url.searchParams.set("per", "100");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        return {
          error: `Whop rejected the API key (HTTP ${resp.status}). The key may have been revoked or had its permissions reduced.`,
          authFailed: true,
        };
      }
      return { error: `Failed to fetch receipts from Whop (HTTP ${resp.status}).` };
    }
    const data = await resp.json() as any;
    const pageItems: any[] = data.data || data.payments || [];
    for (const c of pageItems) {
      const succeeded = c.status === "succeeded" || c.status === "paid" || c.status === "completed";
      const amount = Number(c.amount || 0);
      if (succeeded && amount > 0) {
        out.push({
          amount,
          description: c.description || "Whop receipt",
          recordedAt: new Date(((c.created_at || c.created || Math.floor(Date.now() / 1000))) * 1000),
        });
      }
    }
    hasMore = !!data.has_more && pageItems.length > 0;
    if (hasMore) startingAfter = pageItems[pageItems.length - 1].id;
    pagesFetched++;
    if (out.length >= maxRecords) break;
  }
  return out;
}

async function fetchStripeCharges(apiKey: string, sinceTs: number, maxRecords = Infinity): Promise<NormalizedCharge[] | SyncFetchError> {
  const out: NormalizedCharge[] = [];
  let hasMore = true;
  let startingAfter: string | null = null;
  let pagesFetched = 0;
  while (hasMore && pagesFetched < 50) {
    const url = new URL("https://api.stripe.com/v1/charges");
    url.searchParams.set("created[gte]", String(sinceTs));
    url.searchParams.set("limit", "100");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) {
      const body: any = await resp.json().catch(() => ({}));
      const msg = body?.error?.message || "Could not authenticate with Stripe.";
      if (resp.status === 401 || resp.status === 403) {
        return {
          error: `Stripe rejected the restricted key (HTTP ${resp.status}): ${msg}`,
          authFailed: true,
        };
      }
      return { error: `Failed to fetch charges from Stripe (HTTP ${resp.status}): ${msg}` };
    }
    const data = await resp.json() as any;
    const pageItems: any[] = data.data || [];
    for (const c of pageItems) {
      const amount = Number(c.amount || 0);
      if (c.status === "succeeded" && amount > 0) {
        out.push({
          amount,
          description: c.description || c.statement_descriptor || "Stripe charge",
          recordedAt: new Date(Number(c.created || Math.floor(Date.now() / 1000)) * 1000),
        });
      }
    }
    hasMore = !!data.has_more && pageItems.length > 0;
    if (hasMore) startingAfter = pageItems[pageItems.length - 1].id;
    pagesFetched++;
    if (out.length >= maxRecords) break;
  }
  return out;
}

async function clearProfileRevenueWindow(profileId: number, since: Date) {
  await db
    .delete(leaderboardRevenueTable)
    .where(
      and(
        eq(leaderboardRevenueTable.profileId, profileId),
        gte(leaderboardRevenueTable.recordedAt, since)
      )
    );
}

async function applyConnectionSwitch(opts: {
  profileId: number;
  update: Record<string, any>;
}) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  // Reconnecting always clears any previous auth-failed banner: the user just
  // re-validated the key by passing /connect-stripe or /connect-whop.
  const [updated] = await db
    .update(leaderboardProfilesTable)
    .set({
      ...opts.update,
      syncStatus: "ok",
      lastSyncError: null,
      lastSyncErrorAt: null,
      updatedAt: new Date(),
    })
    .where(eq(leaderboardProfilesTable.id, opts.profileId))
    .returning();
  await clearProfileRevenueWindow(opts.profileId, thirtyDaysAgo);
  let initialSync: { count?: number; error?: string; authFailed?: boolean } = {};
  try {
    const result = await syncProfileRevenue(updated, thirtyDaysAgo);
    if ("error" in result) {
      initialSync = { error: result.error, authFailed: result.authFailed };
      if (result.authFailed) {
        await markSyncAuthFailure(updated, result.error);
      }
    } else {
      initialSync = { count: result.count };
      await db
        .update(leaderboardProfilesTable)
        .set({ lastSyncSuccessAt: new Date(), updatedAt: new Date() })
        .where(eq(leaderboardProfilesTable.id, updated.id));
    }
  } catch (err: any) {
    initialSync = { error: err?.message || "Initial sync failed; will retry on next cron run." };
  }
  return { updated, initialSync };
}

async function syncProfileRevenue(profile: any, since: Date): Promise<{ count: number } | SyncFetchError> {
  const sinceTs = Math.floor(since.getTime() / 1000);
  const provider = profile.paymentProvider || (profile.whopApiKey ? "whop" : profile.stripeApiKey ? "stripe" : null);
  let charges: NormalizedCharge[] | SyncFetchError;
  if (provider === "stripe" && profile.stripeApiKey) {
    charges = await fetchStripeCharges(profile.stripeApiKey, sinceTs, 1000);
  } else if (provider === "whop" && profile.whopApiKey) {
    charges = await fetchWhopReceipts(profile.whopApiKey, sinceTs, 1000);
  } else {
    return { error: "No connected payment provider for profile" };
  }
  if ("error" in (charges as any)) return charges as SyncFetchError;
  const list = charges as NormalizedCharge[];

  await clearProfileRevenueWindow(profile.id, since);

  const newRecords = list.map((c) => ({
    profileId: profile.id,
    amount: c.amount,
    saleType: c.amount >= 50000 ? "high-ticket" : "low-ticket",
    description: c.description,
    recordedAt: c.recordedAt,
  }));

  if (newRecords.length > 0) {
    for (let batch = 0; batch < newRecords.length; batch += 500) {
      const chunk = newRecords.slice(batch, batch + 500);
      await db.insert(leaderboardRevenueTable).values(chunk);
    }
  }
  return { count: newRecords.length };
}

async function markSyncSuccess(profileId: number) {
  await db
    .update(leaderboardProfilesTable)
    .set({
      syncStatus: "ok",
      lastSyncError: null,
      lastSyncErrorAt: null,
      lastSyncSuccessAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(leaderboardProfilesTable.id, profileId));
}

async function markSyncAuthFailure(profile: any, errorMessage: string) {
  const wasAlreadyFailed = profile.syncStatus === "auth_failed";
  await db
    .update(leaderboardProfilesTable)
    .set({
      syncStatus: "auth_failed",
      lastSyncError: errorMessage,
      lastSyncErrorAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(leaderboardProfilesTable.id, profile.id));

  // Notify the user the first time the key breaks (don't spam them on each retry).
  if (!wasAlreadyFailed && profile.userId) {
    try {
      const [user] = await db
        .select()
        .from(portalUsersTable)
        .where(eq(portalUsersTable.id, profile.userId));
      if (user?.email) {
        const providerLabel =
          profile.paymentProvider === "stripe"
            ? "Stripe"
            : profile.paymentProvider === "whop"
            ? "Whop"
            : "payment provider";
        await sendEmail({
          userId: user.id,
          email: user.email,
          subject: `Your ${providerLabel} key for the leaderboard isn't working`,
          body:
            `Hi${user.firstName ? " " + user.firstName : ""},\n\n` +
            `Heads up — the ${providerLabel} API key you connected to the leaderboard just stopped working. ` +
            `${providerLabel} returned an authentication error, which usually means the key was revoked, rotated, or had its permissions reduced.\n\n` +
            `Until you reconnect, your leaderboard rank will freeze where it is now and no new sales will be added.\n\n` +
            `What to do:\n` +
            `1. Open the leaderboard page in the portal.\n` +
            `2. Click "Reconnect" in the warning banner at the top.\n` +
            `3. Paste a fresh ${providerLabel} key (read-only, same permissions as before).\n\n` +
            `Error from ${providerLabel}: ${errorMessage}\n`,
          templateType: "leaderboard_auth_failed",
          metadata: {
            profileId: profile.id,
            paymentProvider: profile.paymentProvider,
          },
        });
      }
    } catch (mailErr) {
      console.error("Failed to send leaderboard auth-failed email:", mailErr);
    }
  }
}

leaderboardRouter.post("/portal/leaderboard/sync", async (req: any, res) => {
  const authHeader = req.headers["x-internal-secret"];
  const secret = process.env.SESSION_SECRET;
  if (!secret || authHeader !== secret) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  try {
    const connectedProfiles = await db
      .select()
      .from(leaderboardProfilesTable)
      .where(
        and(
          eq(leaderboardProfilesTable.isConnected, true),
          eq(leaderboardProfilesTable.isDummy, false)
        )
      );

    let synced = 0;
    let errors = 0;
    let authFailed = 0;

    for (const profile of connectedProfiles) {
      const provider = profile.paymentProvider || (profile.whopApiKey ? "whop" : profile.stripeApiKey ? "stripe" : null);
      if (!provider) continue;
      if (provider === "whop" && !profile.whopApiKey) continue;
      if (provider === "stripe" && !profile.stripeApiKey) continue;
      try {
        const since = new Date();
        since.setHours(0, 0, 0, 0);
        const result = await syncProfileRevenue(profile, since);
        if ("error" in result) {
          if (result.authFailed) {
            authFailed++;
            await markSyncAuthFailure(profile, result.error);
          } else {
            errors++;
          }
        } else {
          synced++;
          if (profile.syncStatus === "auth_failed") {
            // Key was healed (e.g. user re-pasted a working key). Reset status.
            await markSyncSuccess(profile.id);
          } else {
            await db
              .update(leaderboardProfilesTable)
              .set({ lastSyncSuccessAt: new Date(), updatedAt: new Date() })
              .where(eq(leaderboardProfilesTable.id, profile.id));
          }
        }
      } catch {
        errors++;
      }
    }

    res.json({ success: true, synced, errors, authFailed, total: connectedProfiles.length });
    return;
  } catch (err) {
    console.error("Sync error:", err);
    res.status(500).json({ error: "Failed to sync" });
    return;
  }
});

leaderboardRouter.post("/portal/leaderboard/sync-my-revenue", requireAuth, async (req: any, res) => {
  try {
    const [profile] = await db
      .select()
      .from(leaderboardProfilesTable)
      .where(eq(leaderboardProfilesTable.userId, req.portalUser.id));

    const provider = profile?.paymentProvider || (profile?.whopApiKey ? "whop" : profile?.stripeApiKey ? "stripe" : null);
    if (!profile || !profile.isConnected || !provider) {
      res.status(400).json({ error: "No connected payment provider" }); return;
    }
    if (provider === "whop" && !profile.whopApiKey) {
      res.status(400).json({ error: "No connected Whop account" }); return;
    }
    if (provider === "stripe" && !profile.stripeApiKey) {
      res.status(400).json({ error: "No connected Stripe account" }); return;
    }

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const result = await syncProfileRevenue(profile, since);
    if ("error" in result) {
      if (result.authFailed) {
        await markSyncAuthFailure(profile, result.error);
        res.status(400).json({
          error: result.error,
          authFailed: true,
        }); return;
      }
      res.status(400).json({ error: result.error }); return;
    }

    if (profile.syncStatus === "auth_failed") {
      await markSyncSuccess(profile.id);
    } else {
      await db
        .update(leaderboardProfilesTable)
        .set({ lastSyncSuccessAt: new Date(), updatedAt: new Date() })
        .where(eq(leaderboardProfilesTable.id, profile.id));
    }

    res.json({
      success: true,
      chargesSynced: result.count,
      period: "last 30 days",
    });
    return;
  } catch (err) {
    console.error("Manual sync error:", err);
    res.status(500).json({ error: "Failed to sync revenue" });
    return;
  }
});

leaderboardRouter.post("/portal/leaderboard/seed", async (req: any, res) => {
  const authHeader = req.headers["x-internal-secret"];
  const secret = process.env.SESSION_SECRET;
  if (!secret || authHeader !== secret) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  try {
    const dicebearStyles = ["bottts", "shapes", "icons", "rings", "thumbs", "fun-emoji", "identicon", "pixel-art"];
    const avatarFor = (tag: string, idx: number) => {
      const style = dicebearStyles[idx % dicebearStyles.length];
      return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(tag)}&backgroundColor=1a1a2e,16213e,0f3460,1b1b2f,2d132c,3a0ca3,480ca8,560bad,7209b7,b5179e&backgroundType=gradientLinear`;
    };

    const dummyUsers = [
      { tagName: "AssetKing_99", niche: "Real Estate" },
      { tagName: "FunnelQueen", niche: "Health & Wellness" },
      { tagName: "xDarkMatter", niche: "AI Automation" },
      { tagName: "CashFlowCEO", niche: "Finance" },
      { tagName: "ContentMachine", niche: "Social Media" },
      { tagName: "CloserMike", niche: "B2B SaaS" },
      { tagName: "LaunchPadLisa", niche: "Beauty & Skincare" },
      { tagName: "ScaleBot_v2", niche: "AI Automation" },
      { tagName: "ProfitPilot", niche: "Ecommerce" },
      { tagName: "NicheNinja", niche: "Fitness" },
      { tagName: "LeadGen_Pro", niche: "Lead Generation" },
      { tagName: "TheAutoCloser", niche: "Insurance" },
      { tagName: "StackBuilder", niche: "Tech / Dev Tools" },
      { tagName: "AdSpendKing", niche: "Paid Ads" },
      { tagName: "CoachCarla", niche: "Life Coaching" },
      { tagName: "ProductHero", niche: "Physical Products" },
      { tagName: "CryptoTrader_Z", niche: "Crypto / Web3" },
      { tagName: "EmailEmpire", niche: "Email Marketing" },
      { tagName: "AgencyAlpha", niche: "Marketing Agency" },
      { tagName: "FlipMaster", niche: "Flipping / Resale" },
      { tagName: "CourseCreatorX", niche: "Online Education" },
      { tagName: "DropshipDave", niche: "Dropshipping" },
      { tagName: "TheMediaBuyer", niche: "Media Buying" },
      { tagName: "WellnessWins", niche: "Supplements" },
      { tagName: "DesignDynamo", niche: "Graphic Design" },
      { tagName: "SaaS_Sultan", niche: "Software" },
      { tagName: "RealtyRocket", niche: "Real Estate Investing" },
      { tagName: "PodcastPro", niche: "Podcasting" },
      { tagName: "LocalBizHero", niche: "Local Services" },
      { tagName: "ClickFunneler", niche: "Sales Funnels" },
      { tagName: "MindsetMogul", niche: "Mindset / Motivation" },
      { tagName: "DataDriven_io", niche: "Analytics" },
      { tagName: "PrintOnDemand", niche: "Print on Demand" },
      { tagName: "AutomationAce", niche: "Workflow Automation" },
      { tagName: "CopywriterPro", niche: "Copywriting" },
      { tagName: "AffiliateKing", niche: "Affiliate Marketing" },
      { tagName: "TikTokTitan", niche: "TikTok Marketing" },
      { tagName: "ConsultCrush", niche: "Consulting" },
      { tagName: "WebDevWiz", niche: "Web Development" },
      { tagName: "SEO_Samurai", niche: "SEO" },
      { tagName: "FitnessFounder", niche: "Online Fitness" },
      { tagName: "PropertyPro", niche: "Property Management" },
      { tagName: "VideoVault", niche: "Video Production" },
      { tagName: "TherapyBiz", niche: "Therapy / Wellness" },
      { tagName: "PetBizPro", niche: "Pet Products" },
      { tagName: "FoodFunnels", niche: "Food & Beverage" },
      { tagName: "BookLaunchPro", niche: "Publishing" },
      { tagName: "GreenEarner", niche: "Sustainability" },
      { tagName: "MusicMogul", niche: "Music Industry" },
      { tagName: "LegalEagle", niche: "Legal Services" },
      { tagName: "NovaTrader", niche: "Forex Trading" },
      { tagName: "ZenithBuilder", niche: "Construction" },
      { tagName: "PixelHustle", niche: "Digital Art" },
      { tagName: "CloudNine_Biz", niche: "Cloud Services" },
      { tagName: "SocialSurge", niche: "Influencer Marketing" },
      { tagName: "VortexMedia", niche: "Content Creation" },
      { tagName: "IronClad_Sales", niche: "Sales Training" },
      { tagName: "EchoLabs", niche: "Audio Production" },
      { tagName: "NeonSignsCo", niche: "Signage & Print" },
      { tagName: "RapidDeploy", niche: "DevOps / SaaS" },
      { tagName: "BotFactory_AI", niche: "Chatbot Agency" },
      { tagName: "AlphaGrinds", niche: "Supplements" },
      { tagName: "ThriftKingpin", niche: "Thrifting / Resale" },
      { tagName: "QuantumLeads", niche: "B2B Lead Gen" },
    ];

    const tierAssignments: { tierIdx: number }[] = [];
    for (let i = 0; i < 3; i++) tierAssignments.push({ tierIdx: 0 });
    for (let i = 0; i < 5; i++) tierAssignments.push({ tierIdx: 1 });
    for (let i = 0; i < 8; i++) tierAssignments.push({ tierIdx: 2 });
    for (let i = 0; i < 12; i++) tierAssignments.push({ tierIdx: 3 });
    for (let i = 0; i < 12; i++) tierAssignments.push({ tierIdx: 4 });
    for (let i = 0; i < 24; i++) tierAssignments.push({ tierIdx: 5 });

    const revenueProfiles = [
      { dailyMin: 25000, dailyMax: 38000, highTicketChance: 0.35 },
      { dailyMin: 10000, dailyMax: 25000, highTicketChance: 0.3 },
      { dailyMin: 5000, dailyMax: 10000, highTicketChance: 0.2 },
      { dailyMin: 1000, dailyMax: 5000, highTicketChance: 0.1 },
      { dailyMin: 500, dailyMax: 1000, highTicketChance: 0.05 },
      { dailyMin: 50, dailyMax: 500, highTicketChance: 0.02 },
    ];

    const existingDummy = await db
      .select({ id: leaderboardProfilesTable.id })
      .from(leaderboardProfilesTable)
      .where(eq(leaderboardProfilesTable.isDummy, true));
    const dummyIds = existingDummy.map((d) => d.id);
    if (dummyIds.length > 0) {
      for (const id of dummyIds) {
        await db.delete(leaderboardRevenueTable).where(eq(leaderboardRevenueTable.profileId, id));
      }
      await db.delete(leaderboardProfilesTable).where(eq(leaderboardProfilesTable.isDummy, true));
    }

    const profileIds: number[] = [];
    for (let idx = 0; idx < dummyUsers.length; idx++) {
      const u = dummyUsers[idx];
      const [p] = await db
        .insert(leaderboardProfilesTable)
        .values({
          tagName: u.tagName,
          avatarUrl: avatarFor(u.tagName, idx),
          niche: u.niche,
          isConnected: true,
          isPublic: true,
          isDummy: true,
        })
        .returning();
      profileIds.push(p.id);
    }

    const now = new Date();
    const revenueRecords: any[] = [];

    for (let i = 0; i < profileIds.length; i++) {
      const assignment = tierAssignments[Math.min(i, tierAssignments.length - 1)];
      const tier = revenueProfiles[assignment.tierIdx];

      for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
        const date = new Date(now);
        date.setDate(date.getDate() - dayOffset);
        date.setHours(Math.floor(Math.random() * 14) + 8, Math.floor(Math.random() * 60), 0, 0);

        const dailyTarget = tier.dailyMin + Math.random() * (tier.dailyMax - tier.dailyMin);
        const variance = 0.7 + Math.random() * 0.6;
        const dailyBudget = Math.min(Math.max(dailyTarget * variance, tier.dailyMin * 0.5), tier.dailyMax * 1.1);

        if (dailyBudget < 30) continue;

        let remaining = dailyBudget;
        while (remaining > 30) {
          const isHighTicket = Math.random() < tier.highTicketChance;
          let amount: number;
          let saleType: string;
          let description: string;

          if (isHighTicket) {
            amount = Math.floor(997 + Math.random() * 4003);
            saleType = "high-ticket";
            description = `High-ticket deal - $${(amount / 100).toFixed(0)}`;
            amount *= 100;
          } else {
            const lowTicketOptions = [97, 97, 97, 197, 297, 497];
            const baseAmount = lowTicketOptions[Math.floor(Math.random() * lowTicketOptions.length)];
            amount = baseAmount * 100;
            saleType = "low-ticket";
            description = `Low-ticket sale - $${baseAmount}`;
          }

          const saleDate = new Date(date);
          saleDate.setMinutes(saleDate.getMinutes() + Math.floor(Math.random() * 60));

          revenueRecords.push({
            profileId: profileIds[i],
            amount,
            saleType,
            description,
            recordedAt: saleDate,
          });

          remaining -= amount / 100;
        }
      }
    }

    for (let batch = 0; batch < revenueRecords.length; batch += 500) {
      const chunk = revenueRecords.slice(batch, batch + 500);
      await db.insert(leaderboardRevenueTable).values(chunk);
    }

    res.json({
      success: true,
      profiles: profileIds.length,
      revenueRecords: revenueRecords.length,
    });
    return;
  } catch (err) {
    console.error("Seed error:", err);
    res.status(500).json({ error: "Failed to seed leaderboard" });
    return;
  }
});

export default leaderboardRouter;
