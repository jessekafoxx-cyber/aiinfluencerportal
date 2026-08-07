/**
 * Nightly attribution rollup for cc_daily_attribution.
 *
 * Runs once per day at 02:15 UTC (10 min after the revenue rollup),
 * aggregates yesterday's cc_conversions by (channel, campaign_type,
 * utm_campaign) and upserts the result into cc_daily_attribution so the
 * Attribution tab can query pre-aggregated daily totals for charting without
 * a full-table GROUP BY on every page load.
 *
 * Only non-refund rows are counted. Unique visitors are approximated as
 * DISTINCT visitor_id (NULL visitor_ids do not count).
 *
 * Kill switch: CC_ATTRIBUTION_ROLLUP_DISABLED=1.
 */

import { db, ccDailyAttribution, ccConversions } from "@workspace/db";
import { and, count, eq, gte, lte, sql } from "drizzle-orm";
import { logger } from "./logger.js";

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function runDailyAttributionRollup(day: string): Promise<void> {
  const start = new Date(day);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setUTCHours(23, 59, 59, 999);

  const rows = await db
    .select({
      channel: ccConversions.channel,
      campaignType: ccConversions.campaignType,
      utmCampaign: ccConversions.utmCampaign,
      conversions: count(),
      revenueCents: sql<number>`COALESCE(SUM(amount_cents), 0)::int`,
      uniqueVisitors: sql<number>`COUNT(DISTINCT visitor_id)::int`,
    })
    .from(ccConversions)
    .where(
      and(
        gte(ccConversions.occurredAt, start),
        lte(ccConversions.occurredAt, end),
        eq(ccConversions.isRefund, false),
      ),
    )
    .groupBy(
      ccConversions.channel,
      ccConversions.campaignType,
      ccConversions.utmCampaign,
    );

  if (rows.length === 0) {
    logger.info({ day }, "[cc-attribution-rollup] no conversions, skipping upsert");
    return;
  }

  // The unique index on cc_daily_attribution is (day, channel, utm_campaign)
  // with utm_campaign NOT NULL DEFAULT ''. We keep the INSERT ... ON CONFLICT
  // DO NOTHING followed by a raw-SQL UPDATE for the same key, which is safe
  // because this scheduler is the only writer and runs serially.
  for (const row of rows) {
    const ch = row.channel ?? "unknown";
    const campaign = row.utmCampaign ?? "";
    const conv = Number(row.conversions);
    const rev = Number(row.revenueCents);
    const uniq = Number(row.uniqueVisitors);

    const inserted = await db
      .insert(ccDailyAttribution)
      .values({
        day,
        channel: ch,
        campaignType: row.campaignType ?? null,
        utmCampaign: campaign,
        conversions: conv,
        revenueCents: rev,
        uniqueVisitors: uniq,
      })
      .onConflictDoNothing()
      .returning({ id: ccDailyAttribution.id });

    if (inserted.length === 0) {
      await db.execute(
        sql`UPDATE cc_daily_attribution
            SET conversions = ${conv}, revenue_cents = ${rev}, unique_visitors = ${uniq}, updated_at = now()
            WHERE day = ${day}::date
              AND channel = ${ch}
              AND utm_campaign = ${campaign}`,
      );
    }
  }

  logger.info(
    { day, channelCount: rows.length },
    "[cc-attribution-rollup] done",
  );
}

export function startCcDailyAttributionRollup(): void {
  if (process.env.CC_ATTRIBUTION_ROLLUP_DISABLED === "1") {
    logger.info(
      "CC_ATTRIBUTION_ROLLUP_DISABLED=1; cc attribution rollup will not start",
    );
    return;
  }

  const scheduleNext = (): void => {
    const now = new Date();
    const target = new Date();
    target.setUTCHours(2, 15, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setUTCDate(target.getUTCDate() + 1);
    }
    const delay = target.getTime() - now.getTime();
    const timer = setTimeout(() => {
      const yesterday = formatDate(new Date(Date.now() - 86_400_000));
      void runDailyAttributionRollup(yesterday).finally(() => scheduleNext());
    }, delay);
    timer.unref?.();
    logger.info(
      { nextRunAt: target.toISOString() },
      "[cc-attribution-rollup] scheduled",
    );
  };

  scheduleNext();
}
