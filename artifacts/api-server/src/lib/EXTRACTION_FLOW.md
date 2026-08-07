# Media extraction flow (Task #158, refreshed in T159)

This document is the operator-facing reference for how the ad-research-board pipeline pulls media for IG, FB, and "other" rows. It describes the runtime ordering, the auth-wall escalation contract, the observability counters, and the kill switches.

## High-level pipeline

For every row in the `ad_research_board_items` queue:

1. The worker leases the row (Postgres advisory-style lease with heartbeat).
2. The row is classified by URL host into IG / FB / YT / other.
3. The primary extractor for the row is invoked (see "Per-platform routing" below).
4. The result is persisted via `persistResult` / `persistPartialResult` / `persistMultiResult`. Success branches call `recordPersistSuccess(source)` so the per-provider counters move.
5. Failure branches set `media_error_class` using `classifyError`. Operator-bucket mapping happens in `operationalBucket`.

## Per-platform routing

| Platform | Primary | Fallback                                    |
| -------- | ------- | ------------------------------------------- |
| IG       | Apify   | yt-dlp + auth-wall escalation back to Apify |
| FB       | Apify (residential proxy) | yt-dlp + auth-wall escalation back to Apify |
| Other    | yt-dlp + auth-wall escalation back to Apify | none |

`batchResolveInstagram` and `batchResolveFacebook` (in `media-downloader.ts`) own all Apify calls. FB extraction passes `{ residentialProxy: true }` so the Apify actor uses `RESIDENTIAL` proxies, which is required for sustained authenticated FB extraction.

## Auth-wall escalation contract (T158)

`runYtDlpWithAuthWallEscalation(url, ctx)` wraps `runYtDlpDownload`. When the wrapped call fails with one of the auth-wall classes:

```
ig-login-required
fb-auth-wall
auth
auth-wall-escalation
```

the wrapper:

1. Bumps `escalationCount` (intent counter).
2. Re-routes the URL to Apify by calling the appropriate `batchResolve*` function.
3. If Apify produces >= 1 slide, the wrapper returns success and the per-provider success counter is moved by the persist hook (so escalation recoveries show as `apify_success` plus `escalation_recovered`).
4. If Apify also fails, the wrapper returns a failure with `errorClass = "auth-wall-escalated-failed"`. `operationalBucket` maps this to the `auth` bucket so the dashboard renders it next to the other auth failures.

Why a distinct error class: it preserves the cause-of-failure breadcrumb (yt-dlp auth wall) while making it easy to alert on "Apify also failed" - the only failure mode after T158 that an operator can actually act on by refreshing the Apify session.

## Per-provider observability (T158, T159 attribution rules)

Counters are kept in-process in `media-downloader.ts` (`providerCounters`) and drained on each `recordQueueMetricsSnapshot()` flush:

| Counter               | Meaning                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `apify_success`       | Rows persisted via Apify (any actor, including direct CDN aliases).                      |
| `ytdlp_success`       | Rows persisted via yt-dlp (no escalation involved).                                      |
| `escalation_count`    | Times the escalation wrapper was triggered (yt-dlp hit an auth-wall class).              |
| `escalation_recovery` | Of the above, how many succeeded after retrying through Apify.                           |

Persisted to `ad_research_board_queue_metrics` as `apify_success_t158`, `ytdlp_success_t158`, `escalation_count_t158`, `escalation_recovered_t158`. The columns are additive; the existing trend dashboard reads them through `getQueueTrends`.

`getQueueHealth` exposes the live (un-flushed) snapshot under `providers.{apifySuccess, ytdlpSuccess, escalationCount, escalationRecovered, escalationRecoveryRate}` for the dashboard's "Provider Mix" strip.

### Source-string contract (T159)

The bucket above is decided by the pure `classifyPersistSource(source)` function (`media-downloader.ts`). Every `persistResult` / `persistMultiResult` / `persistPartialResult` call site MUST pass a `meta.source` string that maps to one of these buckets:

| Source string                                                  | Bucket             |
| -------------------------------------------------------------- | ------------------ |
| `"apify-escalation"`                                           | `apify-escalation` (`apify_success` + `escalation_recovered`) |
| Any string containing `"yt-dlp"` / `"ytdlp"`                   | `ytdlp`            |
| Any string containing `"apify"` (e.g. `apify~instagram-scraper`, `@residential` suffix) | `apify` |
| `presetshubham~instagram-reel-downloader` (Apify actor without the `apify~` namespace) | `apify` |
| `"direct"`, `"cdn-direct"`, `"share-resolver"` (primary-path direct CDN hits) | `apify` |
| Anything else (incl. `""` / `null` / `"single-fallback"`)      | `fallback` (warn, no counter bump) |

The fallback bucket is intentionally a no-op: if a future call site forgets to tag the source, the Provider Mix strip stays honest and a `persist:source-unclassified` warn breadcrumb fires immediately. T159 fixed the `refetchMediaForRow` regression where the single-fallback path hard-coded `source: "single-fallback"` and silently inflated `apify_success`; `downloadAndStoreMedia` now propagates an `effectiveSource` field and the persist call uses that.

