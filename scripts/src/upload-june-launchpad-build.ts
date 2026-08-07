/**
 * Content sync for the Platinum Club "June 2026 - The First-Time Entrepreneur
 * Launchpad" build (DFY Builds tab).
 *
 * ROWS is the desired state for the june-2026 build's launchpad_* sections.
 * The runner UPSERTs every ROW (keyed on section + title): inserts if missing,
 * otherwise updates resourceType / externalUrl / description / displayOrder /
 * isActive to match. OBSOLETE lists rows that were replaced by better-labelled
 * entries; they are deleted by (section, title). Safe to re-run on dev AND prod.
 *
 * Run (dev):   pnpm --filter @workspace/scripts run upload:june-launchpad
 * Run (prod):  DATABASE_URL="$PROD_DATABASE_URL" pnpm --filter @workspace/scripts run upload:june-launchpad
 */
import { and, eq } from "drizzle-orm";
import { db, platinumClubResourcesTable } from "@workspace/db";

type Row = {
  section: string;
  title: string;
  description?: string;
  resourceType: "drive_folder" | "link" | "one_click_install";
  externalUrl: string;
  displayOrder: number;
};

// Funnel preview pages carry ?notrack=true to match the existing May rows.
const preview = (url: string) =>
  url.includes("?") ? url : `${url}?notrack=true`;

// Generic placeholder rows that granular, labelled entries have replaced.
const OBSOLETE: { section: string; title: string }[] = [
  { section: "launchpad_bonuses", title: "Bonuses" },
  { section: "launchpad_bumps", title: "Order Bumps" },
  { section: "launchpad_upsells", title: "Upsells" },
  { section: "launchpad_content_scripts", title: "Short-form Content" },
];

