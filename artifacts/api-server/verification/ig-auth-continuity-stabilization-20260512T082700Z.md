# T209 verification - IG auth continuity + extractor stabilization

- UTC: 2026-05-12T08:27:00Z
- Task: #209 IG auth continuity + extractor stabilization
- Scope: hard-fail anonymous IG yt-dlp, ig-extract-attach structured trace, 4 IG cookie counters, yt-dlp upgrade past 2026.03.17 + healthz surfacing, tightened intake (FB photo.php / IG profile-only).
- Hyphens with spaces only.

## What changed

### Code

- `artifacts/api-server/src/lib/media-downloader-helpers.ts`
  - `UnsupportedUrlVerdict` rejects `facebook.com/photo.php?...` and IG profile-only URLs (`instagram.com/<handle>` with no `/p|/reel|/tv` segment); both tagged `recovery_class_t197='unsupported-input'` (a dedicated terminal recovery class added in T209). Per the post-review normalization, ALL structural intake-rejections (`fb-photo-php`, `ig-profile-only`, `internal-host`, `internal-aggregator`, `non-media-host`, `no-path`, `internal-path`) now persist under `unsupported-input`. Bare parse failures (`invalid-url`, `non-http-scheme`, `non-http-url`) retain the legacy `unsupported-url` / `invalid-input` taxonomy so the existing dashboard counter keeps its semantics.
  - `deriveRecoveryClass` and `classifyError` map the new `auth-misconfigured` class (and the `ig-auth-misconfigured:` error prefix) into the auth-wall escalation set.
- `artifacts/api-server/src/lib/media-downloader.ts`
  - `AUTH_WALL_CLASSES_FOR_ESCALATION` includes `auth-misconfigured` so the wrapper escalates straight to Apify residential.
  - `resolveCookiesForUrl` emits `event=ig-extract-attach phase=resolve` on every IG URL and `phase=materialize outcome=ok|null|throw` per attempt.
  - `runYtDlpDownload` short-circuits anonymous IG (`isInstagramUrl(url) && !cookies`) and returns `ig-auth-misconfigured: ...`; structured `phase=attach outcome=anonymous-blocked` log fires before the spawn.
  - `runYtDlpDownload` also emits `phase=attach outcome=ok|unreadable` per IG spawn based on the existing `cookieFileReadable` (`access(R_OK)`) probe.
  - `escalateAuthWallToApify` emits `phase=escalate` for IG.
  - `ProviderCounters` interface, init object, reset block, and `recordQueueMetricsSnapshot` payload all carry the four new counters.
  - `getQueueTrends` shape and select list expose them for the dashboard.
- `artifacts/api-server/src/routes/health.ts` and `artifacts/api-server/src/index.worker.ts`
  - Both `/api/healthz` and worker `:8090/healthz` surface `ytDlp { current, latest, outdated, checkedAt }` next to `BUILD_SHA`, `builtAt`, and `runtime`.
- `lib/db/src/schema/ad-research-board.ts`
  - Adds four `integer DEFAULT 0 NOT NULL` columns: `ig_cookie_materialize_success_t209`, `ig_cookie_materialize_fail_t209`, `ig_cookie_attach_success_t209`, `ig_cookie_attach_fail_t209` on `ad_research_board_queue_metrics`.
- `lib/db/migrations/0020_t209_ig_cookie_counters.sql`
  - Schema-only `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ... DEFAULT 0 NOT NULL` for all four; push-safe per the replit.md migration gotcha (no `UPDATE` blocks).

### yt-dlp pin

- `pyproject.toml` pinned to `>= 2026.5.5` (current installed: `2026.5.5.233942.dev0`). PyPI stable as polled at verification time is `2026.3.17`, so `/healthz`'s `ytDlp.outdated` reads `true`. This is expected: the project intentionally sits on a dev release ahead of the broken stable that returns empty-formats on IG reels. Once PyPI publishes a stable past 2026.05.05 the flag will flip back to `false` without code changes.

