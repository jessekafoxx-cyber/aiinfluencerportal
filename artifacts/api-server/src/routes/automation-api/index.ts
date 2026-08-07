/**
 * Stub automation API router.
 *
 * Returns minimal/empty responses so the portal pages mount and render.
 * Real implementations require Zod admin schemas + helpers not yet
 * ported (see follow-up task).
 */
import { Router, type IRouter } from "express";
import { requireAuth } from "../../middlewares/requireAuth";

const router: IRouter = Router();

router.use(requireAuth);

router.get("/jobs", (_req, res) => res.json({ jobs: [] }));
router.get("/jobs/:id", (_req, res) =>
  res.status(404).json({ error: "not_found" }),
);
router.post("/jobs", (_req, res) =>
  res.status(501).json({ error: "not_implemented" }),
);

router.get("/credits/balance", (_req, res) =>
  res.json({ balance: 0, reservedBalance: 0 }),
);
router.get("/credits/transactions", (_req, res) =>
  res.json({ transactions: [] }),
);
router.post("/credits/purchase", (_req, res) =>
  res.status(501).json({ error: "not_implemented" }),
);

router.get("/schedules", (_req, res) => res.json({ schedules: [] }));
router.post("/schedules", (_req, res) =>
  res.status(501).json({ error: "not_implemented" }),
);
router.delete("/schedules/:id", (_req, res) =>
  res.status(501).json({ error: "not_implemented" }),
);

router.get("/workflows", (_req, res) => res.json({ workflows: [] }));

router.post("/webhooks/:provider", (_req, res) => res.json({ ok: true }));

router.get("/ai-influencer/runs", (_req, res) => res.json({ runs: [] }));
router.post("/ai-influencer/run", (_req, res) =>
  res.status(501).json({ error: "not_implemented" }),
);

export default router;