The classifier is regression-tested in `media-downloader.test.ts` -> `classifyPersistSource`.

## Apify session-health probe (T159, formerly auth-cookie probe)

The 6-hour probe in `auth-health-probe.ts` is now a 3-stage check rather than a single dry-run. Each pass writes one composite outcome to `auth_health` per platform, with the per-stage breakdown encoded into `lastError` (no schema change).

| Stage          | What it does                                                                                 | Why it matters |
| -------------- | -------------------------------------------------------------------------------------------- | -------------- |
| reachability   | `GET https://api.apify.com/v2/acts/<actor>` using `APIFY_TOKEN`.                              | Catches missing/expired token (401/403), drifted actor name (404), Apify outage. Skips downstream stages on failure. |
| extraction     | `batchResolveInstagram` / `batchResolveFacebook` against `AUTH_HEALTH_PROBE_URL_*`.           | Confirms the actor produces >= 1 slide for a known-healthy session. |
| escalation     | `escalateAuthWallToApify` against the same URL.                                               | Confirms the residential-proxy recovery path is wired up. |

Outcome composition: the first failing stage drives `lastErrorClass`; `lastError` always carries the full `reachability=… | extraction=… | escalation=…` triplet so the dashboard can render a per-stage breakdown.

Routes (T159): the canonical dashboard paths are `POST /portal/admin/extraction/probe` and `POST /portal/admin/extraction/diagnose`. The legacy `auth-cookies/{probe,diagnose}` paths are kept as compat shims that delegate to the same handlers, so existing runbooks / external monitors keep working until they migrate.

`runDiagnostic` is read-only (does NOT write `auth_health`) so admins can sanity-check any URL without polluting the probe signal. It reports `jarId` for operator context only - jar presence does NOT gate ok/fail under the Apify-first pipeline.

## What was REMOVED in T158

- The customer-facing `cookies.txt` upload textarea + delete buttons in the admin dashboard (`AuthHealthCard`).
- `POST /portal/admin/auth-cookies` and `DELETE /portal/admin/auth-cookies/:platform`.
- `adminUploadAuthCookie` / `adminDeleteAuthCookie` from the portal API client.

## What was KEPT (additive only)

- `auth_cookie_jars` and `auth_health` schema, untouched.
- `lib/auth-cookies.ts` - still used by `buildAuthSection` (dashboard read path) and the diagnose endpoint's URL classification helper.
- `runYtDlpDownload` accepts `--cookies` when an active jar exists. This means an operator can still drop a jar straight into the DB / object storage if they ever need to bypass Apify, but there is no UI for it.
- `GET /portal/admin/auth-cookies` - read-only metadata for the dashboard.

## Kill switches (env)

- `MEDIA_WORKERS_DISABLED=1` - skip the periodic media processor entirely.
- `AUTOMATION_WORKERS_DISABLED=1` - skip every scheduler that could enqueue media work.
- `AUTH_HEALTH_PROBE_DISABLED=1` - skip the 6h Apify dry-run probe.
- `AUTH_HEALTH_PROBE_URL_IG`, `AUTH_HEALTH_PROBE_URL_FB` - override the probe targets when defaults rot.

## T209: IG auth continuity + extractor stabilization

T209 closes the silent-failure gap that let yt-dlp invoke Instagram URLs anonymously when the admin-managed jar (or env break-glass) was missing, expired, or unreadable. yt-dlp anonymous IG returns `ig-login-required` ~100% of the time, so each anonymous call burned a worker slot before the auth-wall escalation wrapper got its turn. Two structural changes plus four new counters now keep an operator one grep away from the truth.

### 1. Hard-fail anonymous IG yt-dlp

`runYtDlpDownload` now short-circuits on `isInstagramUrl(url) && !cookies` BEFORE the spawn. It returns `ig-auth-misconfigured: anonymous IG yt-dlp invocation blocked (...) recovery_class_t197=auth-misconfigured`. `classifyError` maps both the `ig-auth-misconfigured:` prefix and the `auth-misconfigured` class string to the new `auth-misconfigured` recovery class, which `AUTH_WALL_CLASSES_FOR_ESCALATION` includes - so the existing `runYtDlpWithAuthWallEscalation` wrapper routes the row straight to the Apify residential-proxy escalation actor (the only remaining auth-bypass). Net effect: one cheap classify + one residential-proxy attempt instead of one yt-dlp burn + one residential attempt.

### 2. `ig-extract-attach` structured trace

Every IG path emits a JSON line under `event=ig-extract-attach` so a single `rg ig-extract-attach` reproduces the row's full lifecycle:

| phase        | emitted at                                                  | outcome values                                  |
| ------------ | ----------------------------------------------------------- | ----------------------------------------------- |
| `resolve`    | `resolveCookiesForUrl` entry on every IG URL                 | -                                               |
| `materialize`| `resolveCookiesForUrl` IG branch                            | `ok`, `null`, `throw`                           |
| `attach`     | `runYtDlpDownload` after `access(R_OK)` on the cookie file  | `ok`, `unreadable`, `anonymous-blocked`         |
| `escalate`   | `escalateAuthWallToApify` IG entry                          | -                                               |