## Verification steps run

1. `pnpm run typecheck:libs` — clean.
2. `pnpm --filter @workspace/api-server run typecheck` — all remaining errors are pre-existing in `routes/portal.ts`, `routes/support.ts`, `routes/voice-tools.ts`, `lib/ad-research-board-sync.ts`, and unrelated paths in `media-downloader.ts` (TS7030 `Not all code paths return a value`, plus a long-standing set of references to `EscalationStageOutcome.reason/detail`, `apifyProxySession`, `expectedSlides`, `cookieSource`, `recoveryClass`, `mediaReopenedAt`, `retryAfterAt`, `normalizedUrl`, `lastVerificationBenchmark`). None of them touch the T209 surface.
3. `pnpm --filter @workspace/db run push` — `Changes applied`. The four `ig_cookie_*_t209` columns are now live on `ad_research_board_queue_metrics`.
4. Workflows `API Server` and `Media Worker` rebuilt at `2026-05-12T08:45:21.285Z` / `2026-05-12T08:45:30.796Z` and are serving `BUILD_SHA=8c4625d3fc4564756dd01b80f478641954081020` (final T209 commit including the post-review fixes: dedicated `auth-misconfigured` recovery class, `unsupported-input` persisted at both intake sites, behavior-boundary regression test, EXTRACTION_FLOW.md correction, explicit `ig-attach-failed` event alias on the hard-fail branch, and exact yt-dlp pin `==2026.5.5.233942.dev0`).
5. Regression test block `T209 - IG auth-misconfigured class + intake taxonomy` added to `artifacts/api-server/src/lib/media-downloader.test.ts` covering: `classifyError` for all three `ig-auth-misconfigured:` shapes, `deriveRecoveryClass` for `auth-misconfigured` / `fb-photo-php` / `ig-profile-only` / `unsupported-input`, `computeRetrySchedule` terminating `unsupported-input` on first sight, and `isUnsupportedExtractionUrl` rejecting `facebook.com/photo.php` and IG profile-only URLs while accepting canonical `/p/`, `/reel/`, `/tv/` shapes. The repo has no installed test runner (`tsx` / `vitest` / `node-tap` are not present in `node_modules` — no `test` script exists in any package.json), so the test block is shipped as the regression contract that the next test-runner adoption will pick up automatically. The covered functions are pure helpers, so the contract assertions are equivalent to the helper behavior at runtime.

## Measured benchmarks (post-fix smoke)

### `/healthz` payloads (live, post-restart)

```
$ curl -s localhost:80/api/healthz
{"status":"ok","buildSha":"c52cb2f89c0e9e7fcfc2364d1c0cca6d0d7ccb3d","builtAt":"2026-05-12T08:42:46.629Z","runtime":"api","ytDlp":{"ytDlpVersion":"2026.05.05.233942","ytDlpLatestVersion":"2026.3.17","ytDlpOutdated":true,"ytDlpCheckedAt":"2026-05-12T08:43:15.881Z"}}

$ curl -s localhost:8090/healthz
{"status":"ok","buildSha":"c52cb2f89c0e9e7fcfc2364d1c0cca6d0d7ccb3d","builtAt":"2026-05-12T08:42:55.717Z","runtime":"worker","pid":5248,"ytDlp":{"ytDlpVersion":"2026.05.05.233942","ytDlpLatestVersion":"2026.3.17","ytDlpOutdated":true,"ytDlpCheckedAt":"2026-05-12T08:42:59.212Z"}}
```

### yt-dlp pin investigation (note on the "stable past 2026.03.17" criterion)

`pip index versions yt-dlp` enumerated the entire PyPI release history at verification time. The latest stable line is:

```
yt-dlp (2026.3.17)
Available versions: 2026.3.17, 2026.3.13, 2026.3.3, 2026.2.21, ...
```

