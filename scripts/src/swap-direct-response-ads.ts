/**
 * Swap Phase 5 lesson "Scaling Ad Spend and KPIs" for "Direct Response Ads".
 *
 * The Room30 Phase 5 (Scaling With Ads) slot previously held the
 * "Scaling Ad Spend and KPIs" lesson (slug `r30-p5-scaling-ad-spend-kpis`).
 * Per the course owner it is replaced in place by the "Direct Response Ads"
 * lesson (slug `r30-p5-direct-response-ads`) with Wistia video `xn2954lrz1`
 * and freshly written notes.
 *
 * `ensureRoom30Course` only inserts new lesson rows - it never updates or
 * deletes existing rows - so patching `room30-course-data.ts` alone does not
 * change a database that already has the old row. This one-shot script
 * rewrites the matching lessons row in place (slug, title, brief,
 * wistia_video_id, notes). Idempotent: re-running after success is a no-op.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run swap:direct-response-ads            (dry-run)
 *   pnpm --filter @workspace/scripts run swap:direct-response-ads -- --apply (write)
 *
 * Against prod, set DATABASE_URL=$PROD_DATABASE_URL before running.
 */

import { and, eq } from "drizzle-orm";
import { db, lessonsTable } from "@workspace/db";

const PORTAL_KEY = "room30";
const OLD_SLUG = "r30-p5-scaling-ad-spend-kpis";
const NEW_SLUG = "r30-p5-direct-response-ads";
const NEW_TITLE = "Direct Response Ads";
const NEW_BRIEF =
  "How to write and run direct response ads that drive measurable action";
const NEW_WISTIA = "xn2954lrz1";
const NEW_NOTES = `<h2>DIRECT RESPONSE ADS</h2><p>A <strong>direct response ad</strong> is built to make someone take one specific action right now - click, opt in, or buy. Unlike brand or awareness ads that just put your name in front of people, direct response ads are measured by a single question: did they do the thing you asked? This is where your ad spend turns into real, trackable revenue.</p><p>Every direct response ad is a small sales conversation. It grabs attention, speaks to a problem your audience feels, shows them the way out, and tells them exactly what to do next. If any one of those pieces is missing, the response drops.</p><hr><h3>WHY DIRECT RESPONSE WINS 🧠</h3><p>Direct response forces clarity. Because you are asking for a measurable action, you find out fast what is working and what is not. You are not guessing whether an ad helped - you can see the clicks, the opt-ins, and the sales it produced.</p><p>It also compounds with everything else in your funnel. A strong direct response ad feeds qualified people straight into your bridge page and offer, so the rest of your system can do its job. Weak, vague ads send traffic that never converts and quietly burn budget.</p><blockquote><p>⚡ <strong>KEY INSIGHT:</strong> If you cannot point to the exact action an ad is asking for, it is not a direct response ad - it is an expensive awareness post.</p></blockquote><hr><h3>THE ANATOMY OF A DIRECT RESPONSE AD 🎯</h3><p>Strong direct response ads almost always follow the same backbone:</p><p><strong>1. The Hook.</strong> The first line or first three seconds stop the scroll. Lead with the result, the problem, or a bold statement your dream client cannot ignore.</p><p><strong>2. The Problem.</strong> Name the pain they are already feeling. When people feel understood, they keep reading.</p><p><strong>3. The Solution.</strong> Position your offer as the clear path out - simple, specific, and believable.</p><p><strong>4. The Proof.</strong> Back it up with results, testimonials, or a quick demonstration so the claim does not sound empty.</p><p><strong>5. The Call To Action.</strong> Tell them exactly what to do next in plain language. One ad, one action.</p><hr><h3>WRITING THE CALL TO ACTION 🚀</h3><p>The CTA is where most ads fall apart. Be direct and specific - tap the link, claim your spot, get the free guide. Never make the viewer guess what happens next or give them two competing choices. Confusion kills conversion.</p><blockquote><p>👀 <strong>TIP:</strong> Match the CTA to one single action and send people to one single page. If your ad asks for two things, it gets neither.</p></blockquote><hr><p>Once your direct response ad is live, judge it the same way you judge everything else - against your numbers. Watch the cost per result, keep the winners running, and cut the ones that miss. If you want a second set of eyes on an ad before you scale it, reach out for support and you will get feedback tailored to your offer.</p>`;

async function main() {
  const apply = process.argv.includes("--apply");

  const oldRows = await db
    .select({ id: lessonsTable.id })
    .from(lessonsTable)
    .where(
      and(eq(lessonsTable.slug, OLD_SLUG), eq(lessonsTable.portalKey, PORTAL_KEY)),
    );
  const newRows = await db
    .select({ id: lessonsTable.id })
    .from(lessonsTable)
    .where(
      and(eq(lessonsTable.slug, NEW_SLUG), eq(lessonsTable.portalKey, PORTAL_KEY)),
    );

  if (oldRows.length === 0 && newRows.length > 0) {
    console.log("[swap-drp] already migrated (new slug present, old slug gone)");
    process.exit(0);
  }
  if (oldRows.length === 0 && newRows.length === 0) {
    console.log(
      `[swap-drp] neither ${OLD_SLUG} nor ${NEW_SLUG} found for portal=${PORTAL_KEY}; nothing to do`,
    );
    process.exit(0);
  }
  if (oldRows.length > 0 && newRows.length > 0) {
    console.error(
      "[swap-drp] BOTH old and new slug rows exist - manual review needed",
    );
    process.exit(1);
  }

  for (const row of oldRows) {
    if (!apply) {
      console.log(
        `[swap-drp] lesson id=${row.id}: would rewrite slug/title/brief/wistia/notes (dry-run)`,
      );
      continue;
    }
    await db
      .update(lessonsTable)
      .set({
        slug: NEW_SLUG,
        title: NEW_TITLE,
        brief: NEW_BRIEF,
        wistiaVideoId: NEW_WISTIA,
        notes: NEW_NOTES,
      })
      .where(eq(lessonsTable.id, row.id));
    console.log(`[swap-drp] lesson id=${row.id}: updated to Direct Response Ads`);
  }

  console.log(`[swap-drp] done - apply=${apply}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[swap-drp] failed", err);
  process.exit(1);
});
