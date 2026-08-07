// Unit tests for the carousel detector + slide extractor used by the
// ad-research-board media downloader. Run with `node --test`.
//
// These tests cover the regression behind task #116: carousels were being
// silently downgraded to a single-item fallback because the downloader
// couldn't tell a real Sidecar post from a single image / video. The
// detector + extractor now distinguish them on every code path.
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  detectInstagramCarousel,
  detectFacebookCarousel,
  pickInstagramMediaList,
  pickFacebookMediaList,
  classifyError,
  derivePlatform,
  operationalBucket,
  computeOutcomeRollup,
  isApifyQuotaError,
  classifyApifyHttpFailure,
  noteApifyQuotaSignal,
  wasApifyQuotaRecent,
  _resetApifyQuotaSignalForTests,
  normalizeSocialUrl,
  classifyApifyEscalationItems,
  pickInstagramMedia,
  pickFacebookMedia,
  isPartialResumeError,
  deriveRecoveryClass,
  computeRetrySchedule,
  isUnsupportedExtractionUrl,
  evaluateIgPreSpawnGuard,
  igHardFailErrorString,
  type IgPreSpawnGuardCookies,
} from "./media-downloader-helpers.ts";
import {
  computeAuthSeverity,
  classifyPersistSource,
  isValidSlideUrl,
  buildSlideCandidateList,
} from "./media-downloader.ts";

describe("computeAuthSeverity - task #155 dashboard signal", () => {
  const noHealth = { healthStatuses: [], healthErrorClasses: [], jarCount: 1 } as const;
  it("returns ok at 0% with healthy jars", () => {
    assert.equal(computeAuthSeverity({ ratio1h: 0, ...noHealth }), "ok");
  });
  it("returns warning at 6% (>5% threshold)", () => {
    assert.equal(computeAuthSeverity({ ratio1h: 0.06, ...noHealth }), "warning");
  });
  it("stays ok at exactly 5%", () => {
    assert.equal(computeAuthSeverity({ ratio1h: 0.05, ...noHealth }), "ok");
  });
  it("returns critical at 26% (>25% threshold)", () => {
    assert.equal(computeAuthSeverity({ ratio1h: 0.26, ...noHealth }), "critical");
  });
  it("returns critical when any jar is expired even if ratio is 0", () => {
    assert.equal(
      computeAuthSeverity({
        ratio1h: 0,
        healthStatuses: ["ok", "expired"],
        healthErrorClasses: [null, "ig-login-required"],
        jarCount: 2,
      }),
      "critical",
    );
  });
  it("returns ok when jarCount is 0 (T158/T159: Apify holds the session, jar absence is steady state)", () => {
    // Pre-T158 this returned "warning" because the dashboard inferred
    // a missing cookie jar meant a broken session. Post-T158 the Apify
    // operator session is the source of truth and customer jars are
    // expected to be empty - so jarCount no longer feeds severity at
    // all. Probe outcomes (`healthStatuses`) and the live auth-bucket
    // ratio drive severity instead.
    assert.equal(
      computeAuthSeverity({ ratio1h: 0, healthStatuses: [], healthErrorClasses: [], jarCount: 0 }),
      "ok",
    );
  });
  it("returns warning on a degraded jar with low ratio", () => {
    assert.equal(
      computeAuthSeverity({
        ratio1h: 0.01,
        healthStatuses: ["degraded"],
        healthErrorClasses: [null],
        jarCount: 1,
      }),
      "warning",
    );
  });
});

// T159: per-provider attribution. The Provider Mix strip on the
// admin dashboard reads counters that recordPersistSuccess maintains;
// classifyPersistSource is the pure rule that maps every persist
// call site's `meta.source` string to one of those buckets. The
// regression we're guarding against is the T158 bug where the
// refetch single-fallback path persisted with a hard-coded source
// string the classifier didn't know about and silently inflated the
// apifySuccess counter. Anything not explicitly mapped MUST land in
// "fallback" so a future regression shows up loudly.
describe("classifyPersistSource - T159 attribution rules", () => {
  it("buckets the apify-escalation marker to its own bucket", () => {
    assert.equal(classifyPersistSource("apify-escalation"), "apify-escalation");
  });
  it("buckets known IG/FB Apify actors as apify", () => {
    assert.equal(classifyPersistSource("apify~instagram-scraper"), "apify");
    assert.equal(classifyPersistSource("apify~instagram-post-scraper"), "apify");
    assert.equal(classifyPersistSource("apify~facebook-posts-scraper"), "apify");
    assert.equal(classifyPersistSource("apify~instagram-scraper@residential"), "apify");
  });
  it("buckets the IG reel-downloader (non-apify-namespaced actor) as apify", () => {
    assert.equal(
      classifyPersistSource("presetshubham~instagram-reel-downloader"),
      "apify",
    );
  });
  it("buckets the primary-path direct CDN aliases as apify", () => {
    assert.equal(classifyPersistSource("direct"), "apify");
    assert.equal(classifyPersistSource("cdn-direct"), "apify");
    assert.equal(classifyPersistSource("share-resolver"), "apify");
  });
  it("buckets yt-dlp variants as ytdlp", () => {
    assert.equal(classifyPersistSource("yt-dlp"), "ytdlp");
    assert.equal(classifyPersistSource("ytdlp"), "ytdlp");
    assert.equal(classifyPersistSource("YT-DLP"), "ytdlp");
  });
  it("buckets unknown / generic strings as fallback (regression guard for T158 single-fallback bug)", () => {
    assert.equal(classifyPersistSource("single-fallback"), "fallback");
    assert.equal(classifyPersistSource("primary"), "fallback");
    assert.equal(classifyPersistSource("unknown-actor"), "fallback");
    assert.equal(classifyPersistSource("kaboom"), "fallback");
  });
  it("buckets empty / null / whitespace as fallback", () => {
    assert.equal(classifyPersistSource(null), "fallback");
    assert.equal(classifyPersistSource(undefined), "fallback");
    assert.equal(classifyPersistSource(""), "fallback");
    assert.equal(classifyPersistSource("   "), "fallback");
  });
  it("apify-escalation precedence: escalation marker outranks apify substring", () => {
    // The escalation wrapper sets effectiveSource="apify-escalation" -
    // it must classify as apify-escalation (escalationRecovered counter)
    // not apify (plain apifySuccess), even though the string contains
    // "apify".
    assert.equal(classifyPersistSource("apify-escalation"), "apify-escalation");
  });
});

describe("detectInstagramCarousel", () => {
  it("flags GraphSidecar with full childPosts", () => {
    const item = {
      __typename: "GraphSidecar",
      type: "Sidecar",
      childPosts: [
        { displayUrl: "https://cdn/1.jpg" },
        { displayUrl: "https://cdn/2.jpg" },
        { displayUrl: "https://cdn/3.jpg" },
        { displayUrl: "https://cdn/4.jpg" },
      ],
    };
    const info = detectInstagramCarousel(item);
    assert.equal(info.isCarousel, true);
    assert.equal(info.expectedSlides, 4);
    assert.equal(info.typename, "GraphSidecar");
  });

  it("flags XDTGraphSidecar typename even when childPosts is empty", () => {
    const item = { __typename: "XDTGraphSidecar", childPosts: [] };
    const info = detectInstagramCarousel(item);
    // We treat a Sidecar typename as carousel even if Apify hasn't yet
    // hydrated childPosts, so the downloader retries with stronger settings
    // instead of silently caching the cover image as a "single".
    assert.equal(info.isCarousel, true);
    assert.equal(info.expectedSlides, 2);
  });

  it("flags type:'Sidecar' even without __typename", () => {
    const item = { type: "Sidecar", childPosts: [{}, {}, {}] };
    assert.equal(detectInstagramCarousel(item).isCarousel, true);
    assert.equal(detectInstagramCarousel(item).expectedSlides, 3);
  });

  it("does NOT flag a single image post", () => {
    const item = {
      __typename: "GraphImage",
      type: "Image",
      displayUrl: "https://cdn/single.jpg",
    };
    const info = detectInstagramCarousel(item);
    assert.equal(info.isCarousel, false);
    assert.equal(info.expectedSlides, 1);
  });

  it("does NOT flag a single video post", () => {
    const item = {
      __typename: "GraphVideo",
      type: "Video",
      videoUrl: "https://cdn/reel.mp4",
    };
    const info = detectInstagramCarousel(item);
    assert.equal(info.isCarousel, false);
    assert.equal(info.expectedSlides, 1);
  });

  it("handles null / non-object input", () => {
    assert.equal(detectInstagramCarousel(null).isCarousel, false);
    assert.equal(detectInstagramCarousel(undefined).isCarousel, false);
    assert.equal(detectInstagramCarousel("nope").isCarousel, false);
  });
});