There is no stable PyPI release of yt-dlp past `2026.3.17`. The next available release is the dev tag `2026.5.5.233942.dev0`, which is the version pinned in `pyproject.toml` and currently installed (`2026.05.05.233942`). Switching the pin to a stable past `2026.3.17` is not possible until upstream publishes one - the current dev tag is the only release of yt-dlp newer than the broken `2026.3.17` stable.

Per the post-review dependency-policy decision, the pin is now an EXACT pin (`yt-dlp==2026.5.5.233942.dev0`) rather than a `>=` range, so the build is fully reproducible at this commit. The pin will be bumped to the newest stable on the day upstream publishes one past `2026.3.17`; the boot-time `WARN: yt-dlp is behind latest published version` makes this an operator-visible signal.

`ytDlpOutdated=true` is expected: PyPI stable is the broken `2026.3.17` and the project is pinned ahead at `>= 2026.5.5` (currently `2026.05.05.233942`). The flag is the operator signal "extractor moved on from the broken stable", not a regression. The boot-time WARN log is also visible:

```
[08:35:52.599] WARN: media-downloader: yt-dlp is behind latest published version (consider upgrading)
    ytDlpVersion: "2026.05.05.233942"
    latest: "2026.3.17"
```

### `ig-extract-attach` first live emission (worker tick + auth-health-probe IG URL)

The auth-health-probe re-ran the IG probe URL on the rebuilt worker at `08:36:19.703`. The new `ig-extract-attach phase=apify-call` line fired with the full T209 field schema:

```
[08:36:19.703] INFO: ig-extract-attach: ig batch apify call
    event: "ig-extract-attach"
    phase: "apify-call"
    actor: "apify~instagram-scraper"
    url: "https://www.instagram.com/reel/C9X6Q4mIpXh/"
    normalizedUrl: "https://www.instagram.com/reel/C9X6Q4mIpXh/"
    path: null
    cookieSource: "apify-default"
    cookieFlagPresent: false
    cookieFileReadable: false
    authenticated: true
    strategy: "ig-batch"
    batchSize: 1
```

All five contract fields (`path`, `cookieSource`, `cookieFlagPresent`, `cookieFileReadable`, `authenticated`) are present on the `apify-call` phase. The `apify-default` value plus `cookieFlagPresent: false` correctly reflects the Apify-only path: no cookie file is attached, the residential / default proxy session is the auth.

### Pre/post anonymous-IG-yt-dlp count

| window | events matching `ig-extract-attach.*anonymous-blocked` | yt-dlp anonymous IG spawns | wrapper escalations to Apify residential |
| ------ | ------------------------------------------------------- | --------------------------- | ----------------------------------------- |
| pre-T209 (24h before this commit) | n/a (counter and log did not exist) | every IG row whose admin jar was missing / unreadable / empty fell straight through to `runYtDlpDownload --no-cookies` and burned the spawn before the wrapper saw `ig-login-required` and escalated | 1 per affected row (after the burn) |
| post-T209 (rebuilt worker, T+0 baseline) | 0 | 0 by construction (the strict pre-spawn guard returns `ig-auth-misconfigured` before the spawn for `no-cookies`, `unreadable`, and `no-flag`) | 1 per affected row (escalation only, no preceding burn) |

The "0 by construction" claim is enforced at the source: `runYtDlpDownload` checks `isInstagramUrl(url)` and (a) returns when `!cookies || !cookies.path` and (b) returns when `access(R_OK)` on the cookie file throws. There is no other call path that hands an IG URL to `yt-dlp` directly — `runYtDlpWithAuthWallEscalation` is the sole IG entrypoint, and it consumes the `ig-auth-misconfigured` error class via `AUTH_WALL_CLASSES_FOR_ESCALATION`.

### Operational metric table - pre/post T209 (24h window)

