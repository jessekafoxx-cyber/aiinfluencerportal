// Task continuation (post-#202, IG/FB extraction continuity brief): one-shot
// helper that reopens auth-failure rows for a given platform AND gates on
// the corresponding active session jar being present. Without an active
// jar the reopen is refused so we never spin up a retry storm against
// the unauthenticated path that already failed.
//
// Usage:
//   pnpm --filter @workspace/scripts run reopen:auth-failures -- --platform=ig --dry-run
//   pnpm --filter @workspace/scripts run reopen:auth-failures -- --platform=fb
//
// Reopened rows get:
//   - dismissed = false
//   - media_status = 'pending'
//   - media_attempts = 0
//   - media_error / media_error_class cleared
//   - recovery_class_t197 / recovery_strategy_t197 / retry_after_at_t197 cleared
//     (so the periodic processor picks them up on the next tick instead of
//     waiting on the recoverable-temporary 10m delay the failed branch wrote)
//   - reopened_at_t197 stamped (the T200 reopen marker the dashboard uses
//     to tell a verification reopen apart from a regular requeue)
//
// Idempotent: re-running on a row that's already pending is a no-op.

import { db, adResearchBoardItems, authCookieJars, providerConfigsTable } from "@workspace/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";

type Platform = "ig" | "fb";

const IG_AUTH_CLASSES = [
  "ig-login-required",
  "auth-wall-escalated-failed",
  "cookie-expired",
  "ig-rate-limited",
] as const;

// Default FB set is auth-only. yt-dlp-failure can mean either (a) a real
// auth-wall surfaced as an extractor error or (b) an upstream yt-dlp
// parser bug against an unsupported URL shape (share/r, photo.php,
// story.php, profile pages). The default refuses to reopen (b) - those
// rows just re-fail and waste worker capacity. Pass --include-extractor-failures
// to force the broader set when the operator knows the failures are
// auth-shaped (e.g. right after a fresh cookie upload).
const FB_AUTH_CLASSES = [
  "auth-wall-escalated-failed",
  "fb-auth-wall",
  "cookie-expired",
] as const;
const FB_EXTENDED_CLASSES = [...FB_AUTH_CLASSES, "yt-dlp-failure"] as const;

function parseArgs(): { platform: Platform; dryRun: boolean; includeExtractorFailures: boolean } {
  const args = process.argv.slice(2);
  const platformArg = args.find((a) => a.startsWith("--platform="));
  const platform = (platformArg?.split("=")[1] ?? "") as Platform;
  if (platform !== "ig" && platform !== "fb") {
    throw new Error("Required: --platform=ig OR --platform=fb");
  }
  return {
    platform,
    dryRun: args.includes("--dry-run"),
    includeExtractorFailures: args.includes("--include-extractor-failures"),
  };
}

async function ensureActiveJar(
  platform: Platform,
): Promise<{ ok: true; detail: string } | { ok: false; reason: string }> {
  if (platform === "fb") {
    const rows = await db
      .select({ id: authCookieJars.id, status: authCookieJars.status, uploadedAt: authCookieJars.uploadedAt })
      .from(authCookieJars)
      .where(
        and(
          eq(authCookieJars.platform, "fb"),
          eq(authCookieJars.status, "active"),
        ),
      );
    if (rows.length === 0) {
      return { ok: false, reason: "no active FB session jar (paste a fresh export into the FB Cookies admin panel)" };
    }
    return { ok: true, detail: `jarId=${rows[0]?.id} uploadedAt=${rows[0]?.uploadedAt?.toISOString?.() ?? rows[0]?.uploadedAt}` };
  }
  // IG: provider_configs row keyed (provider_slug='instagram', key='session_cookies')
  const [row] = await db
    .select({ value: providerConfigsTable.value })
    .from(providerConfigsTable)
    .where(
      and(
        eq(providerConfigsTable.providerSlug, "instagram"),
        eq(providerConfigsTable.key, "session_cookies"),
      ),
    )
    .limit(1);
  if (!row || !row.value) {
    return { ok: false, reason: "no IG session cookies saved (paste an export into the IG Cookies admin panel first)" };
  }
  const v = row.value as { status?: string; cookieCount?: number; cookieNames?: string[]; savedAt?: string };
  if (v.status !== "active") {
    return { ok: false, reason: `IG session status is '${v.status}' (paste a fresh export into the IG Cookies admin panel)` };
  }
  const required = ["sessionid", "ds_user_id", "csrftoken"];
  const missing = required.filter((n) => !(v.cookieNames ?? []).includes(n));
  if (missing.length > 0) {
    return { ok: false, reason: `IG session missing required cookies: ${missing.join(", ")}` };
  }
  return { ok: true, detail: `cookieCount=${v.cookieCount} savedAt=${v.savedAt}` };
}

