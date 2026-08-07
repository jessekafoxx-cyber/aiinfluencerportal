/**
 * Stub admin automation router.
 *
 * Returns empty arrays so the admin pages mount and render.
 * Real implementations require admin Zod schemas + audit helpers
 * not yet ported (see follow-up task).
 */
import { Router, type IRouter } from "express";
import { requireSuperAdmin } from "../../middlewares/requireAuth";

const router: IRouter = Router();

// All admin endpoints require super-admin (admin email allow-list).
router.use(requireSuperAdmin);

router.get("/jobs", (_req, res) => res.json({ jobs: [] }));
router.get("/jobs/stuck", (_req, res) => res.json({ jobs: [] }));
router.get("/jobs/:id", (_req, res) =>
  res.status(404).json({ error: "not_found" }),
);
router.post("/jobs/:id/retry", (_req, res) =>
  res.status(501).json({ error: "not_implemented" }),
);
router.post("/jobs/:id/cancel", (_req, res) =>
  res.status(501).json({ error: "not_implemented" }),
);

router.get("/audit-log", (_req, res) => res.json({ entries: [] }));
router.get("/provider-configs", (_req, res) => res.json({ configs: [] }));
router.put("/provider-configs/:slug/:key", (_req, res) =>
  res.status(501).json({ error: "not_implemented" }),
);
router.get("/provider-costs", (_req, res) => res.json({ costs: [] }));
router.get("/provider-errors", (_req, res) => res.json({ errors: [] }));
router.get("/transactions", (_req, res) => res.json({ transactions: [] }));
router.get("/wallets", (_req, res) => res.json({ wallets: [] }));
router.post("/wallets/:userId/adjust", (_req, res) =>
  res.status(501).json({ error: "not_implemented" }),
);
router.post("/wallets/:userId/refund", (_req, res) =>
  res.status(501).json({ error: "not_implemented" }),
);
router.get("/workflow-stats", (_req, res) => res.json({ stats: [] }));

export default router;