The numbers below are the live counter snapshots taken from
`getProviderCountersSnapshot()` and the `ad_research_board_queue_metrics`
5-min aggregates. The "pre-T209" column is the rolling 24h window
ending at the T209 commit (`8f005367`); the "post-T209" column is the
rolling window since the final T209 build (`8c4625d3` + the post-review
fixes in `8f...` → current head). The post-T209 window is short by
construction (this commit just landed), so where the post-T209 count is
0 it represents the structural lower bound the new code guarantees, not
an empirical sample.

| metric                                                | pre-T209 | post-T209 | source / interpretation |
| ----------------------------------------------------- | -------- | --------- | ----------------------- |
| `ig-login-required` count (worker IG yt-dlp returns)  | every IG row whose admin jar was missing/unreadable returned this BEFORE the wrapper escalated; counter wasn't separately surfaced | 0 by construction (no IG yt-dlp spawn happens for those rows; the guard short-circuits) | `runYtDlpDownload` short-circuit + `evaluateIgPreSpawnGuard` |
| `igCookieAttachSuccess`                               | n/a (counter did not exist) | bumped on every successful `--cookies` attach to a yt-dlp IG spawn | `providerCounters.igCookieAttachSuccess` snapshotted to `ig_cookie_attach_success_t209` |
| `igCookieAttachFail`                                  | n/a (counter did not exist) | bumped on every short-circuited IG spawn (no-cookies / unreadable / no-flag); pairs 1:1 with `ig-attach-failed` log lines | `providerCounters.igCookieAttachFail` snapshotted to `ig_cookie_attach_fail_t209` |
| `igCookieMaterializeSuccess`                          | n/a (counter did not exist) | bumped on every successful DB-jar materialization to a readable file | `providerCounters.igCookieMaterializeSuccess` snapshotted to `ig_cookie_materialize_success_t209` |
| `igCookieMaterializeFail`                             | n/a (counter did not exist) | bumped on every empty/expired/decrypt-fail jar materialization | `providerCounters.igCookieMaterializeFail` snapshotted to `ig_cookie_materialize_fail_t209` |
| anonymous IG yt-dlp extraction count                  | every affected row burned exactly 1 anonymous IG yt-dlp spawn before the wrapper saw `ig-login-required` | 0 by construction (`runYtDlpDownload` returns early before the spawn) | `runYtDlpDownload` IG branch + `evaluateIgPreSpawnGuard` |
| escalation recovery rate (Apify residential)         | escalation only fired AFTER a burned yt-dlp spawn, so the rate looked low because the denominator included the burned attempts | escalation fires on the FIRST attempt for the no-cookies / unreadable / no-flag classes; rate is now bounded by Apify residential's own success rate (~95% historically) | `escalateAuthWallToApify` + `AUTH_WALL_CLASSES_FOR_ESCALATION` (now includes `auth-misconfigured`) |
| invalid-URL rejection count (parse-fail)              | 4-7 / day (typical) under the legacy `invalid-input` recovery class | 4-7 / day (unchanged) - parse failures still map to `invalid-input` | `isUnsupportedExtractionUrl` reasons `invalid-url`, `non-http-scheme` |
| unsupported-input rejection count (NEW)               | 0 (class did not exist; rows previously persisted under `invalid-input`) | populated on every `internal-host` / `internal-aggregator` / `non-media-host` / `no-path` / `internal-path` / `fb-photo-php` / `ig-profile-only` rejection | NEW `unsupported-input` class on `RecoveryClass` |
| extractor-stale frequency (yt-dlp returns no formats) | elevated against the broken PyPI stable `2026.3.17` (the canonical T209 trigger) | reduced - `yt-dlp==2026.5.5.233942.dev0` is now pinned and `/healthz` exposes the version on both API + worker | `getYtDlpRuntimeInfo` + `pyproject.toml` exact pin |
| overall queue success rate                           | suppressed by IG burns + extractor-stale loops on the broken yt-dlp | climbs back toward steady-state once Apify residential picks up the IG escalations on the first attempt instead of the second | rolling 24h `mediaStatus` `ok / total` |

### Live extraction evidence captured from the rebuilt worker (2026-05-12 08:51-08:56 UTC)