const ROWS: Row[] = [
  // ── Main Offer ──────────────────────────────────────────────────────────
  {
    section: "launchpad_main_offer",
    title: "Master Folder (Everything)",
    description: "Every asset for this build in one Drive folder.",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/1Suj6NHHotKXWCSnRhopnLWxFWGXlXji2",
    displayOrder: 1,
  },
  {
    section: "launchpad_main_offer",
    title: "One-Click Install",
    description: "Import the full funnel into your GoHighLevel account.",
    resourceType: "one_click_install",
    externalUrl:
      "https://affiliates.gohighlevel.com/?fp_ref=gcooke&funnel_share=6a39a1cf6a9a84e04f4d43ed",
    displayOrder: 2,
  },
  {
    section: "launchpad_main_offer",
    title: "Product + Bonuses",
    description: "The core product and its bonuses.",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/193sghWDeMLkdHII-rcUf0q7rCKnxmngb",
    displayOrder: 3,
  },
  // ── Bonuses ─────────────────────────────────────────────────────────────
  {
    section: "launchpad_bonuses",
    title: "21 Money Traps That Kill First-Time Businesses Before They Start",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/1q48BckNYOlq2UWKaDWhOPcorg1WgPwQA",
    displayOrder: 1,
  },
  {
    section: "launchpad_bonuses",
    title: "First-Time Entrepreneurs Launch Assistant - Prompts",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/19HCg3YGQTZuKwWwz7h1H5DazqEo9EHYz",
    displayOrder: 2,
  },
  {
    section: "launchpad_bonuses",
    title: "Get Your First Paying Customer - Mini-Course",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/11XvVwcnTctNYkAqgHL432dEDaNakb1ok",
    displayOrder: 3,
  },
  {
    section: "launchpad_bonuses",
    title: "Minimum Viable Offer Design - Checklist",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/171z7jN2v2Z3gUkQfwGA5jfYH3XSR_adn",
    displayOrder: 4,
  },
  {
    section: "launchpad_bonuses",
    title: "The 30-Day Lean Launch Plan - Guide",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/1KlcjP5RR4RxbLGYcDxPFi59IWw8xvsiO",
    displayOrder: 5,
  },
  {
    section: "launchpad_bonuses",
    title: "The Entrepreneur Starting Line - Podcast",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/11ukJhC3hL1rIClmhtH29nWdYfQT0VPgS",
    displayOrder: 6,
  },
  {
    section: "launchpad_bonuses",
    title: "The Three-Number Pricing Formula - Guide",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/1gLDOz-e4wj0DdOingkK_WIyI6L5YogzH",
    displayOrder: 7,
  },
  // ── Order Bumps ─────────────────────────────────────────────────────────
  {
    section: "launchpad_bumps",
    title: "Money Psychology in Business - Bump 1",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/1nCkshg9n7shQZDeCwoHDP7RkFv4TkkSJ",
    displayOrder: 1,
  },
  {
    section: "launchpad_bumps",
    title: "Cashflow Control Setup Package - Bump 2",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/1GHLqO9pxQOkmA-9MlKC2jLcSNLaEQcco",
    displayOrder: 2,
  },
  // ── Upsells ─────────────────────────────────────────────────────────────
  {
    section: "launchpad_upsells",
    title: "The Business Model Blueprint - Upsell 1",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/1shVXtGCfI4kfxMXlvnBQNRJJOfiCC7tC",
    displayOrder: 1,
  },
  {
    section: "launchpad_upsells",
    title: "Power of Online Traffic - Upsell 2",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/17VXZwk5LPJc8IbK8QyAej7DW7EWY3xVd",
    displayOrder: 2,
  },
  // ── Creation Assets ─────────────────────────────────────────────────────
  {
    section: "launchpad_creation_assets",
    title: "Research Doc",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/18e56Gjch6fmVGZ_ybX6ifqsKXR0GlkGT",
    displayOrder: 1,
  },
  {
    section: "launchpad_creation_assets",
    title: "VSL",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/15PMATTbjdlS-ZJ6Rg97ifIwYSi0xWSkW",
    displayOrder: 2,
  },
  // ── Content Scripts ─────────────────────────────────────────────────────
  {
    section: "launchpad_content_scripts",
    title: "Green Screen Script",
    resourceType: "link",
    externalUrl:
      "https://docs.google.com/document/d/1TDtJK1nFH6fWrCnN2vr-Y6ODx6Bi0MtG/edit?usp=drive_link&ouid=114727739721850748290&rtpof=true&sd=true",
    displayOrder: 1,
  },
  {
    section: "launchpad_content_scripts",
    title: "Podcast Clip Scripts",
    resourceType: "link",
    externalUrl:
      "https://docs.google.com/document/d/1K2u5La0AdZ_b36xR5MJGjU5GuI52e5o1/edit?usp=drive_link&ouid=114727739721850748290&rtpof=true&sd=true",
    displayOrder: 2,
  },
  {
    section: "launchpad_content_scripts",
    title: "Selfie Yapping Scripts",
    resourceType: "link",
    externalUrl:
      "https://docs.google.com/document/d/1Tken2Nw3BVCSg5xNBHTlDhF5QpIYiaWi/edit?usp=drive_link&ouid=114727739721850748290&rtpof=true&sd=true",
    displayOrder: 3,
  },
  {
    section: "launchpad_content_scripts",
    title: "Short Form Content Scripts",
    resourceType: "link",
    externalUrl:
      "https://docs.google.com/document/d/1Rl1u33UfdKqNjZac3x1LFx3KQ_IJeQf7/edit?usp=drive_link&ouid=114727739721850748290&rtpof=true&sd=true",
    displayOrder: 4,
  },
  {
    section: "launchpad_content_scripts",
    title: "Organic Content Scripts",
    resourceType: "link",
    externalUrl:
      "https://docs.google.com/document/d/1dP70938gX6_LcPOmVE_XP_DE74Cx5Arx/edit?usp=drive_link&ouid=114727739721850748290&rtpof=true&sd=true",
    displayOrder: 5,
  },
  // ── Ads Library ─────────────────────────────────────────────────────────
  {
    section: "launchpad_ads",
    title: "DFY Meta Ad Folder",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/1tETNrVH1dHgCxwNelifATMKapQlLELwr",
    displayOrder: 1,
  },
  // ── Top 20 Ads ──────────────────────────────────────────────────────────
  {
    section: "launchpad_top_ads",
    title: "Top 20 Ads",
    description:
      "Gregory's top 20 best-performing ads - open the folder to browse all creatives.",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/1f-r-8NVI3qr4zlbQ66ZghtGPAy6avH73",
    displayOrder: 1,
  },
  // ── Custom Graphics ─────────────────────────────────────────────────────
  {
    section: "launchpad_custom_graphics",
    title: "Custom Graphics",
    resourceType: "drive_folder",
    externalUrl:
      "https://drive.google.com/drive/folders/1m0L7agydMT3KtTdf7f35i7oW6JTNCYCc",
    displayOrder: 1,
  },
  // ── Sales Assets (funnel pages) ─────────────────────────────────────────
  {
    section: "launchpad_sales_assets",
    title: "Sales Page (Preview)",
    resourceType: "link",
    externalUrl: preview(
      "https://sites.leadconnectorhq.com/preview/cTJ9vEZPkFwIUUUHilKo",
    ),
    displayOrder: 1,
  },
  {
    section: "launchpad_sales_assets",
    title: "Order Page (Preview)",
    resourceType: "link",
    externalUrl: preview(
      "https://sites.leadconnectorhq.com/preview/09JhOko2mDcuE2WXClja",
    ),
    displayOrder: 2,
  },
  {
    section: "launchpad_sales_assets",
    title: "Upsell Page V1 (Preview)",
    resourceType: "link",
    externalUrl: preview(
      "https://sites.leadconnectorhq.com/preview/ZQImqf6KmjTlsp7iIaZi",
    ),
    displayOrder: 3,
  },
  {
    section: "launchpad_sales_assets",
    title: "Upsell Page V2 (Preview)",
    resourceType: "link",
    externalUrl: preview(
      "https://sites.leadconnectorhq.com/preview/eVXmHwHz9B5O3csI4Mxu",
    ),
    displayOrder: 4,
  },
  {
    section: "launchpad_sales_assets",
    title: "Thank You Page (Preview)",
    resourceType: "link",
    externalUrl: preview(
      "https://sites.leadconnectorhq.com/preview/QG9rekuq5qkypjuCl8C1",
    ),
    displayOrder: 5,
  },
];