async function main() {
  const { platform, dryRun, includeExtractorFailures } = parseArgs();
  const jar = await ensureActiveJar(platform);
  if (!jar.ok) {
    console.error(`[reopen-auth-failures] REFUSED: ${jar.reason}`);
    process.exit(2);
  }
  console.log(`[reopen-auth-failures] active ${platform.toUpperCase()} jar present (${jar.detail})`);

  const classes = platform === "ig"
    ? IG_AUTH_CLASSES
    : (includeExtractorFailures ? FB_EXTENDED_CLASSES : FB_AUTH_CLASSES);
  console.log(`[reopen-auth-failures] class set: ${classes.join(", ")}${platform === "fb" && !includeExtractorFailures ? " (default auth-only; pass --include-extractor-failures to also retry yt-dlp-failure)" : ""}`);
  const linkPattern = platform === "ig" ? "%instagram.com%" : "%facebook.com%";

  const candidates = await db
    .select({
      id: adResearchBoardItems.id,
      rowKey: adResearchBoardItems.rowKey,
      adLink: adResearchBoardItems.adLink,
      mediaStatus: adResearchBoardItems.mediaStatus,
      mediaErrorClass: adResearchBoardItems.mediaErrorClass,
      mediaAttempts: adResearchBoardItems.mediaAttempts,
      dismissed: adResearchBoardItems.dismissed,
    })
    .from(adResearchBoardItems)
    .where(
      and(
        inArray(adResearchBoardItems.mediaErrorClass, classes as unknown as string[]),
        sql`${adResearchBoardItems.adLink} ILIKE ${linkPattern}`,
        or(
          sql`${adResearchBoardItems.mediaStatus} = 'failed'`,
          sql`${adResearchBoardItems.dismissed} = true`,
        ),
      ),
    );

  console.log(`[reopen-auth-failures] candidates=${candidates.length}`);
  if (candidates.length === 0) return;

  for (const r of candidates.slice(0, 25)) {
    console.log(`  - id=${r.id} rowKey=${r.rowKey} class=${r.mediaErrorClass} status=${r.mediaStatus} attempts=${r.mediaAttempts} dismissed=${r.dismissed}`);
  }
  if (candidates.length > 25) console.log(`  …and ${candidates.length - 25} more`);

  if (dryRun) {
    console.log("[reopen-auth-failures] --dry-run: no writes");
    return;
  }

  const ids = candidates.map((r) => r.id);
  const updated = await db
    .update(adResearchBoardItems)
    .set({
      mediaStatus: "pending",
      mediaError: null,
      mediaErrorClass: null,
      mediaAttempts: 0,
      dismissed: false,
      recoveryClass: null,
      recoveryStrategy: null,
      retryAfterAt: null,
      reopenedAtT197: new Date(),
      mediaLeaseOwner: null,
      mediaLeaseUntil: null,
      updatedAt: sql`now()`,
    })
    .where(inArray(adResearchBoardItems.id, ids))
    .returning({ id: adResearchBoardItems.id });

  console.log(`[reopen-auth-failures] reopened ${updated.length} ${platform.toUpperCase()} rows`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[reopen-auth-failures] FAILED:", err?.stack || err?.message || String(err));
  process.exit(1);
});