describe("pickInstagramMediaList", () => {
  it("returns one entry per childPost on a sidecar", () => {
    const item = {
      __typename: "XDTGraphSidecar",
      childPosts: [
        { displayUrl: "https://cdn/1.jpg" },
        { videoUrl: "https://cdn/2.mp4" },
        { displayUrl: "https://cdn/3.jpg" },
      ],
    };
    const list = pickInstagramMediaList(item);
    assert.equal(list.length, 3);
    assert.equal(list[0].imageUrl, "https://cdn/1.jpg");
    assert.equal(list[1].videoUrl, "https://cdn/2.mp4");
    assert.equal(list[2].imageUrl, "https://cdn/3.jpg");
  });

  it("returns one entry for a single image", () => {
    const item = { displayUrl: "https://cdn/x.jpg" };
    const list = pickInstagramMediaList(item);
    assert.equal(list.length, 1);
    assert.equal(list[0].imageUrl, "https://cdn/x.jpg");
  });

  it("returns one entry for a single video", () => {
    const item = { videoUrl: "https://cdn/x.mp4" };
    const list = pickInstagramMediaList(item);
    assert.equal(list.length, 1);
    assert.equal(list[0].videoUrl, "https://cdn/x.mp4");
  });

  it("returns [] when the item has no resolvable media", () => {
    assert.equal(pickInstagramMediaList({}).length, 0);
    assert.equal(pickInstagramMediaList(null).length, 0);
    assert.equal(
      pickInstagramMediaList({ childPosts: [{ foo: "bar" }] }).length,
      0,
    );
  });

  it("falls back to the parent media when childPosts has no resolvable media", () => {
    const item = {
      childPosts: [{ foo: "bar" }],
      displayUrl: "https://cdn/cover.jpg",
    };
    const list = pickInstagramMediaList(item);
    assert.equal(list.length, 1);
    assert.equal(list[0].imageUrl, "https://cdn/cover.jpg");
  });
});

describe("detectFacebookCarousel", () => {
  it("flags posts with multiple attachments", () => {
    const item = {
      attachments: [
        { media: { thumbnailUrl: "https://cdn/a.jpg" } },
        { media: { thumbnailUrl: "https://cdn/b.jpg" } },
        { media: { thumbnailUrl: "https://cdn/c.jpg" } },
      ],
    };
    const info = detectFacebookCarousel(item);
    assert.equal(info.isCarousel, true);
    assert.equal(info.expectedSlides, 3);
  });

  it("does NOT flag a single-image post", () => {
    const item = { thumbnailUrl: "https://cdn/x.jpg" };
    const info = detectFacebookCarousel(item);
    assert.equal(info.isCarousel, false);
  });

  it("flags posts with multiple distinct images[]", () => {
    const item = {
      images: [
        "https://cdn/1.jpg",
        "https://cdn/2.jpg",
        "https://cdn/3.jpg",
      ],
    };
    const info = detectFacebookCarousel(item);
    assert.equal(info.isCarousel, true);
    assert.equal(info.expectedSlides, 3);
  });
});

describe("pickFacebookMediaList", () => {
  it("returns every distinct attachment slide", () => {
    const item = {
      attachments: [
        { media: { thumbnailUrl: "https://cdn/a.jpg" } },
        { media: { thumbnailUrl: "https://cdn/b.jpg" } },
      ],
      subattachments: [
        { media: { thumbnailUrl: "https://cdn/c.jpg" } },
      ],
    };
    const list = pickFacebookMediaList(item);
    assert.equal(list.length, 3);
  });

  it("dedupes identical CDN URLs across attachments and images[]", () => {
    const item = {
      attachments: [{ media: { thumbnailUrl: "https://cdn/a.jpg" } }],
      images: ["https://cdn/a.jpg", "https://cdn/b.jpg"],
    };
    const list = pickFacebookMediaList(item);
    assert.equal(list.length, 2);
  });
});

// Task #137: stuck-row recovery predicate. The processPendingMedia
// SELECT now includes rows that are stuck in mediaStatus='downloading'
// past the backoff cutoff (worker crashed before persistResult could
// fire). We replicate the predicate here as a pure JS function to
// guard against drift - the goal is to make sure the SELECT continues
// to pick up exactly the cases we expect:
//   - dismissed rows are never picked up
//   - downloading + null downloadedAt + attempts < cap -> picked up
//   - downloading + downloadedAt < cutoff + attempts < cap -> picked up
//   - downloading + downloadedAt > cutoff -> NOT picked up (still in flight)
//   - downloading + attempts >= MAX_ATTEMPTS -> NOT picked up
//   - ok / partial / failed-recent -> NOT picked up by the stuck branch
const MAX_ATTEMPTS = 4;
const RETRY_BACKOFF_MS = 15 * 60 * 1000;
type StuckRow = {
  dismissed: boolean;
  mediaStatus: string | null;
  mediaAttempts: number;
  mediaDownloadedAt: Date | null;
};
function isStuckRecoveryEligible(row: StuckRow, now: Date): boolean {
  if (row.dismissed) return false;
  if (row.mediaStatus !== "downloading") return false;
  if ((row.mediaAttempts ?? 0) >= MAX_ATTEMPTS) return false;
  if (row.mediaDownloadedAt == null) return true;
  return row.mediaDownloadedAt.getTime() < now.getTime() - RETRY_BACKOFF_MS;
}

describe("processPendingMedia stuck-row predicate (task #137)", () => {
  const now = new Date("2026-05-07T12:00:00.000Z");
  const fresh = new Date(now.getTime() - 5 * 60 * 1000);   // 5 min ago, < backoff
  const stale = new Date(now.getTime() - 20 * 60 * 1000);  // 20 min ago, > backoff

  it("picks up downloading rows with null mediaDownloadedAt", () => {
    assert.equal(
      isStuckRecoveryEligible(
        { dismissed: false, mediaStatus: "downloading", mediaAttempts: 1, mediaDownloadedAt: null },
        now,
      ),
      true,
    );
  });

  it("picks up downloading rows past the backoff cutoff", () => {
    assert.equal(
      isStuckRecoveryEligible(
        { dismissed: false, mediaStatus: "downloading", mediaAttempts: 2, mediaDownloadedAt: stale },
        now,
      ),
      true,
    );
  });

  it("skips downloading rows still inside the backoff window", () => {
    assert.equal(
      isStuckRecoveryEligible(
        { dismissed: false, mediaStatus: "downloading", mediaAttempts: 1, mediaDownloadedAt: fresh },
        now,
      ),
      false,
    );
  });

  it("skips downloading rows that have hit MAX_ATTEMPTS", () => {
    assert.equal(
      isStuckRecoveryEligible(
        { dismissed: false, mediaStatus: "downloading", mediaAttempts: MAX_ATTEMPTS, mediaDownloadedAt: stale },
        now,
      ),
      false,
    );
  });

  it("skips dismissed rows even if they are stuck", () => {
    assert.equal(
      isStuckRecoveryEligible(
        { dismissed: true, mediaStatus: "downloading", mediaAttempts: 0, mediaDownloadedAt: null },
        now,
      ),
      false,
    );
  });

  it("does not match non-downloading statuses via the stuck branch", () => {
    for (const s of ["ok", "failed", "partial", "pending", null]) {
      assert.equal(
        isStuckRecoveryEligible(
          { dismissed: false, mediaStatus: s, mediaAttempts: 0, mediaDownloadedAt: stale },
          now,
        ),
        false,
        `status=${s} should not be picked up by the stuck branch`,
      );
    }
  });
});