async function main() {
  let deleted = 0;
  for (const o of OBSOLETE) {
    const res = await db
      .delete(platinumClubResourcesTable)
      .where(
        and(
          eq(platinumClubResourcesTable.section, o.section),
          eq(platinumClubResourcesTable.title, o.title),
        ),
      )
      .returning({ id: platinumClubResourcesTable.id });
    if (res.length > 0) {
      deleted += res.length;
      console.log(`del   [${o.section}] ${o.title}`);
    }
  }

  let inserted = 0;
  let updated = 0;
  for (const r of ROWS) {
    const [existing] = await db
      .select({ id: platinumClubResourcesTable.id })
      .from(platinumClubResourcesTable)
      .where(
        and(
          eq(platinumClubResourcesTable.section, r.section),
          eq(platinumClubResourcesTable.title, r.title),
        ),
      )
      .limit(1);
    if (existing) {
      await db
        .update(platinumClubResourcesTable)
        .set({
          description: r.description ?? null,
          resourceType: r.resourceType,
          driveFileId: null,
          externalUrl: r.externalUrl,
          displayOrder: r.displayOrder,
          isActive: true,
        })
        .where(eq(platinumClubResourcesTable.id, existing.id));
      updated++;
      console.log(`upd   [${r.section}] ${r.title}`);
      continue;
    }
    await db.insert(platinumClubResourcesTable).values({
      section: r.section,
      title: r.title,
      description: r.description ?? null,
      resourceType: r.resourceType,
      driveFileId: null,
      externalUrl: r.externalUrl,
      coverDriveFileId: null,
      displayOrder: r.displayOrder,
      isActive: true,
    });
    inserted++;
    console.log(`add   [${r.section}] ${r.title}`);
  }
  console.log(
    `\nDone. deleted=${deleted} inserted=${inserted} updated=${updated} total=${ROWS.length}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
