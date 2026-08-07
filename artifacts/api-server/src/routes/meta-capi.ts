import { Router, type IRouter } from "express";
import { getAuth, clerkClient } from "../lib/auth-compat";
import { db, metaCapiEventsTable, portalUsersTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { sendMetaPurchaseEvent, getClientIp, getClientUserAgent, readFbpFbcFromCookies, isMetaCapiConfigured } from "../services/metaCapi";
import { getBrandBaseUrl } from "../lib/brand-url";

const router: IRouter = Router();

const ADMIN_EMAIL_SET = new Set(
  (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "greg@cookemedia.io")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
);

async function requireAdmin(req: any, res: any, next: any) {
  try {
    const auth = getAuth(req);
    const userId = auth?.sessionClaims?.userId || auth?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const [user] = await db.select().from(portalUsersTable).where(eq(portalUsersTable.clerkId, userId as string));
    if (user && user.role === "admin") {
      req.portalUser = user;
      return next();
    }

    let clerkEmail: string | null = null;
    try {
      const client = clerkClient;
      const u = await client.users.getUser(userId as string);
      clerkEmail = u.emailAddresses?.[0]?.emailAddress?.toLowerCase() || null;
    } catch {}
    const effectiveEmail = (clerkEmail || user?.email || "").toLowerCase();
    if (effectiveEmail && ADMIN_EMAIL_SET.has(effectiveEmail)) {
      return next();
    }
    res.status(403).json({ error: "Forbidden" }); return;
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Auth failure" }); return;
  }
}

router.get("/meta-capi/status", (_req, res) => {
  res.json({
    configured: isMetaCapiConfigured(),
    pixelId: process.env.META_PIXEL_ID || null,
    hasAccessToken: Boolean(process.env.META_CAPI_ACCESS_TOKEN),
    testEventCode: process.env.META_CAPI_TEST_EVENT_CODE || null,
  });
});

router.post("/meta-capi/test", requireAdmin, async (req, res) => {
  const { type = "standard", email, value, testEventCode } = req.body || {};
  const orderType = type === "high_ticket" ? "high_ticket" : "standard";
  const eventId = `test_${orderType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const fbpFbc = readFbpFbcFromCookies(req);
  const result = await sendMetaPurchaseEvent({
    eventId,
    eventSourceUrl: `${getBrandBaseUrl()}/test`,
    email: email || (req as any).portalUser?.email || "test@apexoffers.io",
    fbp: fbpFbc.fbp,
    fbc: fbpFbc.fbc,
    clientIpAddress: getClientIp(req),
    clientUserAgent: getClientUserAgent(req),
    value: typeof value === "number" ? value : (orderType === "high_ticket" ? 5000 : 27),
    currency: "USD",
    orderType,
    contentName: orderType === "high_ticket" ? "TEST 1-1 Coaching" : "TEST Low-Ticket Offer",
    contentIds: [orderType === "high_ticket" ? "coaching_1_1" : "main-product"],
    testEventCode,
  });
  res.json({ eventId, type: orderType, ...result });
});

router.get("/meta-capi/events", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(metaCapiEventsTable)
    .orderBy(desc(metaCapiEventsTable.sentAt))
    .limit(50);
  res.json({ events: rows });
});

export default router;