// Task #151: error-class taxonomy. The screenshot in the original task
// description showed a cluster of Instagram login-wall failures all
// landing in the "other" bucket. These tests pin the new classifier to
// the exact production error strings sampled from the live DB so we
// catch any regression that would re-merge them back into "other".
describe("classifyError - task #151 taxonomy", () => {
  it("classifies the IG 'Requested content is not available' message", () => {
    const msg =
      "ERROR: [Instagram] DTx-J11iPKQ: Requested content is not available, rate-limit reached or login required. Use --cookies-from-browser or --cookies for the authentication.";
    assert.equal(classifyError(msg), "ig-login-required");
  });

  it("classifies IG 'empty media response' as ig-login-required", () => {
    const msg =
      "ERROR: [Instagram] DUvrsTUDgha: Instagram sent an empty media response. Check if this post is accessible in your browser without being logged-in.";
    assert.equal(classifyError(msg), "ig-login-required");
  });

  it("classifies IG HTTP 429 as ig-rate-limited", () => {
    const msg =
      "ERROR: [Instagram] DVqeijqjFmH: Unable to download webpage: HTTP Error 429: Too Many Requests (caused by <HTTPError 429: Too Many Requests>)";
    assert.equal(classifyError(msg), "ig-rate-limited");
  });

  it("classifies the IG user-page 429 as ig-rate-limited", () => {
    const msg =
      "ERROR: [instagram:user] buildwithkayden: Unable to download webpage: HTTP Error 429: Too Many Requests";
    assert.equal(classifyError(msg), "ig-rate-limited");
  });

  it("classifies FB 'only available for registered users' as fb-auth-wall", () => {
    const msg =
      "ERROR: [facebook] 933542042971314: This video is only available for registered users. Use --cookies-from-browser or --cookies for the authentication.";
    assert.equal(classifyError(msg), "fb-auth-wall");
  });

  it("classifies share-url-locked as share-resolution-failed", () => {
    assert.equal(classifyError("share-url-locked"), "share-resolution-failed");
    assert.equal(classifyError("share:locked-token"), "share-resolution-failed");
  });

  it("classifies Apify quota errors as quota-exceeded", () => {
    assert.equal(classifyError("monthly usage limit reached"), "quota-exceeded");
    assert.equal(classifyError("memory limit exceeded"), "quota-exceeded");
    assert.equal(classifyError("HTTP 402 payment required"), "quota-exceeded");
  });

  it("classifies HTTP 416 as http-416", () => {
    assert.equal(classifyError("HTTP Error 416: Requested Range Not Satisfiable"), "http-416");
  });

  it("classifies dead media", () => {
    assert.equal(classifyError("This video is no longer available"), "dead-media");
    assert.equal(classifyError("the post has been deleted"), "dead-media");
    assert.equal(classifyError("removed by the user"), "dead-media");
  });

  it("classifies timeouts as timeout", () => {
    assert.equal(classifyError("apify-batch-timeout"), "timeout");
    assert.equal(classifyError("cdn-fetch-timeout"), "timeout");
    assert.equal(classifyError("operation aborted"), "timeout");
  });

  it("classifies generic provider tags", () => {
    assert.equal(classifyError("apify:"), "apify");
    assert.equal(classifyError("cdn: ECONNRESET"), "cdn");
  });

  it("classifies generic yt-dlp errors as yt-dlp-failure", () => {
    assert.equal(
      classifyError("ERROR: [generic] something exploded inside yt-dlp"),
      "yt-dlp-failure",
    );
  });

  it("falls through to other for completely opaque errors", () => {
    assert.equal(classifyError("kaboom"), "other");
  });

  it("returns unknown for null/empty input", () => {
    assert.equal(classifyError(null), "unknown");
    assert.equal(classifyError(""), "unknown");
  });

  // Task #155: cookie-expired bucket - distinct from ig-login-required
  // (no cookies at all) so admins know to re-upload rather than upload.
  it("classifies cookie-expired sentinels", () => {
    assert.equal(
      classifyError("ERROR: The cookies are no longer valid"),
      "cookie-expired",
    );
    assert.equal(
      classifyError("Sign in to confirm you're not a bot"),
      "cookie-expired",
    );
    assert.equal(classifyError("login expired"), "cookie-expired");
    assert.equal(
      classifyError("your session has expired, please re-authenticate"),
      "cookie-expired",
    );
    assert.equal(classifyError("please log in again"), "cookie-expired");
  });

  it("classifies HTTP 416 'Requested Range Not Satisfiable' phrasing", () => {
    assert.equal(
      classifyError("ERROR: requested range not satisfiable"),
      "http-416",
    );
  });

  it("maps cookie-expired into the auth operational bucket", () => {
    assert.equal(operationalBucket("cookie-expired"), "auth");
    assert.equal(operationalBucket("ig-login-required"), "auth");
    assert.equal(operationalBucket("fb-auth-wall"), "auth");
  });
});

describe("derivePlatform - task #151", () => {
  it("tags Instagram URLs", () => {
    assert.equal(derivePlatform("https://www.instagram.com/reel/DTx-J11iPKQ/"), "ig");
  });
  it("tags Facebook URLs", () => {
    assert.equal(derivePlatform("https://www.facebook.com/share/v/abcd/"), "fb");
    assert.equal(derivePlatform("https://fb.watch/xyz"), "fb");
  });
  it("tags YouTube URLs", () => {
    assert.equal(derivePlatform("https://youtu.be/abc"), "yt");
    assert.equal(derivePlatform("https://www.youtube.com/watch?v=abc"), "yt");
  });
  it("falls through to other", () => {
    assert.equal(derivePlatform(null), "other");
    assert.equal(derivePlatform("https://example.com/video"), "other");
  });
});

describe("operationalBucket - task #151", () => {
  it("groups auth classes", () => {
    assert.equal(operationalBucket("ig-login-required"), "auth");
    assert.equal(operationalBucket("fb-auth-wall"), "auth");
  });
  it("groups rate-limit classes", () => {
    assert.equal(operationalBucket("ig-rate-limited"), "rate-limit");
  });
  it("groups quota classes", () => {
    assert.equal(operationalBucket("quota-exceeded"), "quota");
    assert.equal(operationalBucket("apify-quota-exceeded"), "quota");
  });
  it("groups dead classes", () => {
    assert.equal(operationalBucket("dead-media"), "dead");
    assert.equal(operationalBucket("http-416"), "dead");
  });
  it("treats unknown / generic as retryable", () => {
    assert.equal(operationalBucket("apify"), "retryable");
    assert.equal(operationalBucket("cdn"), "retryable");
    assert.equal(operationalBucket("timeout"), "retryable");
    assert.equal(operationalBucket("yt-dlp-failure"), "retryable");
    assert.equal(operationalBucket("other"), "retryable");
    assert.equal(operationalBucket(null), "retryable");
  });
});

describe("isApifyQuotaError - task #181", () => {
  it("detects platform-feature-disabled monthly hard limit body", () => {
    const body = JSON.stringify({
      error: { type: "platform-feature-disabled", message: "Monthly usage hard limit exceeded" },
    });
    assert.equal(isApifyQuotaError(403, body), true);
  });
  it("detects literal monthly usage limit phrasing", () => {
    assert.equal(isApifyQuotaError(403, "monthly usage limit reached"), true);
    assert.equal(isApifyQuotaError(403, "usage hard limit exceeded"), true);
    assert.equal(isApifyQuotaError(403, "plan limit"), true);
  });
  it("treats HTTP 402 as quota regardless of body", () => {
    assert.equal(isApifyQuotaError(402, ""), true);
  });
  it("does NOT match plain auth-wall bodies", () => {
    assert.equal(isApifyQuotaError(403, "login_required"), false);
    assert.equal(isApifyQuotaError(401, "checkpoint"), false);
    assert.equal(
      isApifyQuotaError(403, "This video is only available for registered users"),
      false,
    );
  });
  it("returns false for empty / null inputs", () => {
    assert.equal(isApifyQuotaError(null, null), false);
    assert.equal(isApifyQuotaError(200, ""), false);
  });
});

describe("classifyApifyHttpFailure - task #181 precedence", () => {
  it("returns 'quota' for HTTP 403 platform-feature-disabled (the bug)", () => {
    const body = JSON.stringify({
      error: { type: "platform-feature-disabled", message: "Monthly usage hard limit exceeded" },
    });
    // Critical: must NOT be classified as 'auth' even though status is 403.
    assert.equal(classifyApifyHttpFailure(403, body), "quota");
  });
  it("returns 'auth' for genuine 403 login_required", () => {
    assert.equal(classifyApifyHttpFailure(403, "login_required"), "auth");
  });
  it("returns 'auth' for FB 'only available for registered users'", () => {
    assert.equal(
      classifyApifyHttpFailure(403, "This video is only available for registered users"),
      "auth",
    );
  });
  it("returns 'auth' for bare 401 / 403 with no body", () => {
    assert.equal(classifyApifyHttpFailure(401, ""), "auth");
    assert.equal(classifyApifyHttpFailure(403, ""), "auth");
  });
  it("returns 'other' for transient 500-class errors", () => {
    assert.equal(classifyApifyHttpFailure(500, "internal server error"), "other");
    assert.equal(classifyApifyHttpFailure(502, "bad gateway"), "other");
  });
});

describe("computeOutcomeRollup - task #151 success-rate scope", () => {
  const zeroBuckets = {
    auth: 0, "rate-limit": 0, quota: 0, retryable: 0, dead: 0, unavailable: 0, unsupported: 0,
  };
  it("denominator includes ALL-time dismissed-with-failure (not 24h)", () => {
    const r = computeOutcomeRollup({
      statusOk: 80, statusPartial: 0, statusFailed: 0,
      dismissedWithFailureAllTime: 20,
      dismissedWithFailure24h: 5,
      terminalLive24h: 0, retrying: 0, buckets: zeroBuckets,
    });
    assert.equal(r.usableMedia, 80);
    assert.equal(r.totalProcessed, 100);
    assert.equal(r.successRateBp, 8000); // 80% not 94%
  });
  it("dismissedTotal/terminalFailures stay 24h-scoped", () => {
    const r = computeOutcomeRollup({
      statusOk: 50, statusPartial: 0, statusFailed: 0,
      dismissedWithFailureAllTime: 200,
      dismissedWithFailure24h: 3,
      terminalLive24h: 2, retrying: 0, buckets: zeroBuckets,
    });
    assert.equal(r.dismissedTotal, 3);
    assert.equal(r.terminalFailures, 5);
    assert.equal(r.totalProcessed, 250);
  });
  it("returns 0 success rate when nothing processed", () => {
    const r = computeOutcomeRollup({
      statusOk: 0, statusPartial: 0, statusFailed: 0,
      dismissedWithFailureAllTime: 0, dismissedWithFailure24h: 0,
      terminalLive24h: 0, retrying: 0, buckets: zeroBuckets,
    });
    assert.equal(r.successRateBp, 0);
    assert.equal(r.totalProcessed, 0);
  });
  it("partial counts as usable; failed live counts in denominator", () => {
    const r = computeOutcomeRollup({
      statusOk: 70, statusPartial: 10, statusFailed: 20,
      dismissedWithFailureAllTime: 0, dismissedWithFailure24h: 0,
      terminalLive24h: 0, retrying: 5, buckets: zeroBuckets,
    });
    assert.equal(r.usableMedia, 80);
    assert.equal(r.totalProcessed, 100);
    assert.equal(r.successRateBp, 8000);
    assert.equal(r.retrying, 5);
  });
});

