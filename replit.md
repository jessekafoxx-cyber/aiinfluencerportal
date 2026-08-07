# Room30 Portal

Members course portal ("Prompt & Build") serving one main masterclass — 14 lessons on building an AI-influencer business — plus admin tooling, DFY features, and support articles.

## Run & Operate

- Workflows: `artifacts/api-server: API Server` (port 8080, `/api`), `artifacts/api-server: Media Worker`, `artifacts/room30-portal: web` (port 21021, `/members/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks/Zod from OpenAPI
- `pnpm --filter @workspace/db run push-force` — push DB schema (requires `CREATE EXTENSION vector` on a fresh DB)
- Required env: `DATABASE_URL`, `SESSION_SECRET` (Replit Auth sessions), `AI_INTEGRATIONS_OPENAI_*`. Stripe/Whop/GCS/Apify/Wistia degrade gracefully when unset.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5; Frontend: React + Vite + wouter, Replit Auth (OIDC, cookie sessions)
- DB: PostgreSQL + Drizzle ORM; Zod (`zod/v4`), Orval codegen; esbuild bundle

## Where things live

- Course content seed: `artifacts/api-server/src/lib/masterclass-course-data.ts` (14 lessons, plain-text notes) applied at boot by `ensure-main-masterclass.ts`
- DB schema: `lib/db/src/schema/` (portal tables in `portal.ts`)
- Lesson page: `artifacts/room30-portal/src/pages/course-player.tsx` — single Brief view: video placeholder on top, brief + notes underneath (Notes/Build/Action tabs removed)
- Admin emails: `ADMIN_EMAILS` env (default `greg@cookemedia.io`) — matching Replit Auth sign-ins get admin + active automatically; other sign-ups need activation (purchase/invite)

## Architecture decisions

- Old-course boot seed hooks (ensureRoom30Course, ensurePhase5, etc.) were removed and replaced with idempotent `ensureMainMasterclass`, which also prunes stale room30 phases/lessons (only phases no remaining lesson references).
- Lessons ship with `wistia_video_id = NULL` → portal shows a video placeholder; admins add videos via the lesson page.
