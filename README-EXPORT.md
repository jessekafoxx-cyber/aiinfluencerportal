# Room30 Portal Export - Masterclass + API Infrastructure

Standalone export of the Room30 members portal and its backend, packaged as a pnpm monorepo ready to upload into a fresh Replit project. The AI generator tools frontend (Operating System grid, Script Writer, Greg AI, AI Brain, prompt/bio/domain generators, etc.) has been removed; the masterclass/course experience, auth, admin, and the Viktor (AI influencer partner) API + webhook infrastructure are all intact.

## What is included

- `artifacts/room30-portal/` - the members portal frontend (React + Vite, served at `/members/`). Course player, dashboard, onboarding, roadmap, VSL masterclass, admin console, DFY resources, influencer delivery pages.
- `artifacts/api-server/` - the full Express 5 API backend:
  - `/api/portal/*` - auth (Replit Auth / OIDC), course phases/lessons/progress, entitlements, admin.
  - `/api/admin/external/v1/*` - the x-api-key gated external API that Viktor uses (queue, claim, complete, asset upload) plus webhook endpoints, Slack notifications and Monday.com mirroring.
  - Media Worker entrypoint (`dist/index.worker.mjs`) for background queues/schedulers.
- `lib/` - shared workspace libraries (DB schema + migrations, OpenAPI spec + generated client, masterclass content, integrations).
- `scripts/` - operational helpers (e.g. `cleanup:influencer-job`).

The masterclass course content is code-seeded: on API server boot, `artifacts/api-server/src/lib/ensure-main-masterclass.ts` inserts the 10 "AI Influencer Masterclass" lessons (titles, Wistia video IDs, formatted lesson notes) from `masterclass-course-data.ts` into the database automatically. No manual course setup needed — just push the schema and start the API server.

## Setup in a fresh Replit project

1. Upload/extract this folder as the project root.
2. Install: `pnpm install`
3. Create a PostgreSQL database (Replit built-in). `DATABASE_URL` is picked up automatically.
4. Push the schema: `pnpm --filter @workspace/db run push-force`
5. Set secrets (see below).
6. Configure two workflows:
   - API Server: `pnpm --filter @workspace/api-server run dev` (port 8080, paths `/api`)
   - Portal: `pnpm --filter @workspace/room30-portal run dev` (paths `/members/`)
   - Optional Media Worker: `pnpm --filter @workspace/api-server run dev:worker:wait`
   The included `.replit-artifact/artifact.toml` files describe the original routing.
7. Verify: `pnpm run typecheck`, then open `/members/` in the preview.

## Required secrets

- `DATABASE_URL` - PostgreSQL (auto on Replit)
- `SESSION_SECRET` - signs Replit Auth session cookies (any long random string). Auth uses Replit Auth (OIDC) - no third-party auth account or keys to set up.
- `OPENAI_API_KEY` - lesson notes and other AI-assisted backend features
- `WISTIA_API_KEY` - video hosting/transcripts (lessons use Wistia video IDs)

## Viktor / AI influencer infrastructure (optional but included)

- `ROOM30_API_KEY` - x-api-key for the external API Viktor calls
- `VIKTOR_SLACK_WEBHOOK_URL` - posts every newly queued influencer job (unset = log-only)
- `MONDAY_API_TOKEN` - Monday.com job board mirror (unset = log-only)
- `OPS_SLACK_WEBHOOK_URL` - stuck-job alerts (unset = log-only)
- `INFLUENCER_INTERNAL_PIPELINE_ENABLED=1` only if you want in-process generation instead of Viktor

## Other feature groups (all optional - features disable gracefully when unset)

- Stripe: `STRIPE_*` / `TEST_STRIPE_*` (read only via `lib/stripe-mode.ts`; dev uses TEST keys)
- Object storage: `GCS_BUCKET_NAME`, `GCS_PROJECT_ID`, `GCS_CLIENT_EMAIL`, `GCS_PRIVATE_KEY`
- GHL webhooks: `GHL_WEBHOOK_SECRET`
- Comms: `KIT_API_KEY`, `WATI_API_KEY` + `WATI_BASE_URL`

Full reference: `docs/env-vars.md` inside the original repo; the backend logs a clear warning at boot for anything missing that a route needs.

## Notes

- `PUBLIC_APP_URL` should be set to your production origin in any environment that sends customer email.
- The API server still contains backend routes for the removed AI tools; they are unreachable from the pruned frontend and can be deleted later if desired.
- Course content: create phases and lessons at `/members/admin` once an admin user exists (first Replit Auth sign-in creates the portal user; promote it to admin directly in the `portal_users` table or via the admin console with an existing admin).

- DFY downloadable assets: the DFY pages serve files from an assets directory (default `attached_assets/`, override with `DFY_ASSETS_DIR`). This export includes only the handful of images the portal UI itself needs - copy your DFY asset files into `attached_assets/` if the client should have the DFY downloads.

- Fresh-project dev note: the portal Vite config expects `PORT` and `BASE_PATH` from the workflow environment. If your workflow does not set them, run the portal as `BASE_PATH=/members/ PORT=<port> pnpm --filter @workspace/room30-portal run dev` (Replit artifact registration normally wires these automatically).