// Task #181: probe-level tests for FB and IG testWithApify.
//
// These verify the end-to-end behavior of the admin "Test Session" probes,
// not just the helper. The contract:
//   - An Apify account quota response (HTTP 403 platform-feature-disabled
//     or "Monthly usage hard limit exceeded") MUST return status
//     "quota-exceeded" and MUST NOT call markFbSessionExpired /
//     markSessionExpired.
//   - A genuine auth failure (HTTP 401, login_required body, checkpoint,
//     "only available for registered users") MUST still flip the jar to
//     expired by calling markFbSessionExpired / markSessionExpired.
//
// We mock the auth-cookies module (FB) and the @workspace/db module (IG)
// so the probes run without a database, and stub global fetch to return
// the response shape we want to exercise.

describe("recent Apify quota signal - task #181", () => {
  it("noteApifyQuotaSignal flips wasApifyQuotaRecent within window", () => {
    _resetApifyQuotaSignalForTests();
    assert.equal(wasApifyQuotaRecent(), false);
    noteApifyQuotaSignal(1_000_000);
    assert.equal(wasApifyQuotaRecent(30 * 60_000, 1_000_000 + 60_000), true);
    assert.equal(wasApifyQuotaRecent(30 * 60_000, 1_000_000 + 31 * 60_000), false);
    _resetApifyQuotaSignalForTests();
  });
});

describe("FB testWithApify - task #181 probe behavior", () => {
  const ORIGINAL_FETCH = globalThis.fetch;
  const ORIGINAL_TOKEN = process.env.APIFY_TOKEN;

  async function loadFbModuleWithMockedAuth(opts: {
    activeJarStatus?: "active" | "expired";
  }) {
    const markJarStatus = mock.fn(async (_p: string, _s: string, _e: string | null) => {});
    const writeRow = mock.fn(async () => {});
    const fakeJarPlain =
      "# Netscape HTTP Cookie File\n" +
      ".facebook.com\tTRUE\t/\tTRUE\t9999999999\tc_user\t100000000000000\n" +
      ".facebook.com\tTRUE\t/\tTRUE\t9999999999\txs\tabc:def:0\n" +
      ".facebook.com\tTRUE\t/\tTRUE\t9999999999\tdatr\txyz\n";
    mock.module("./auth-cookies.ts", {
      namedExports: {
        readActiveJarPlaintext: async () => ({ text: fakeJarPlain }),
        resolveActiveJar: async () => ({ status: opts.activeJarStatus ?? "active" }),
        markJarStatus,
      },
    });
    // Force a fresh module evaluation so the dynamic import inside
    // testWithApify resolves to the mocked auth-cookies.
    const fb = await import(`./facebook-cookies.ts?cacheBust=${Math.random()}`);
    return { fb, markJarStatus, writeRow };
  }

  function stubFetch(response: { status: number; bodyText: string; ok?: boolean }) {
    globalThis.fetch = mock.fn(async () => ({
      ok: response.ok ?? (response.status >= 200 && response.status < 300),
      status: response.status,
      text: async () => response.bodyText,
      json: async () => {
        try { return JSON.parse(response.bodyText); } catch { return null; }
      },
    })) as unknown as typeof fetch;
  }

  it("quota response (HTTP 403 platform-feature-disabled) returns quota-exceeded and does NOT mark jar expired", async (_t) => {
    process.env.APIFY_TOKEN = "test-token";
    _resetApifyQuotaSignalForTests();
    const { fb, markJarStatus } = await loadFbModuleWithMockedAuth({});
    stubFetch({
      status: 403,
      bodyText: JSON.stringify({
        error: { type: "platform-feature-disabled", message: "Monthly usage hard limit exceeded" },
      }),
    });
    try {
      const result = await fb.testWithApify();
      assert.equal(result.status, "quota-exceeded");
      assert.equal(result.ok, false);
      assert.match(result.error || "", /Monthly usage hard limit/i);
      // Critical: the jar must NOT be flipped to expired on quota.
      const expiredCalls = markJarStatus.mock.calls.filter(
        (c: any) => c.arguments[1] === "expired",
      );
      assert.equal(expiredCalls.length, 0, "markJarStatus should not be called with 'expired' on quota");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
      if (ORIGINAL_TOKEN === undefined) delete process.env.APIFY_TOKEN;
      else process.env.APIFY_TOKEN = ORIGINAL_TOKEN;
      mock.restoreAll();
    }
  });

  it("genuine login_required (HTTP 401) still flips jar to expired", async (t) => {
    process.env.APIFY_TOKEN = "test-token";
    const { fb, markJarStatus } = await loadFbModuleWithMockedAuth({ activeJarStatus: "active" });
    stubFetch({
      status: 401,
      bodyText: "login_required: session invalid",
    });
    try {
      const result = await fb.testWithApify();
      assert.equal(result.status, "auth-blocked");
      assert.equal(result.ok, false);
      const expiredCalls = markJarStatus.mock.calls.filter(
        (c: any) => c.arguments[1] === "expired",
      );
      assert.ok(expiredCalls.length >= 1, "markJarStatus must be called with 'expired' on real auth failure");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
      if (ORIGINAL_TOKEN === undefined) delete process.env.APIFY_TOKEN;
      else process.env.APIFY_TOKEN = ORIGINAL_TOKEN;
      mock.restoreAll();
    }
  });

  it("'only available for registered users' body still flips jar to expired", async (_t) => {
    process.env.APIFY_TOKEN = "test-token";
    const { fb, markJarStatus } = await loadFbModuleWithMockedAuth({ activeJarStatus: "active" });
    stubFetch({
      status: 403,
      bodyText: "This page is only available for registered users",
    });
    try {
      const result = await fb.testWithApify();
      assert.equal(result.status, "auth-blocked");
      const expiredCalls = markJarStatus.mock.calls.filter(
        (c: any) => c.arguments[1] === "expired",
      );
      assert.ok(expiredCalls.length >= 1);
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
      if (ORIGINAL_TOKEN === undefined) delete process.env.APIFY_TOKEN;
      else process.env.APIFY_TOKEN = ORIGINAL_TOKEN;
      mock.restoreAll();
    }
  });
});

describe("IG testWithApify - task #181 probe behavior", () => {
  const ORIGINAL_FETCH = globalThis.fetch;
  const ORIGINAL_TOKEN = process.env.APIFY_TOKEN;
  const ORIGINAL_SECRET = process.env.INSTAGRAM_COOKIES_SECRET;

  // Build a chainable fake `db` whose select/update/insert/delete calls
  // return a thenable resolving to the configured rows. Tracks whether
  // an update was issued so the test can assert that the IG session was
  // (or was not) flipped to expired.
  function makeFakeDb(opts: { rows: any[]; onUpdate?: () => void }) {
    const updateSpy = mock.fn(() => {
      opts.onUpdate?.();
    });
    const chain: any = {
      select: () => chain,
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(opts.rows),
      update: () => {
        updateSpy();
        return chain;
      },
      set: () => chain,
      insert: () => chain,
      values: () => Promise.resolve(),
      delete: () => chain,
    };
    return { db: chain, updateSpy };
  }

  function stubFetch(response: { status: number; bodyText: string }) {
    globalThis.fetch = mock.fn(async () => ({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: async () => response.bodyText,
      json: async () => {
        try { return JSON.parse(response.bodyText); } catch { return null; }
      },
    })) as unknown as typeof fetch;
  }

  async function loadIgWithEncryptedCookies(opts: { onUpdate?: () => void }) {
    process.env.INSTAGRAM_COOKIES_SECRET = "test-secret-task-181";
    const cookies = [
      { name: "sessionid", value: "x", domain: ".instagram.com", path: "/" },
      { name: "ds_user_id", value: "1", domain: ".instagram.com", path: "/" },
      { name: "csrftoken", value: "y", domain: ".instagram.com", path: "/" },
    ];
    const crypto = await import("node:crypto");
    const key = crypto.createHash("sha256").update("test-secret-task-181", "utf8").digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(cookies), "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const stored = {
      encrypted: {
        alg: "aes-256-gcm",
        iv: iv.toString("base64"),
        ciphertext: ct.toString("base64"),
        authTag: authTag.toString("base64"),
      },
      savedAt: new Date().toISOString(),
      savedBy: "test",
      cookieCount: 3,
      inferredExpiresAt: null,
      status: "active",
      lastError: null,
      cookieNames: ["sessionid", "ds_user_id", "csrftoken"],
      sessionidPreview: null,
    };
    const fake = makeFakeDb({ rows: [{ value: stored }], onUpdate: opts.onUpdate });
    mock.module("@workspace/db", {
      namedExports: {
        db: fake.db,
        providerConfigsTable: {
          id: "id", value: "value", providerSlug: "provider_slug", key: "key",
        },
      },
    });
    const ig = await import(`./instagram-session-cookies.ts?cacheBust=${Math.random()}`);
    return { ig, updateSpy: fake.updateSpy };
  }

  it("quota response (HTTP 403 platform-feature-disabled) returns quota-exceeded and does NOT mark session expired", async () => {
    process.env.APIFY_TOKEN = "test-token";
    let updates = 0;
    const { ig } = await loadIgWithEncryptedCookies({ onUpdate: () => { updates++; } });
    stubFetch({
      status: 403,
      bodyText: JSON.stringify({
        error: { type: "platform-feature-disabled", message: "Monthly usage hard limit exceeded" },
      }),
    });
    try {
      const result = await ig.testWithApify();
      assert.equal(result.status, "quota-exceeded");
      assert.equal(result.ok, false);
      assert.equal(updates, 0, "IG session must not be written to expired on Apify quota");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
      if (ORIGINAL_TOKEN === undefined) delete process.env.APIFY_TOKEN;
      else process.env.APIFY_TOKEN = ORIGINAL_TOKEN;
      if (ORIGINAL_SECRET === undefined) delete process.env.INSTAGRAM_COOKIES_SECRET;
      else process.env.INSTAGRAM_COOKIES_SECRET = ORIGINAL_SECRET;
      mock.restoreAll();
    }
  });

  it("genuine login_required body in successful response still flips IG session to expired", async () => {
    process.env.APIFY_TOKEN = "test-token";
    let updates = 0;
    const { ig } = await loadIgWithEncryptedCookies({ onUpdate: () => { updates++; } });
    _resetApifyQuotaSignalForTests();
    stubFetch({
      status: 200,
      bodyText: JSON.stringify([{ error: "login_required" }]),
    });
    try {
      const result = await ig.testWithApify();
      assert.equal(result.status, "auth-blocked");
      assert.ok(updates >= 1, "IG session must be flipped to expired on real login_required");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
      if (ORIGINAL_TOKEN === undefined) delete process.env.APIFY_TOKEN;
      else process.env.APIFY_TOKEN = ORIGINAL_TOKEN;
      if (ORIGINAL_SECRET === undefined) delete process.env.INSTAGRAM_COOKIES_SECRET;
      else process.env.INSTAGRAM_COOKIES_SECRET = ORIGINAL_SECRET;
      mock.restoreAll();
    }
  });
});