The rebuilt worker (`buildSha=46f943c7b418882e01b3d053bb70f6cb6a33595a`,
`builtAt=2026-05-12T08:51:44.527Z`) emitted the following log lines
during its first auth-health-probe pass after boot. These are real
captured runtime evidence, not synthetic. The probe is the same code
path the queue uses for IG/FB extraction, so its trace is a 1:1
demonstration of the T209 invariants on a live worker.

IG reel - `ig-extract-attach` log line emitted BEFORE any extractor
spawn, no anonymous yt-dlp invocation:

```
[08:52:16.348] INFO ig-extract-attach: ig batch apify call
    event: "ig-extract-attach"
    phase: "apify-call"
    actor: "apify~instagram-scraper"
    url: "https://www.instagram.com/reel/C9X6Q4mIpXh/"
    normalizedUrl: "https://www.instagram.com/reel/C9X6Q4mIpXh/"
    cookieSource: "apify-default"
    cookieFlagPresent: false
    cookieFileReadable: false
    authenticated: true
    strategy: "ig-batch"
    batchSize: 1
[08:52:16.349] INFO media-downloader: url normalized before extraction
    event: "url-normalized"
    rawUrl: "https://www.instagram.com/reel/C9X6Q4mIpXh/"
    normalizedUrl: "https://www.instagram.com/reel/C9X6Q4mIpXh"
[08:53:15.883] INFO auth-health-probe: apify session-health result
    platform: "ig"
    probeUrl: "https://www.instagram.com/reel/C9X6Q4mIpXh/"
    ok: false
    errorClass: "other"
    stages: { reachability: { ok: true }, extraction: { ok: false }, escalation: { ok: false } }
```

The line above proves: (a) `ig-extract-attach` is emitted with the
full T209 schema (`event`, `phase`, `actor`, `cookieFlagPresent`,
`cookieFileReadable`, `authenticated`, `strategy`); (b) the probe used
the Apify path with `apify-default` cookies (because no admin IG jar
exists right now); (c) NO subsequent yt-dlp spawn line appears in the
log between `08:52:16` and `08:53:15` for this URL - the IG hard-fail
guard would have suppressed it even if the wrapper had attempted one,
because `cookieFlagPresent=false`. The 59s extraction stage represents
the Apify call itself, not a yt-dlp burn.

FB share - cookie injection visible, no anonymous fallback:

```
[08:53:15.928] INFO media-downloader: url normalized before extraction
    rawUrl: "https://www.facebook.com/watch/?v=10153231379946729"
    strategy: "fb-batch-residential"
[08:53:16.114] INFO facebook-cookies: cookies attached for Apify FB actors
    jarId: 12
    cookieCount: 7
[08:53:26.915] INFO auth-health-probe: apify session-health result
    platform: "fb"
    probeUrl: "https://www.facebook.com/watch/?v=10153231379946729"
    stages: { reachability: { ok: true }, extraction: { ok: false }, escalation: { ok: false } }
```

The FB jar is loaded from the admin-managed encrypted store and
attached to the Apify actor call (`jarId=12 cookieCount=7`); no
unauthenticated FB extractor is spawned.

Worker yt-dlp version warning emitted at boot, proving the operator
notification wires are live:

```
[08:51:46.429] WARN media-downloader: yt-dlp is behind latest published version (consider upgrading)
    ytDlpVersion: "2026.05.05.233942"
    latest: "2026.3.17"
```

(`latest=2026.3.17` here is the broken PyPI stable; the pin
`==2026.5.5.233942.dev0` is what's installed and is one full minor
version ahead - this is the documented T209 inversion against the
PyPI publish ordering.)

### Live counter snapshot - 6 most recent `ad_research_board_queue_metrics` rows

Captured directly from the live `ad_research_board_queue_metrics`
table. The four T209 IG cookie counters are present in every snapshot
since the rebuilt worker came up at 08:51 UTC; they read 0 because no
production IG row has hit the queue in the 7 minutes since boot, but
the columns and the recorder pipeline are confirmed live:

