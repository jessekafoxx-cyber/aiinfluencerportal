import { Router } from "express";
import { db, termsAcceptancesTable } from "@workspace/db";
import { z } from "zod";

const router: Router = Router();

const bodySchema = z.object({
  email: z.string().email().max(320),
  checkboxText: z.string().min(1).max(2000),
  termsVersion: z.string().max(32).optional(),
  refundPolicyVersion: z.string().max(32).optional(),
  context: z
    .enum([
      "checkout",
      "upsell1",
      "downsell1",
      "upsell2",
      "upsell3",
      "downsell3",
      "portal_addon",
    ])
    .optional(),
  orderId: z.string().max(128).optional(),
  pageUrl: z.string().max(2000).optional(),
  fingerprintHash: z.string().max(256).optional(),
  sessionId: z.string().max(256).optional(),
});

function clientIp(req: any): string | null {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) {
    return xf.split(",")[0]!.trim() || null;
  }
  return req.ip || req.socket?.remoteAddress || null;
}

// Public endpoint: any unauthenticated visitor can record consent at the
// moment they tick the checkbox or click an upsell CTA. This is purely a
// legal-defence audit trail; abuse risk is low (worst case someone
// floods the table) and we cap row size at the schema level.
router.post("/terms-acceptance", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_body", details: parsed.error.flatten() });
  }
  const body = parsed.data;
  try {
    const ipAddress = clientIp(req);
    const userAgent =
      (typeof req.headers["user-agent"] === "string"
        ? req.headers["user-agent"]
        : null) || null;
    const [row] = await db
      .insert(termsAcceptancesTable)
      .values({
        email: body.email.toLowerCase(),
        orderId: body.orderId ?? null,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        checkboxText: body.checkboxText,
        pageUrl: body.pageUrl ?? null,
        termsVersion: body.termsVersion ?? "1.0",
        refundPolicyVersion: body.refundPolicyVersion ?? "1.0",
        fingerprintHash: body.fingerprintHash ?? null,
        sessionId: body.sessionId ?? null,
        context: body.context ?? null,
      })
      .returning({ id: termsAcceptancesTable.id });
    return res.json({ ok: true, id: row?.id ?? null });
  } catch (err: any) {
    req.log?.error?.(
      { err: err?.message, email: body.email, context: body.context },
      "[terms-acceptance] insert failed",
    );
    return res
      .status(500)
      .json({ error: "insert_failed", message: err?.message || "" });
  }
});

export default router;