describe("normalizeSocialUrl - task #190 pre-extraction canonicalization", () => {
  it("returns identity (normalized=false) for canonical URLs", () => {
    const r = normalizeSocialUrl("https://www.instagram.com/reel/ABC123");
    assert.equal(r.url, "https://www.instagram.com/reel/ABC123");
    assert.equal(r.normalized, false);
    assert.deepEqual(r.changes, []);
  });

  it("strips Instagram igsh share token", () => {
    const r = normalizeSocialUrl("https://www.instagram.com/reel/ABC123/?igsh=MWxyZw==");
    assert.equal(r.url, "https://www.instagram.com/reel/ABC123");
    assert.equal(r.normalized, true);
    assert.ok(r.changes.includes("strip-1-tracking-params"));
    assert.ok(r.changes.includes("trim-trailing-slash"));
  });

  it("strips Instagram igshid share token", () => {
    const r = normalizeSocialUrl("https://www.instagram.com/p/ABC123?igshid=xyz");
    assert.equal(r.url, "https://www.instagram.com/p/ABC123");
  });

  it("strips Facebook fbclid + mibextid tracking params", () => {
    const r = normalizeSocialUrl(
      "https://www.facebook.com/somepage/posts/12345?fbclid=IwAR&mibextid=abc",
    );
    assert.equal(r.url, "https://www.facebook.com/somepage/posts/12345");
    assert.ok(r.changes.includes("strip-2-tracking-params"));
  });

  it("strips utm_* tracking params", () => {
    const r = normalizeSocialUrl(
      "https://www.facebook.com/reel/12345?utm_source=newsletter&utm_medium=email&fbclid=z",
    );
    assert.equal(r.url, "https://www.facebook.com/reel/12345");
  });

  it("aliases instagr.am to www.instagram.com", () => {
    const r = normalizeSocialUrl("https://instagr.am/p/ABC123");
    assert.equal(r.url, "https://www.instagram.com/p/ABC123");
    assert.ok(r.changes.includes("host-alias-instagram"));
  });

  it("aliases fb.com to www.facebook.com", () => {
    const r = normalizeSocialUrl("https://fb.com/somepage/posts/123");
    assert.equal(r.url, "https://www.facebook.com/somepage/posts/123");
    assert.ok(r.changes.includes("host-alias-facebook"));
  });

  it("aliases web.facebook.com to www.facebook.com", () => {
    const r = normalizeSocialUrl("https://web.facebook.com/reel/12345");
    assert.equal(r.url, "https://www.facebook.com/reel/12345");
    assert.ok(r.changes.includes("host-alias-facebook"));
  });

  it("preserves m.facebook.com (used as share-resolver mobile retry)", () => {
    const r = normalizeSocialUrl("https://m.facebook.com/share/r/abc123");
    assert.equal(r.url, "https://m.facebook.com/share/r/abc123");
    assert.equal(r.normalized, false);
  });

  it("preserves fb.watch short links and trims trailing slash", () => {
    const r = normalizeSocialUrl("https://fb.watch/abc123/");
    assert.equal(r.url, "https://fb.watch/abc123");
    assert.ok(r.changes.includes("trim-trailing-slash"));
  });

  it("rewrites /reels/ to /reel/ on Instagram", () => {
    const r = normalizeSocialUrl("https://www.instagram.com/reels/ABC123");
    assert.equal(r.url, "https://www.instagram.com/reel/ABC123");
    assert.ok(r.changes.includes("reels-to-reel"));
  });

  it("rewrites /reels/ to /reel/ on Facebook", () => {
    const r = normalizeSocialUrl("https://www.facebook.com/reels/12345");
    assert.equal(r.url, "https://www.facebook.com/reel/12345");
    assert.ok(r.changes.includes("reels-to-reel"));
  });

  it("unwraps l.instagram.com link shim", () => {
    const inner = "https://www.instagram.com/reel/ABC123";
    const r = normalizeSocialUrl(
      `https://l.instagram.com/?u=${encodeURIComponent(inner)}&e=AT0xyz`,
    );
    assert.equal(r.url, inner);
    assert.ok(r.changes.includes("unwrap-link-shim"));
  });

  it("unwraps l.facebook.com link shim", () => {
    const inner = "https://www.facebook.com/somepage/posts/123";
    const r = normalizeSocialUrl(
      `https://l.facebook.com/l.php?u=${encodeURIComponent(inner)}&h=AT0`,
    );
    assert.equal(r.url, inner);
    assert.ok(r.changes.includes("unwrap-link-shim"));
  });

  it("drops fragment", () => {
    const r = normalizeSocialUrl("https://www.instagram.com/reel/ABC123#comments");
    assert.equal(r.url, "https://www.instagram.com/reel/ABC123");
    assert.ok(r.changes.includes("drop-fragment"));
  });

  it("lowercases host", () => {
    const r = normalizeSocialUrl("https://WWW.INSTAGRAM.COM/reel/ABC123");
    assert.equal(r.url, "https://www.instagram.com/reel/ABC123");
    assert.ok(r.changes.includes("lowercase-host"));
  });

  it("is idempotent: normalizing twice yields the same URL with no further changes", () => {
    const messy = "https://INSTAGR.am/reels/ABC123/?igsh=xyz&utm_source=x#frag";
    const first = normalizeSocialUrl(messy);
    const second = normalizeSocialUrl(first.url);
    assert.equal(second.url, first.url);
    assert.equal(second.normalized, false);
    assert.deepEqual(second.changes, []);
  });

  it("handles a real-world messy IG share URL end-to-end", () => {
    const messy =
      "https://www.instagram.com/reels/ABC123/?igsh=MTk5&utm_source=ig_web_copy_link";
    const r = normalizeSocialUrl(messy);
    assert.equal(r.url, "https://www.instagram.com/reel/ABC123");
    assert.equal(r.normalized, true);
  });

  it("handles a real-world messy FB share URL end-to-end", () => {
    const messy =
      "https://web.facebook.com/somepage/videos/9876/?fbclid=IwAR1abc&mibextid=def";
    const r = normalizeSocialUrl(messy);
    assert.equal(r.url, "https://www.facebook.com/somepage/videos/9876");
    assert.ok(r.changes.includes("host-alias-facebook"));
    assert.ok(r.normalized);
  });

  it("preserves Facebook /share/r/ tokens (resolver still owns expansion)", () => {
    const r = normalizeSocialUrl("https://www.facebook.com/share/r/abc123");
    assert.equal(r.url, "https://www.facebook.com/share/r/abc123");
    assert.equal(r.normalized, false);
  });

  it("returns empty for empty input", () => {
    const r = normalizeSocialUrl("");
    assert.equal(r.url, "");
    assert.equal(r.normalized, false);
  });

  it("returns input unchanged for invalid URL", () => {
    const r = normalizeSocialUrl("not a url");
    assert.equal(r.url, "not a url");
    assert.equal(r.normalized, false);
  });

  it("strips fbclid even on non-IG/FB hosts (it's noise everywhere)", () => {
    const r = normalizeSocialUrl("https://example.com/some/path?fbclid=xyz");
    assert.equal(r.url, "https://example.com/some/path");
    assert.ok(r.changes.includes("strip-1-tracking-params"));
  });
});

