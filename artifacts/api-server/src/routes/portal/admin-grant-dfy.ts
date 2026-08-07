/**
 * Super-admin manual "Grant DFY from charge" route.
 *
 * This endpoint used to look up a Stripe PaymentIntent / charge and flip
 * `doneForYouPackPaid` from the verified charge. With the Stripe payment
 * stack removed, charge verification is no longer possible, so the route
 * now returns 410 Gone. DFY grants are handled via GoHighLevel entitlement
 * flows. The route stays mounted so the admin UI receives a clean JSON
 * response instead of a 404.
 */

import type { RequestHandler, Router } from "express";

export interface AdminGrantDfyDeps {
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
}

export function registerAdminGrantDfyRoutes(
  portalRouter: Router,
  { requireAuth, requireAdmin }: AdminGrantDfyDeps,
): void {
  portalRouter.post(
    "/portal/admin/grant-dfy-from-charge",
    requireAuth,
    requireAdmin,
    async (req: any, res) => {
      if (req.appUser?.isSuperAdmin !== true) {
        res.status(403).json({ error: "Super-admin only" });
        return;
      }
      res.status(410).json({
        error:
          "Grant-DFY-from-charge is retired. Charge verification is no longer available; grant DFY access via GoHighLevel entitlement flows.",
      });
      return;
    },
  );
}