The line includes `rowKey`, `adLink`, `normalizedUrl`, `resolverMode`, and (where applicable) `cookieSource`, `cookieFlagPresent`, `cookieFileReadable`. Cookie bytes are never logged.

### 3. Four IG cookie counters on providerCounters + queue_metrics

| counter                          | bumps when                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `igCookieMaterializeSuccess`     | `materializeInstagramCookieFile()` returns a non-null path                                 |
| `igCookieMaterializeFail`        | helper returns null OR throws (jar missing, expired, decrypt-failed, empty)                |
| `igCookieAttachSuccess`          | per yt-dlp IG spawn where the resolved cookie file is readable (`access(R_OK)` ok)         |
| `igCookieAttachFail`             | per yt-dlp IG spawn where the cookie file is unreadable, OR the anonymous hard-fail fired  |

All four drain into the 5-min `ad_research_board_queue_metrics` snapshot row (columns `ig_cookie_*_t209`, schema-only ALTERs in migration `0020_t209_ig_cookie_counters.sql`, push-safe per the replit.md gotcha). `getQueueTrends` exposes them so the dashboard can chart materialize-vs-attach failure separately from the auth-wall escalation wave they predict.

### 4. yt-dlp version surfaced on `/healthz`

`/api/healthz` (Express) and the worker's `:8090/healthz` both report `ytDlp { current, latest, outdated, checkedAt }`. `current` is taken from `yt-dlp --version` at boot; `latest` is the PyPI stable release polled lazily. The `outdated` boolean is the operator signal for "extractor probably stale; if IG/FB extraction is bleeding, this is the first knob to twist." The pyproject pin is now ahead of the broken 2026.03.17 release that was returning empty-formats on IG reels.

### 5. Tightened intake (helpers)

`UnsupportedUrlVerdict` now rejects two extra shapes at the queue's pre-claim filter:

- `facebook.com/photo.php?...` (always a static photo, never has video formats - was burning yt-dlp slots returning "no video formats found")
- IG `instagram.com/<handle>/?...` profile-only URLs with no `/p/`, `/reel/`, or `/tv/` segment (profile pages are not single posts; the actor returns the carousel of recent posts and we silently downgraded the row to slide #1)

Both are marked `recovery_class_t197='unsupported-input'` (a dedicated terminal class added in T209, distinct from `invalid-input` for parse failures and `dead-content` for owner-deleted posts). The persisted `mediaErrorClass` is `unsupported-input`, the `recoveryStrategy` is `permanent-dismiss-unsupported`, and the row is `dismissed=true` without a worker spawn.

The IG hard-fail (anonymous yt-dlp blocked because the admin jar is missing, unreadable, or its flag would not be passed) persists as `mediaErrorClass='auth-misconfigured'` with `recoveryClass='auth-misconfigured'` - a dedicated bucket distinct from `recoverable-auth` (which means cookies were attached but the platform rejected the session). Both classes are in `AUTH_WALL_CLASSES_FOR_ESCALATION`, so the wrapper escalates either to Apify residential without burning a yt-dlp call.

### 6. Operator playbook

- Anonymous IG attempt: `rg 'ig-extract-attach.*anonymous-blocked'` — should be zero in steady state.
- Materialize regression: spike in `igCookieMaterializeFail` on the dashboard → `rg 'ig-materialize'` to bucket (no-jar / jar-expired / decrypt-failed / empty-cookie-array).
- Attach regression with materialize healthy: spike in `igCookieAttachFail` with flat materialize → cookie file race against temp cleanup; `rg 'ig-extract-attach.*unreadable'` for affected rowKeys.
- Extractor stale: `/healthz`'s `ytDlp.outdated=true` for an extended window → bump pyproject pin and rebuild.

## Where to look next

- Per-platform routing: `media-downloader.ts` -> the `processOne*` helpers.
- Escalation wrapper: `media-downloader.ts` -> `runYtDlpWithAuthWallEscalation`, `AUTH_WALL_CLASSES_FOR_ESCALATION`.
- Source-string classifier: `media-downloader.ts` -> `classifyPersistSource` (T159) + `recordPersistSuccess`.
- Error classification: `media-downloader-helpers.ts` -> `classifyError` (now emits `auth-wall-escalated-failed`) and `operationalBucket`.
- Probe + diagnose: `auth-health-probe.ts` -> `checkApifyReachability`, `checkExtraction`, `checkEscalation`, `composeOutcome`.
- Dashboard wiring: `course-portal/src/pages/ad-research-board.tsx` -> `AuthHealthCard` and the Provider Mix strip in `QueueHealthPanel`.
- Route aliases: `routes/portal.ts` -> `adminExtractionProbeHandler`, `adminExtractionDiagnoseHandler` (mounted at `/portal/admin/extraction/{probe,diagnose}` and the legacy `/portal/admin/auth-cookies/{probe,diagnose}` shims).