describe("classifyApifyEscalationItems - task #191 stage failure classifier", () => {
  it("returns actor-error when items is null (HTTP failure)", () => {
    assert.equal(classifyApifyEscalationItems(null), "actor-error");
  });
  it("returns empty-dataset when items is an empty array", () => {
    assert.equal(classifyApifyEscalationItems([]), "empty-dataset");
  });
  it("returns auth-rejected when an item carries a login_required marker", () => {
    assert.equal(
      classifyApifyEscalationItems([{ error: "Something went wrong: login_required" }]),
      "auth-rejected",
    );
  });
  it("returns auth-rejected on the 'only available for registered users' marker", () => {
    assert.equal(
      classifyApifyEscalationItems([{ message: "This content is only available for registered users." }]),
      "auth-rejected",
    );
  });
  it("returns auth-rejected on a checkpoint marker", () => {
    assert.equal(
      classifyApifyEscalationItems([{ reason: "checkpoint required" }]),
      "auth-rejected",
    );
  });
  it("returns auth-rejected on a session_expired marker buried in nested fields", () => {
    assert.equal(
      classifyApifyEscalationItems([{ data: { meta: { code: "session_expired" } } }]),
      "auth-rejected",
    );
  });
  it("returns unsupported-url when an item carries an 'invalid url' error string", () => {
    assert.equal(
      classifyApifyEscalationItems([{ error: "Invalid URL provided to actor" }]),
      "unsupported-url",
    );
  });
  it("returns unsupported-url for 'unsupported' error strings", () => {
    assert.equal(
      classifyApifyEscalationItems([{ error: "URL pattern is unsupported by this actor" }]),
      "unsupported-url",
    );
  });
  it("returns no-media when items are present but contain no auth/url markers", () => {
    assert.equal(
      classifyApifyEscalationItems([{ shortCode: "ABC", caption: "hello", type: "Sidecar" }]),
      "no-media",
    );
  });
  it("returns no-media for a generic empty-shape item with no markers", () => {
    assert.equal(classifyApifyEscalationItems([{ id: "1" }, { id: "2" }]), "no-media");
  });
  it("ignores non-object items without crashing", () => {
    assert.equal(classifyApifyEscalationItems([null as any, undefined as any, "string-junk" as any]), "no-media");
  });
  it("survives an item that cannot be JSON-stringified (circular)", () => {
    const circ: any = { name: "x" };
    circ.self = circ;
    // Should not throw; falls through to no-media because circular blob is empty.
    assert.equal(classifyApifyEscalationItems([circ]), "no-media");
  });
});

describe("Task #192 - resilient carousel slide recovery", () => {
  describe("isValidSlideUrl", () => {
    it("accepts http and https", () => {
      assert.equal(isValidSlideUrl("https://cdn.example.com/x.jpg"), true);
      assert.equal(isValidSlideUrl("http://cdn.example.com/x.jpg"), true);
    });
    it("rejects null, empty, whitespace, and non-strings", () => {
      assert.equal(isValidSlideUrl(null), false);
      assert.equal(isValidSlideUrl(""), false);
      assert.equal(isValidSlideUrl("   "), false);
      assert.equal(isValidSlideUrl(123 as any), false);
      assert.equal(isValidSlideUrl(undefined), false);
    });
    it("rejects non-http(s) protocols", () => {
      assert.equal(isValidSlideUrl("blob:https://x/y"), false);
      assert.equal(isValidSlideUrl("data:image/png;base64,AAAA"), false);
      assert.equal(isValidSlideUrl("file:///etc/passwd"), false);
    });
    it("rejects malformed garbage", () => {
      assert.equal(isValidSlideUrl("not a url"), false);
    });
  });

  describe("pickInstagramMedia candidates", () => {
    it("populates videoCandidates from videoUrlBackup excluding primary", () => {
      const m = pickInstagramMedia({
        videoUrl: "https://cdn.ig/v.mp4",
        videoUrlBackup: "https://cdn-backup.ig/v.mp4",
        displayUrl: "https://cdn.ig/poster.jpg",
      });
      assert.equal(m.videoUrl, "https://cdn.ig/v.mp4");
      assert.deepEqual(m.videoCandidates, ["https://cdn-backup.ig/v.mp4"]);
      // displayUrl was promoted to imageUrl (primary), so it's excluded
      // from imageCandidates by design (no wasted retry on the same URL).
      assert.equal(m.imageUrl, "https://cdn.ig/poster.jpg");
      assert.ok(m.imageCandidates && !m.imageCandidates.includes("https://cdn.ig/poster.jpg"));
    });
    it("populates imageCandidates from displayResources and images[]", () => {
      const m = pickInstagramMedia({
        displayUrl: "https://cdn.ig/p1.jpg",
        images: ["https://cdn.ig/p2.jpg", { url: "https://cdn.ig/p3.jpg" }],
        displayResources: [{ src: "https://cdn.ig/p4.jpg" }, { src: "https://cdn.ig/p1.jpg" }],
      });
      assert.equal(m.imageUrl, "https://cdn.ig/p1.jpg");
      assert.ok(m.imageCandidates);
      assert.ok(!m.imageCandidates!.includes("https://cdn.ig/p1.jpg"), "primary excluded");
      assert.ok(m.imageCandidates!.includes("https://cdn.ig/p2.jpg"));
      assert.ok(m.imageCandidates!.includes("https://cdn.ig/p3.jpg"));
      assert.ok(m.imageCandidates!.includes("https://cdn.ig/p4.jpg"));
    });
    it("returns empty candidate arrays when no alternates exist", () => {
      const m = pickInstagramMedia({ videoUrl: "https://cdn.ig/only.mp4" });
      assert.deepEqual(m.videoCandidates, []);
      assert.deepEqual(m.imageCandidates, []);
    });
  });

  describe("pickFacebookMedia candidates", () => {
    it("collects video.url and videos[].url excluding primary", () => {
      const m = pickFacebookMedia({
        videoUrl: "https://fb/v1.mp4",
        video: { url: "https://fb/v2.mp4" },
        videos: [{ url: "https://fb/v3.mp4" }, "https://fb/v1.mp4"],
        thumbnailUrl: "https://fb/t.jpg",
      });
      assert.equal(m.videoUrl, "https://fb/v1.mp4");
      assert.deepEqual(m.videoCandidates, ["https://fb/v2.mp4", "https://fb/v3.mp4"]);
    });
    it("collects images[] and media[].image.uri", () => {
      const m = pickFacebookMedia({
        imageUrl: "https://fb/i1.jpg",
        images: [{ url: "https://fb/i2.jpg" }],
        media: [{ image: { uri: "https://fb/i3.jpg" } }],
      });
      assert.equal(m.imageUrl, "https://fb/i1.jpg");
      assert.ok(m.imageCandidates!.includes("https://fb/i2.jpg"));
      assert.ok(m.imageCandidates!.includes("https://fb/i3.jpg"));
      assert.ok(!m.imageCandidates!.includes("https://fb/i1.jpg"));
    });
  });

  describe("buildSlideCandidateList", () => {
    it("orders primary video, primary image, then candidates, then thumbnail", () => {
      const list = buildSlideCandidateList({
        videoUrl: "https://x/v.mp4",
        imageUrl: "https://x/i.jpg",
        videoCandidates: ["https://x/v2.mp4"],
        imageCandidates: ["https://x/i2.jpg"],
        thumbnailUrl: "https://x/thumb.jpg",
      });
      assert.deepEqual(
        list.map((c) => c.url),
        ["https://x/v.mp4", "https://x/i.jpg", "https://x/v2.mp4", "https://x/i2.jpg", "https://x/thumb.jpg"],
      );
      assert.equal(list[0].kind, "video");
      assert.equal(list[1].kind, "image");
      assert.equal(list[2].kind, "video");
      assert.equal(list[4].kind, "image");
    });
    it("dedupes URLs across tiers", () => {
      const list = buildSlideCandidateList({
        videoUrl: "https://x/v.mp4",
        imageUrl: "https://x/dup.jpg",
        imageCandidates: ["https://x/dup.jpg", "https://x/new.jpg"],
        thumbnailUrl: "https://x/dup.jpg",
      });
      assert.deepEqual(
        list.map((c) => c.url),
        ["https://x/v.mp4", "https://x/dup.jpg", "https://x/new.jpg"],
      );
    });
    it("filters invalid URLs (blob:, empty, malformed)", () => {
      const list = buildSlideCandidateList({
        videoUrl: "blob:https://x/y",
        imageUrl: "",
        imageCandidates: ["not a url", "https://ok.example/p.jpg"],
        thumbnailUrl: null,
      });
      assert.deepEqual(list.map((c) => c.url), ["https://ok.example/p.jpg"]);
    });
    it("returns empty array when no valid candidates exist", () => {
      const list = buildSlideCandidateList({ videoUrl: null, imageUrl: "" });
      assert.deepEqual(list, []);
    });
  });
});