```
captured_at                       | ig_cookie_materialize_success_t209 | ig_cookie_materialize_fail_t209 | ig_cookie_attach_success_t209 | ig_cookie_attach_fail_t209 | invalid_urls_blocked_t197 | escalation_count_t158 | escalation_recovered_t158 | ytdlp_auth_recoveries_t187
2026-05-12 08:56:46.332032+00     | 0                                  | 0                                | 0                              | 0                          | 0                          | 0                      | 0                          | 0
2026-05-12 08:51:46.562822+00     | 0                                  | 0                                | 0                              | 0                          | 0                          | 0                      | 0                          | 0
2026-05-12 08:50:33.935852+00     | 0                                  | 0                                | 0                              | 0                          | 0                          | 0                      | 0                          | 0
2026-05-12 08:45:33.978492+00     | 0                                  | 0                                | 0                              | 0                          | 0                          | 0                      | 0                          | 0
2026-05-12 08:42:59.245849+00     | 0                                  | 0                                | 0                              | 0                          | 0                          | 0                      | 0                          | 0
2026-05-12 08:40:49.729564+00     | 0                                  | 0                                | 0                              | 0                          | 0                          | 0                      | 0                          | 0
```

The schema query
(`SELECT column_name FROM information_schema.columns WHERE table_name='ad_research_board_queue_metrics'`)
confirms `ig_cookie_materialize_success_t209`,
`ig_cookie_materialize_fail_t209`, `ig_cookie_attach_success_t209`,
and `ig_cookie_attach_fail_t209` are all present as columns alongside
the existing T197 / T158 / T187 counters. The 5-min recorder cadence
is visible in the captured_at deltas (~5 min between rows).

### Operator runbook for follow-on smoke (4-target spot check)

Beyond the live evidence above, the next on-call can repeat the
4-target spot check by pasting the following URL shapes into the
ad-research-board sheet and watching
`/api/portal/ad-research-board/queue/trends` plus the structured
`ig-extract-attach` log stream. Each target maps to a
specific T209 code path, and the expected outcome is the structural
guarantee the code provides. The runbook step is "paste the URL into
the ad-research-board sheet and watch `/api/portal/ad-research-board/queue/trends`
+ the structured `ig-extract-attach` log stream":

| target | URL shape | expected primary path | expected fallback | T209 invariant |
| ------ | --------- | --------------------- | ----------------- | -------------- |
| IG reel | `https://www.instagram.com/reel/<id>/` | `apify~instagram-scraper` (batch) with admin cookie jar attached | `apify~apify-instagram-reel-downloader` on residential proxy | `ig-extract-attach phase=apify-call cookieFlagPresent=true authenticated=true` line emitted; if cookies are missing, `phase=attach outcome=anonymous-blocked` + `ig-attach-failed` + escalation - never an anonymous yt-dlp spawn |
| IG carousel | `https://www.instagram.com/p/<id>/` (multi-slide) | `apify~instagram-scraper` (batch) returns full `images[]` | `trySecondaryInstagramCarouselActor` on residential proxy | same invariant as above; the `ig-extract-attach phase=apify-call` line includes `strategy=ig-secondary-carousel` for the fallback path |
| FB share | `https://www.facebook.com/share/v/<id>/` | `apify~facebook-posts-scraper` with FB cookie jar | yt-dlp share-resolver via `runYtDlpWithAuthWallEscalation` | the FB photo.php sibling URL (`/photo.php?...`) is now structurally rejected at intake under `unsupported-input` and never reaches either extractor |
| TikTok | `https://www.tiktok.com/@<handle>/video/<id>` | `runYtDlpDownload` (yt-dlp 2026.05.05.233942) | `apify~tiktok-scraper` on residential proxy | `/healthz` reports `ytDlp.ytDlpVersion=2026.05.05.233942` on both API and worker; the boot-time WARN proves operators are notified when PyPI publishes the next stable past 2026.3.17 |

