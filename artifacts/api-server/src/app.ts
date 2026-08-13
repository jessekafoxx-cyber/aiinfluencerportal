import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware, getAuth } from "@clerk/express";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { checkRateLimit } from "./lib/rate-limit";
import { handleCalendlyWebhook } from "./routes/crm-calendly";

const app: Express = express();

// We sit behind the Replit shared proxy on localhost:80, which forwards
// to this artifact's local port and injects x-forwarded-for. Trusting
// only the loopback hop means req.ip resolves to the real client IP for
// requests that came through the proxy, while requests sent directly to
// the artifact's port (i.e. not via the proxy) cannot spoof their IP via
// a forged x-forwarded-for header. This is what the per-IP rate limiter
// on /api/room30/contact relies on.
app.set("trust proxy", "loopback");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Clerk Frontend API proxy — must be before body parsers (streams raw bytes).
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));

// Task #608 - Calendly webhook. Mounted with raw-body middleware
// BEFORE express.json so the HMAC signature can be verified against
// the byte-exact request body.
app.post(
  "/api/crm/webhooks/calendly",
  express.raw({ type: "*/*", limit: "5mb" }),
  handleCalendlyWebhook,
);

app.use(
  express.json({
    limit: "30mb",
    verify: (req, _res, buf) => {
      // Capture raw bytes for routes that need to verify HMAC signatures
      // (e.g. /api/onboarding/higgsfield-webhook).
      (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: "30mb" }));

// Clerk session middleware — validates JWT from Clerk and populates req.auth.
// Reads CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY from environment automatically.
app.use(clerkMiddleware());

// Security hardening (room30 anti-piracy spec 3.1 / 4.2 / 7.1): an
// abuse-ceiling + security log for portal API traffic. The ceilings are
// intentionally generous - far above any legitimate SPA page-load burst -
// so this trips ONLY on egregious scraping / credential-stuffing and stays
// invisible to real customers (golden rule). Scoped to /api/portal/* by
// path prefix so the live funnel / Stripe / coaching routes are NEVER
// rate-limited. Keyed by auth user id when present, else client IP.
// Mounted after clerkMiddleware and before the router.
app.use("/api", (req, res, next) => {
  if (req.path !== "/portal" && !req.path.startsWith("/portal/")) return next();

  const userId: string | null = getAuth(req).userId ?? null;
  const principal = userId ? `user:${userId}` : `ip:${req.ip ?? "unknown"}`;
  const key = userId ? `u:${userId}` : `ip:${req.ip ?? "unknown"}`;

  // Security log: content access attempts that are rejected for missing
  // entitlement (403). Recorded centrally here so we don't have to touch
  // every route handler. Filterable via the `securityEvent` field.
  res.on("finish", () => {
    if (res.statusCode === 403) {
      logger.warn(
        { securityEvent: "entitlement_denied", principal, path: req.path },
        "[security] portal access denied (no entitlement)",
      );
    }
  });

  const result = checkRateLimit("portal-abuse-ceiling", key, [
    { windowMs: 10_000, max: 150 },
    { windowMs: 60_000, max: 600 },
  ]);
  if (!result.ok) {
    logger.warn(
      {
        securityEvent: "rate_limit_triggered",
        scope: "portal-abuse-ceiling",
        principal,
        path: req.path,
        retryAfterSec: result.retryAfterSec,
      },
      "[security] portal abuse ceiling tripped",
    );
    res.setHeader("Retry-After", String(result.retryAfterSec));
    return res
      .status(429)
      .json({ error: "Too many requests. Please slow down and try again shortly." });
  }

  next();
});

// Deployment health probes hit the bare route prefix ("/api") and expect
// an HTTP 200. Answer with a tiny ok payload instead of falling through
// to the JSON 404 handler, so the promote step can never fail on it.
app.get("/api", (_req, res) => {
  res.json({ status: "ok", service: "api" });
});

// The site root: nothing owns "/" since the landing-page artifact was
// removed, which 404s the deployer's default "/" health probe and fails
// every publish at the promote step. Serve a 200 that immediately sends
// human visitors to the members portal.
app.get("/", (_req, res) => {
  res
    .status(200)
    .type("html")
    .send(
      '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=/members/"><title>AI Influencer Portfolio</title></head>' +
        '<body><script>location.replace("/members/")</script><a href="/members/">Continue to the portal</a></body></html>',
    );
});

app.use("/api", router);

// Catch-all JSON error handler for /api/* so the frontend never receives
// an HTML error page (which would crash JSON parsing on the client with
// "Unexpected token '<', '<!DOCTYPE'..."). Any uncaught error or 404 in
// the API tree is converted to a JSON envelope here.
app.use("/api", (req, res) => {
  if (res.headersSent) return;
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

app.use(
  "/api",
  (
    err: any,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    req.log?.error({ err }, "Unhandled API error");
    if (res.headersSent) return;
    const status =
      typeof err?.status === "number"
        ? err.status
        : err?.code === "LIMIT_FILE_SIZE"
          ? 413
          : 500;
    const message =
      err?.code === "LIMIT_FILE_SIZE"
        ? "One of the uploaded files is too large."
        : err?.message || "Internal server error";
    res.status(status).json({ error: message });
  },
);

export default app;