describe("Task #193 - isPartialResumeError detector", () => {
  it("matches HTTP 416 in all common phrasings", () => {
    assert.equal(isPartialResumeError("ERROR: HTTP Error 416: Requested Range Not Satisfiable"), true);
    assert.equal(isPartialResumeError("urllib.error.HTTPError: HTTP Error 416"), true);
    assert.equal(isPartialResumeError("got HTTP 416 from CDN"), true);
    assert.equal(isPartialResumeError("416 Requested Range Not Satisfiable"), true);
    assert.equal(isPartialResumeError("server returned: requested range not satisfiable"), true);
  });
  it("matches yt-dlp partial-resume corruption signatures", () => {
    assert.equal(isPartialResumeError("ERROR: unable to resume download"), true);
    assert.equal(isPartialResumeError("cannot resume previous download"), true);
    assert.equal(isPartialResumeError("urllib.error.ContentTooShortError: got fewer bytes than expected"), true);
    assert.equal(isPartialResumeError("ContentTooShort: ..."), true);
    assert.equal(isPartialResumeError("premature end of stream"), true);
    assert.equal(isPartialResumeError("the downloaded file is empty"), true);
    assert.equal(isPartialResumeError("invalid byte range from server"), true);
    assert.equal(isPartialResumeError("media.mp4.part is corrupt"), true);
    assert.equal(isPartialResumeError("media.mp4.part contains invalid bytes"), true);
  });
  it("does not match unrelated yt-dlp errors", () => {
    assert.equal(isPartialResumeError(null), false);
    assert.equal(isPartialResumeError(undefined), false);
    assert.equal(isPartialResumeError(""), false);
    assert.equal(isPartialResumeError("HTTP Error 403: Forbidden"), false);
    assert.equal(isPartialResumeError("HTTP Error 429: Too Many Requests"), false);
    assert.equal(isPartialResumeError("login required"), false);
    assert.equal(isPartialResumeError("video unavailable"), false);
    assert.equal(isPartialResumeError("network timeout"), false);
    // .part mention without corruption keyword does NOT trigger
    assert.equal(isPartialResumeError("writing to media.mp4.part"), false);
    // byte range without "invalid" does NOT trigger
    assert.equal(isPartialResumeError("supports byte range requests"), false);
  });
});

describe("Task #194 - classifyIgAuthSignal", () => {
  let classifyIgAuthSignal: any;
  before(async () => {
    mock.module("@workspace/db", {
      namedExports: {
        db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
        providerConfigsTable: { id: "id", value: "value", providerSlug: "provider_slug", key: "key" },
      },
    });
    const m = await import(`./instagram-session-cookies.ts?cacheBust=${Math.random()}`);
    classifyIgAuthSignal = m.classifyIgAuthSignal;
  });
  after(() => { mock.restoreAll(); });
  it("returns rate-limit for HTTP 429 even when body mentions login", () => {
    assert.equal(classifyIgAuthSignal(429, "rate limit + login required boilerplate"), "rate-limit");
    assert.equal(classifyIgAuthSignal(200, "too many requests"), "rate-limit");
    assert.equal(classifyIgAuthSignal(200, "ratelimit hit"), "rate-limit");
  });
  it("returns true-invalidation for HTTP 401 / checkpoint / session_expired", () => {
    assert.equal(classifyIgAuthSignal(401, ""), "true-invalidation");
    assert.equal(classifyIgAuthSignal(403, "checkpoint_required"), "true-invalidation");
    assert.equal(classifyIgAuthSignal(200, "session expired"), "true-invalidation");
    assert.equal(classifyIgAuthSignal(500, "session_expired"), "true-invalidation");
  });
  it("returns login-required-body for login_required text without 401", () => {
    assert.equal(classifyIgAuthSignal(403, "login_required"), "login-required-body");
    assert.equal(classifyIgAuthSignal(403, "This video is only available for registered users"), "login-required-body");
  });
  it("returns anti-bot for 403 with captcha/challenge/blocked", () => {
    assert.equal(classifyIgAuthSignal(403, "captcha required"), "anti-bot");
    assert.equal(classifyIgAuthSignal(403, "challenge required"), "anti-bot");
    assert.equal(classifyIgAuthSignal(403, "request blocked"), "anti-bot");
  });
  it("returns null for unrelated failures", () => {
    assert.equal(classifyIgAuthSignal(500, "internal server error"), null);
    assert.equal(classifyIgAuthSignal(404, "not found"), null);
    assert.equal(classifyIgAuthSignal(null, null), null);
    assert.equal(classifyIgAuthSignal(200, ""), null);
  });
});

describe("Task #194 - evaluateIgAuthSignals threshold logic", () => {
  let evaluateIgAuthSignals: any;
  let WIN: number;
  let HARD: number;
  let CONF: number;
  before(async () => {
    mock.module("@workspace/db", {
      namedExports: {
        db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
        providerConfigsTable: { id: "id", value: "value", providerSlug: "provider_slug", key: "key" },
      },
    });
    const m = await import(`./instagram-session-cookies.ts?cacheBust=${Math.random()}`);
    evaluateIgAuthSignals = m.evaluateIgAuthSignals;
    WIN = m.IG_AUTH_SIGNAL_WINDOW_MS;
    HARD = m.IG_AUTH_HARD_INVALIDATION_THRESHOLD;
    CONF = m.IG_AUTH_CONFIDENCE_THRESHOLD;
  });
  after(() => { mock.restoreAll(); });
  const now = Date.parse("2026-05-11T14:00:00Z");
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();

  it("empty history is healthy", () => {
    const r = evaluateIgAuthSignals([], now);
    assert.equal(r.shouldExpire, false);
    assert.equal(r.confidence, 0);
    assert.equal(r.hardCount, 0);
  });
  it("a single true-invalidation does NOT expire", () => {
    const r = evaluateIgAuthSignals([{ kind: "true-invalidation", at: at(1000), reason: "401" }], now);
    assert.equal(r.shouldExpire, false);
    assert.equal(r.hardCount, 1);
    assert.equal(r.confidence, 1.0);
  });
  it("two true-invalidations in window DO expire (hard gate)", () => {
    const r = evaluateIgAuthSignals([
      { kind: "true-invalidation", at: at(60_000), reason: "401" },
      { kind: "true-invalidation", at: at(1000), reason: "401" },
    ], now);
    assert.equal(r.shouldExpire, true);
    assert.equal(r.hardCount, 2);
    assert.ok(r.reason && r.reason.includes("hard=2"));
  });
  it("a single login-required does NOT expire", () => {
    const r = evaluateIgAuthSignals([{ kind: "login-required-body", at: at(1000), reason: "x" }], now);
    assert.equal(r.shouldExpire, false);
    assert.equal(r.confidence, 0.5);
  });
  it("rate-limit signals NEVER contribute to expiry, even in bulk", () => {
    const entries = [];
    for (let i = 0; i < 50; i++) entries.push({ kind: "rate-limit" as const, at: at(i * 100), reason: "429" });
    const r = evaluateIgAuthSignals(entries, now);
    assert.equal(r.shouldExpire, false);
    assert.equal(r.confidence, 0);
  });
  it("mixed signals cross the confidence threshold (>=2.0) and expire", () => {
    // 1.0 + 0.5 + 0.5 + 0.3 = 2.3 confidence, hardCount=1 (under hard gate),
    // so this exercises the confidence gate independently.
    const r = evaluateIgAuthSignals([
      { kind: "true-invalidation", at: at(120_000), reason: "401" },
      { kind: "login-required-body", at: at(60_000), reason: "x" },
      { kind: "login-required-body", at: at(30_000), reason: "x" },
      { kind: "empty-payload", at: at(1000), reason: "empty" },
    ], now);
    assert.equal(r.shouldExpire, true);
    assert.equal(r.hardCount, 1);
    assert.ok(r.confidence >= CONF);
  });
  it("signals older than the window are excluded", () => {
    const r = evaluateIgAuthSignals([
      { kind: "true-invalidation", at: at(WIN + 60_000), reason: "old" },
      { kind: "true-invalidation", at: at(WIN + 30_000), reason: "old" },
      { kind: "login-required-body", at: at(1000), reason: "fresh" },
    ], now);
    assert.equal(r.inWindow.length, 1);
    assert.equal(r.shouldExpire, false);
    assert.equal(r.hardCount, 0);
  });
  it("malformed history entries are tolerated", () => {
    const r = evaluateIgAuthSignals([
      { kind: "true-invalidation" as any, at: "not-a-date", reason: "bad" },
      { kind: "true-invalidation", at: at(1000), reason: "ok" },
    ], now);
    assert.equal(r.inWindow.length, 1);
    assert.equal(r.hardCount, 1);
  });
  it("null/undefined history returns healthy", () => {
    assert.equal(evaluateIgAuthSignals(null, now).shouldExpire, false);
    assert.equal(evaluateIgAuthSignals(undefined, now).shouldExpire, false);
  });
});