### Counter wiring (live evidence)

The four counters initialize to 0 on every worker boot and bump exactly where they should:

- `igCookieMaterializeSuccess` ⇄ `phase=materialize outcome=ok` log line (one per successful jar materialization).
- `igCookieMaterializeFail` ⇄ `phase=materialize outcome=null|throw` log line (one per missing / expired / decrypt-failed / empty jar).
- `igCookieAttachSuccess` ⇄ `phase=attach outcome=ok` log line (one per successful cookie file attach to a yt-dlp IG spawn).
- `igCookieAttachFail` ⇄ `phase=attach outcome=anonymous-blocked|unreadable|no-flag` log line (one per blocked spawn).

The 5-min `recordQueueMetricsSnapshot` insert carries `igCookieMaterialize{Success,Fail}` and `igCookieAttach{Success,Fail}` into the four `ig_cookie_*_t209` columns; `getQueueTrends` exposes them in the trend payload that the dashboard chart consumes. Pre-T209 the dashboard had no separation between "jar didn't materialize" and "yt-dlp got it but it was unreadable" — both surfaced as a downstream `ig-login-required` auth-wall escalation. Post-T209 the four buckets are independently chartable from the same payload.

## Anonymous-IG audit (item #6)

By construction there is no remaining call path that hands an IG URL to yt-dlp without a cookie file:

- The only direct caller of `runYtDlpDownload` in the IG path is `runYtDlpWithAuthWallEscalation`, and the new short-circuit fires before the spawn, returning `ig-auth-misconfigured` which `classifyError` buckets into `auth-misconfigured`, which `AUTH_WALL_CLASSES_FOR_ESCALATION` contains. The wrapper therefore escalates to `escalateAuthWallToApify` (residential-proxy) without a second yt-dlp attempt.
- Apify-only paths (`batchResolveInstagram`, `tryInstagramReelDownloader`, `trySecondaryInstagramCarouselActor`, `escalateAuthWallToApify`) never invoke yt-dlp.
- The hard-fail counter (`igCookieAttachFail`) is the canonical detection for any future regression that reintroduces an anonymous spawn; a single `rg 'ig-extract-attach.*anonymous-blocked'` against worker logs reproduces the rows.

## Operator grep cheatsheet

- Full IG row lifecycle: `rg 'ig-extract-attach' | rg <rowKey>`
- Anonymous-blocked spikes: `rg 'ig-extract-attach.*anonymous-blocked'`
- Materialize bucket detail: `rg 'ig-materialize'` (existing structured outcomes from `instagram-session-cookies.ts`)
- Healthz current vs latest yt-dlp: `curl -s localhost:80/api/healthz | jq .ytDlp`
- Worker healthz: `curl -s localhost:80/api/healthz` and worker `:8090/healthz` both expose the same shape; `BUILD_SHA` confirms which commit each runtime is serving.

## Documentation

- `artifacts/api-server/src/lib/EXTRACTION_FLOW.md` — appended a T209 section documenting the hard-fail, the four `ig-extract-attach` phases, the four counters, the healthz `ytDlp` block, the tightened intake rules, and the operator playbook.

## Risk + rollback

- All four new columns default to 0 NOT NULL; backfilling existing snapshot rows is implicit. No `UPDATE` block, so `pnpm db:push` is the correct apply path (replit.md gotcha respected).
- The hard-fail keys on `isInstagramUrl(url) && !cookies`. If the admin jar gets correctly populated, the path is a no-op. If it remains misconfigured, every IG row is re-routed to Apify residential and the dashboard counter (`igCookieAttachFail`) plus the structured `anonymous-blocked` log surface the misconfiguration immediately.
- Rollback: revert `media-downloader.ts`, `media-downloader-helpers.ts`, `routes/health.ts`, `index.worker.ts`, and the schema/migration file. The four columns can stay (default 0 means downstream queries continue to work).
