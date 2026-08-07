import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { and, eq, sql } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { provenanceFor } from "../lib/payment-provenance";
import { enrollPurchaserAndSendEmail } from "../lib/purchase-enrollment";
import { enrollEmailInAcceleratorCourses } from "../lib/thinkific";

const router: IRouter = Router();

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1).max(80).optional(),
});

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const ipHits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  hits.push(now);
  ipHits.set(ip, hits);
  return hits.length > RATE_LIMIT_MAX;
}

router.post("/portal/accelerator/enroll", async (req: Request, res: Response) => {
  if (process.env.ACCELERATOR_ENABLED !== "1") {
    return res.status(503).json({ ok: false, error: "accelerator_disabled" });
  }

  const ip = (req.ip || req.headers["x-forwarded-for"]?.toString() || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) {
    return res.status(429).json({ ok: false, error: "rate_limited" });
  }

  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "invalid_body", issues: parsed.error.issues });
  }

  const { email, firstName } = parsed.data;
  const orderId = `accel:${email}`;

  try {
    const stamp = provenanceFor({
      source: "admin_grant",
      reason: "ghl_accelerator_event_2026",
      hasReceiptId: false,
    });

    const [existing] = await db
      .select({ id: ordersTable.id, mainProductPaid: ordersTable.mainProductPaid })
      .from(ordersTable)
      .where(
        and(
          sql`lower(${ordersTable.email}) = lower(${email})`,
          eq(ordersTable.mainProductPaid, true),
        ),
      )
      .limit(1);

    let targetOrderId: string;
    let isNewGrant = false;

    if (existing) {
      targetOrderId = existing.id;
    } else {
      isNewGrant = true;
      await db
        .insert(ordersTable)
        .values({
          id: orderId,
          email,
          mainProductPaid: true,
          totalAmount: 0,
          currentStep: "thank-you",
          productSlugs: "main",
          paymentSourceType: stamp.paymentSourceType,
          grantReason: stamp.grantReason,
          paymentVerified: stamp.paymentVerified,
          receiptVerified: stamp.receiptVerified,
        } as typeof ordersTable.$inferInsert)
        .onConflictDoNothing({ target: ordersTable.id });
      targetOrderId = orderId;
    }

    const enroll = await enrollPurchaserAndSendEmail({
      email,
      orderId: targetOrderId,
      portalKey: "room30",
      extraMetadata: { source: "accelerator_event" },
    });

    // Fire-and-forget direct Thinkific enrollment - creates (or reuses)
    // the Thinkific user and enrolls them in every accelerator course.
    // Only run on a first-time grant where the Clerk welcome email
    // actually went out, so resubmits / replays do not re-trigger the
    // pipeline. Thinkific itself is idempotent on enrollment rows, but
    // gating here keeps logs clean. Helper swallows all errors.
    if (isNewGrant && enroll.status === "sent") {
      void enrollEmailInAcceleratorCourses(email, firstName).catch(() => {});
    }

    req.log.info(
      { event: "accelerator_enroll_ok", email, orderId: targetOrderId, enroll },
      "[accelerator] enroll processed",
    );

    return res.status(200).json({
      ok: true,
      enroll,
      signInUrl: "https://room30.ai/members/sign-in",
    });
  } catch (err) {
    req.log.error(
      { event: "accelerator_enroll_error", err: err instanceof Error ? err.message : String(err), email },
      "[accelerator] enroll failed",
    );
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