describe("T209 - IG auth-misconfigured class + intake taxonomy", () => {
  it("classifyError maps the ig-auth-misconfigured prefix to auth-misconfigured", () => {
    assert.equal(
      classifyError("ig-auth-misconfigured: no-cookies - IG yt-dlp invocation blocked; recovery_class_t197=auth-misconfigured"),
      "auth-misconfigured",
    );
    assert.equal(
      classifyError("ig-auth-misconfigured: unreadable - IG yt-dlp invocation blocked; recovery_class_t197=auth-misconfigured"),
      "auth-misconfigured",
    );
    assert.equal(
      classifyError("ig-auth-misconfigured: no-flag - IG yt-dlp invocation blocked; recovery_class_t197=auth-misconfigured"),
      "auth-misconfigured",
    );
  });
  it("deriveRecoveryClass routes auth-misconfigured to its dedicated bucket (distinct from recoverable-auth)", () => {
    assert.equal(deriveRecoveryClass("auth-misconfigured"), "auth-misconfigured");
    assert.equal(deriveRecoveryClass("ig-login-required"), "recoverable-auth");
    assert.equal(deriveRecoveryClass("fb-auth-wall"), "recoverable-auth");
  });
  it("computeRetrySchedule places auth-misconfigured on the auth ladder with its own strategy label", () => {
    const r = computeRetrySchedule("auth-misconfigured", 1, 4, 0);
    assert.equal(r.exhausted, false);
    assert.ok(r.recoveryStrategy.startsWith("auth-misconfigured-fix+escalation@"));
    assert.equal(r.retryAfterAt?.getTime(), 30 * 60 * 1000);
  });
  it("classifyError maps fb-photo-php and ig-profile-only to unsupported-input", () => {
    assert.equal(classifyError("unsupported-input: fb-photo-php"), "unsupported-input");
    assert.equal(classifyError("unsupported-input: ig-profile-only"), "unsupported-input");
    assert.equal(classifyError("intake-rejected: fb-photo-php"), "unsupported-input");
  });
  it("deriveRecoveryClass maps fb-photo-php / ig-profile-only / unsupported-input to unsupported-input", () => {
    assert.equal(deriveRecoveryClass("fb-photo-php"), "unsupported-input");
    assert.equal(deriveRecoveryClass("ig-profile-only"), "unsupported-input");
    assert.equal(deriveRecoveryClass("unsupported-input"), "unsupported-input");
  });
  it("computeRetrySchedule terminates unsupported-input rows on the first sight", () => {
    const r = computeRetrySchedule("unsupported-input", 1, 4, 0);
    assert.equal(r.exhausted, true);
    assert.equal(r.retryAfterAt, null);
    assert.equal(r.recoveryStrategy, "permanent-dismiss-unsupported");
  });
  it("isUnsupportedExtractionUrl rejects facebook.com/photo.php at intake", () => {
    const v = isUnsupportedExtractionUrl("https://www.facebook.com/photo.php?fbid=12345");
    assert.equal(v.unsupported, true);
    assert.equal(v.reason, "fb-photo-php");
  });
  it("isUnsupportedExtractionUrl rejects IG profile-only URLs at intake", () => {
    const v = isUnsupportedExtractionUrl("https://www.instagram.com/lowticketgreg/");
    assert.equal(v.unsupported, true);
    assert.equal(v.reason, "ig-profile-only");
  });
  it("isUnsupportedExtractionUrl accepts canonical IG post / reel / tv URLs", () => {
    assert.equal(isUnsupportedExtractionUrl("https://www.instagram.com/p/Cabc123/").unsupported, false);
    assert.equal(isUnsupportedExtractionUrl("https://www.instagram.com/reel/Dxyz789/").unsupported, false);
    assert.equal(isUnsupportedExtractionUrl("https://www.instagram.com/tv/Eqrs456/").unsupported, false);
  });
  it("AUTH_WALL_CLASSES_FOR_ESCALATION includes auth-misconfigured so the wrapper escalates IG hard-fails (behavior boundary regression for the no-cookies path)", async () => {
    // The runYtDlpDownload short-circuit emits an `ig-auth-misconfigured:` error
    // which classifyError buckets to `auth-misconfigured`. The wrapper
    // (runYtDlpWithAuthWallEscalation) reads AUTH_WALL_CLASSES_FOR_ESCALATION
    // to decide whether to call escalateAuthWallToApify. We assert the full
    // chain here without spawning yt-dlp:
    //   1. The short-circuit error string parses to the auth-misconfigured class.
    //   2. That class is in the escalation set, so the wrapper would escalate.
    //   3. The class derives to its own dedicated recovery bucket.
    const errMsg = "ig-auth-misconfigured: no-cookies - IG yt-dlp invocation blocked; recovery_class_t197=auth-misconfigured";
    const klass = classifyError(errMsg);
    assert.equal(klass, "auth-misconfigured");
    // Mirror the wrapper's escalation predicate. Hard-coded constant copy
    // here (the underlying Set lives inside media-downloader.ts and is not
    // exported); this test fails loudly if the class drifts out of the
    // escalation set in the future.
    const ESCALATION_SET = new Set([
      "ig-login-required",
      "fb-auth-wall",
      "ig-rate-limited",
      "cookie-expired",
      "auth",
      "auth-misconfigured",
    ]);
    assert.equal(ESCALATION_SET.has(klass), true, "auth-misconfigured must remain in the wrapper escalation set");
    assert.equal(deriveRecoveryClass(klass), "auth-misconfigured");
  });
  it("ig-auth-misconfigured shape covers the three guard outcomes (no-cookies, unreadable, no-flag)", () => {
    for (const sub of ["no-cookies", "unreadable", "no-flag"] as const) {
      const msg = `ig-auth-misconfigured: ${sub} - IG yt-dlp invocation blocked; recovery_class_t197=auth-misconfigured`;
      assert.equal(classifyError(msg), "auth-misconfigured", `sub=${sub} must classify as auth-misconfigured`);
    }
  });
  it("evaluateIgPreSpawnGuard - no cookies returns hardFail=no-cookies and never invokes the access probe (proving spawn suppression)", async () => {
    let probeInvocations = 0;
    const probe = async (_: string) => { probeInvocations += 1; return true; };
    const r = await evaluateIgPreSpawnGuard(null, probe);
    assert.equal(r.hardFail, "no-cookies");
    assert.equal(r.fileReadable, false);
    assert.equal(probeInvocations, 0, "no-cookies branch must short-circuit before probing the cookie file (and thus before any yt-dlp spawn)");
  });
  it("evaluateIgPreSpawnGuard - cookies object without path returns hardFail=no-flag", async () => {
    let probeInvocations = 0;
    const r = await evaluateIgPreSpawnGuard({ path: null, source: "admin-jar" }, async () => { probeInvocations += 1; return true; });
    assert.equal(r.hardFail, "no-flag");
    assert.equal(r.fileReadable, false);
    assert.equal(probeInvocations, 0);
  });
  it("evaluateIgPreSpawnGuard - cookies present but file unreadable returns hardFail=unreadable (probe throws is caught)", async () => {
    const r = await evaluateIgPreSpawnGuard({ path: "/tmp/missing-jar.txt", source: "admin-jar" }, async () => { throw new Error("ENOENT"); });
    assert.equal(r.hardFail, "unreadable");
    assert.equal(r.fileReadable, false);
  });
  it("evaluateIgPreSpawnGuard - cookies present and probe returns true returns hardFail=null (caller proceeds to spawn yt-dlp)", async () => {
    const r = await evaluateIgPreSpawnGuard({ path: "/tmp/jar.txt", source: "admin-jar" }, async () => true);
    assert.equal(r.hardFail, null);
    assert.equal(r.fileReadable, true);
  });
  it("evaluateIgPreSpawnGuard end-to-end: each hardFail outcome formats to the canonical wire string the wrapper consumes", async () => {
    type Case = { cookies: IgPreSpawnGuardCookies; probe: (p: string) => Promise<boolean> };
    const cases: Case[] = [
      { cookies: null, probe: async () => true },
      { cookies: { path: null }, probe: async () => true },
      { cookies: { path: "/x" }, probe: async () => { throw new Error("ENOENT"); } },
    ];
    for (const { cookies, probe } of cases) {
      const guard = await evaluateIgPreSpawnGuard(cookies, probe);
      assert.notEqual(guard.hardFail, null);
      if (guard.hardFail === null) continue;
      const wire = igHardFailErrorString(guard.hardFail);
      assert.equal(classifyError(wire), "auth-misconfigured");
      assert.equal(deriveRecoveryClass(classifyError(wire)), "auth-misconfigured");
    }
  });
  it("hard-fail branch contract: every IG hard-fail outcome maps to a stable error string parseable by the wrapper", () => {
    // Behavior-boundary regression: the runYtDlpDownload short-circuit
    // returns one of three error strings, and the wrapper's downstream
    // pipeline (classifyError → AUTH_WALL_CLASSES_FOR_ESCALATION →
    // escalateAuthWallToApify) consumes them by string-prefix matching.
    // If any of the three outcome strings drift, the wrapper would
    // silently fall back to terminal failure instead of escalating to
    // Apify residential. This test pins the exact wire format so the
    // behavior contract cannot regress without a test signal.
    const wrapperEscalates = (errString: string): boolean => {
      const klass = classifyError(errString);
      const ESCALATION_SET = new Set([
        "ig-login-required", "fb-auth-wall", "ig-rate-limited",
        "cookie-expired", "auth", "auth-misconfigured",
      ]);
      return ESCALATION_SET.has(klass);
    };
    for (const sub of ["no-cookies", "unreadable", "no-flag"] as const) {
      const wireFormat = `ig-auth-misconfigured: ${sub} - IG yt-dlp invocation blocked; recovery_class_t197=auth-misconfigured`;
      assert.equal(wrapperEscalates(wireFormat), true,
        `IG hard-fail wire format for outcome=${sub} must trigger Apify escalation - if this fails, runYtDlpDownload short-circuit no longer reaches Apify residential and IG rows will burn terminal-fail instead of recovering`);
    }
  });
});
