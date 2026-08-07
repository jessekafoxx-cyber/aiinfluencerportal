/**
 * One-shot end-to-end smoke test for:
 *   - SLACK_WEBHOOK_LEADS  (lead capture)
 *   - SLACK_WEBHOOK_LOWTICKETSALE  (low-ticket cart summary)
 *   - SLACK_WEBHOOK_HIGHTICKETSALE  (>= $500 sale)
 *   - GHL contact upsert + "not-purchased" tag (simulates 5-min scheduler hit)
 *   - GHL "ai influencer masterclass + dfy build" canonical tag +
 *     removal of legacy "Purchased" / "purchased: ai influencer
 *     masterclass + dfy build" / "not-purchased" (via tagGhlPurchased)
 *
 * Uses a clearly-labelled test email so the team can identify and
 * delete the GHL contact + ignore the Slack messages afterward.
 *
 * Run:
 *   cd artifacts/api-server && pnpm exec tsx scripts/test-slack-and-ghl-tags.ts
 */
import {
  notifyLeadCaptured,
  notifyLowTicketOrderSummary,
  notifyPaidOrder,
} from "../src/lib/sales-slack";
import {
  upsertGhlContact,
  tagGhlPurchased,
  ghlConfigured,
} from "../src/lib/ghl-sync";

const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const EMAIL = `replit-smoke+${STAMP}@room30.ai`;
const FIRST_NAME = "Replit Test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("=== Slack + GHL smoke test ===");
  console.log("Test email:", EMAIL);
  console.log("");

  // --- 1. Slack: LEADS ------------------------------------------------------
  console.log("[1/5] firing SLACK_WEBHOOK_LEADS (notifyLeadCaptured)...");
  notifyLeadCaptured({
    email: EMAIL,
    firstName: FIRST_NAME,
    phone: "+15555550100",
    country: "GB",
    sourcePage: "smoke-test://replit",
    referrer: "replit-agent",
    affiliateCode: "TEST123",
  });

  // --- 2. Slack: LOW-TICKET -------------------------------------------------
  console.log(
    "[2/5] firing SLACK_WEBHOOK_LOWTICKETSALE (notifyLowTicketOrderSummary)...",
  );
  notifyLowTicketOrderSummary({
    email: EMAIL,
    orderId: `test-${STAMP}`,
    totalCents: 6700,
    items: [
      { slug: "main", name: "[TEST] AI Influencer Masterclass", priceCents: 2700 },
      { slug: "bump-2", name: "[TEST] Hook Demo Library", priceCents: 1700 },
      { slug: "bump-3", name: "[TEST] Order Bump 3", priceCents: 2300 },
    ],
  });

  // --- 3. Slack: HIGH-TICKET ------------------------------------------------
  console.log(
    "[3/5] firing SLACK_WEBHOOK_HIGHTICKETSALE (notifyPaidOrder $1500)...",
  );
  notifyPaidOrder({
    email: EMAIL,
    productLabel: "[TEST] DFY AI Influencer",
    amountCents: 150000,
    orderRef: `test-${STAMP}`,
    source: "smoke-test",
    detailUrl: null,
  });

  // Slack helpers are fire-and-forget; give them time to flush.
  await sleep(2500);

  if (!ghlConfigured()) {
    console.log("");
    console.log("[GHL] not configured - skipping GHL section.");
    return;
  }

  // --- 4. GHL: contact + not-purchased tag (mimics 5-min scheduler hit) -----
  console.log("");
  console.log(
    "[4/5] GHL: upsertGhlContact w/ tags=['replit-smoke-test','not-purchased']...",
  );
  const contactId = await upsertGhlContact({
    email: EMAIL,
    firstName: FIRST_NAME,
    phone: "+15555550100",
    country: "GB",
    source: "replit-smoke-test",
    tags: ["replit-smoke-test", "not-purchased"],
  });
  console.log("  contact id:", contactId ?? "(null - check api-server logs)");

  // Pause so a human watching GHL can see 'not-purchased' before it flips.
  await sleep(2000);

  // --- 5. GHL: purchase flip (adds canonical product tag, removes legacy + not-purchased)
  console.log("");
  console.log(
    "[5/5] GHL: tagGhlPurchased() - adds canonical 'ai influencer masterclass + dfy build', removes legacy 'Purchased' / 'purchased: ai influencer masterclass + dfy build' / 'not-purchased'...",
  );
  // tagGhlPurchased gates on funnel_leads.ghl_purchased_tagged_at being
  // null. A synthetic email has no funnel_leads row, so the gate check
  // returns no row -> ghlPurchasedTaggedAt is undefined (falsy) -> the
  // helper proceeds. (The post-success stamp-update is a no-op for the
  // same reason: no funnel_leads row to update.)
  await tagGhlPurchased({ email: EMAIL, firstName: FIRST_NAME });

  console.log("");
  console.log("=== DONE ===");
  console.log("Check:");
  console.log(
    "  Slack: #leads, #low-ticket, #high-ticket-sale - one message each",
  );
  console.log(
    `  GHL: contact ${EMAIL} - should have ONLY 'ai influencer masterclass + dfy build', NO 'Purchased' / 'purchased: ai influencer masterclass + dfy build' / 'not-purchased'`,
  );
}

main()
  .then(() => sleep(2000))
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("smoke test threw:", err);
    process.exit(1);
  });
