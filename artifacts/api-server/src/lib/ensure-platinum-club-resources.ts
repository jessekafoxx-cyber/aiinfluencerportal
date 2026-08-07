import { db } from "@workspace/db";
import { platinumClubResourcesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// Platinum Club "Agency Growth Blueprint" content library seed.
//
// Publish ships the `platinum_club_resources` table (ADD TABLE migration) but
// skips data backfills, so this boot loader provides the INITIAL row content.
//
// IMPORTANT - seed-if-empty only. Admins now own this catalog at runtime via
// the admin CRUD endpoints in routes/platinum-club.ts (add / edit / reorder /
// delete). The loader therefore seeds the rows below ONLY when the table is
// empty; once any row exists it never touches the table again. A drift-
// correcting reseed (the original design) would silently wipe every admin edit
// on the next worker restart, so it must not be reintroduced. To change the
// shipped starter content, edit the catalog below AND clear the table (or edit
// in the admin panel post-deploy). The advisory lock keeps concurrent workers
// from racing the first insert.
//
// Delivery model (see schema + routes/platinum-club.ts):
//   - driveFileId  -> streamed on-demand through the platinum-gated download
//     proxy; coverDriveFileId streams the cover image the same way.
//   - externalUrl  -> opened in a new tab (Docs, Canva, page previews, Drive
//     folders, large ZIP bundles).

type SeedResource = {
  section: string;
  title: string;
  description?: string;
  resourceType: string;
  driveFileId?: string;
  externalUrl?: string;
  coverDriveFileId?: string;
  displayOrder: number;
};

export const PLATINUM_CLUB_RESOURCES: SeedResource[] = [
  // ── MAIN OFFER ───────────────────────────────────────────
  {
    section: "main_offer",
    title: "Agency Growth Blueprint - Ebook (PDF)",
    description:
      "The complete ebook. Your step-by-step framework to escape the operator trap and build a scalable agency.",
    resourceType: "pdf",
    driveFileId: "1tsyK4D-T4b4fsQZ0TQ5H4sxME0eAIKrw",
    coverDriveFileId: "1W8CK_3yBbmpVCQN_XbndpkHhIf8Gyydr",
    displayOrder: 1,
  },
  {
    section: "main_offer",
    title: "Agency Growth Blueprint - Ebook (DOCX)",
    description: "Editable Word version of the ebook.",
    resourceType: "docx",
    driveFileId: "1TuLViA65cja1uHZ1exM9WTIm9yoFg6vK",
    displayOrder: 2,
  },

  // ── BONUSES ──────────────────────────────────────────────
  {
    section: "bonuses",
    title: "7 Mistakes That Keep Agencies Stuck in Chaos and Burnout",
    description: "Listicle - identify and fix the most common agency scaling mistakes.",
    resourceType: "pdf",
    driveFileId: "1Si1tisztIL8OPgcbh5oPtiTAPZnKYBGs",
    coverDriveFileId: "1HfZzBI-dAsiLcofSQHhooFiQS9jwjoYi",
    displayOrder: 1,
  },
  {
    section: "bonuses",
    title: "Agency Operations & Scaling - Toolstack",
    description: "The exact tools and stack for running a lean, scalable agency.",
    resourceType: "pdf",
    driveFileId: "1uADvVcuBhf_svqBFP84pJeN4c8dsFcqu",
    coverDriveFileId: "10Mr160F2WZRu_dG_Gu2al3MrI9FByNVI",
    displayOrder: 2,
  },
  {
    section: "bonuses",
    title: "Agency Scaling Systems Podcast - Ep.1: Why Your Agency Can't Scale Without You",
    description: "Audio episode on founder dependency and how to break free.",
    resourceType: "audio",
    driveFileId: "1uzGo3pnmAcGYddgkQ4Y1VknpRX1OKjat",
    coverDriveFileId: "1fOcfE4hU-NaZvhwXAlndk4Wxk6Ywdm_B",
    displayOrder: 3,
  },
  {
    section: "bonuses",
    title: "Agency Scaling Systems Podcast - Ep.2: How to Escape the Operator Trap",
    description: "Audio episode on escaping the operator trap without burning revenue.",
    resourceType: "audio",
    driveFileId: "1G5OxfgZZRuG30jYqNR_gbl9lEli74n4a",
    displayOrder: 4,
  },
  {
    section: "bonuses",
    title: "Agency Scaling Systems Podcast - Ep.3: If You Can't Take a Week Off, This Audit Explains It",
    description: "Audio episode on auditing your agency for owner dependency.",
    resourceType: "audio",
    driveFileId: "1mcmw863jXTTlA_XseUyCYcJeFDtBGUdP",
    displayOrder: 5,
  },
  {
    section: "bonuses",
    title: "Agency Transformation Assistant - AI Prompts",
    description: "Ready-to-use AI prompts to accelerate your agency transformation.",
    resourceType: "pdf",
    driveFileId: "1MnSY5nN6mwc1YDnDyV6Ipm2XGkc_RGzF",
    coverDriveFileId: "1HMCxHQOEBzsUuTQDafubY0eLx4TVyFGi",
    displayOrder: 6,
  },
  {
    section: "bonuses",
    title: "From Agency Operator to Owner - Mini-Course",
    description: "A condensed mini-course on making the operator-to-owner transition.",
    resourceType: "pdf",
    driveFileId: "1xh-wGR9QJkXF6gyqHtbymm2ibbDVhnJx",
    coverDriveFileId: "1sL62we6oMwqxb1_8IvEs4aGLiYI0MUgK",
    displayOrder: 7,
  },
  {
    section: "bonuses",
    title: "The 90-Day Agency Transformation Guide",
    description: "Your 90-day roadmap from chaos to scalable operations.",
    resourceType: "pdf",
    driveFileId: "1a0GW_kZmebCjZoyUfEmjWArFu6LyUS5-",
    coverDriveFileId: "1M8MyGRTsnFJac3SJAgaOCurBrKM7c0ta",
    displayOrder: 8,
  },
  {
    section: "bonuses",
    title: "The Operator-to-Owner Audit - Checklist",
    description:
      "Score your agency across key operational areas and identify what to fix first.",
    resourceType: "pdf",
    driveFileId: "1_ZkHI36QhgFi-pgJUDKYs59issZqGm_j",
    coverDriveFileId: "1qLPSnBlwh4-CpPNaM4RNp04hPAZBiihw",
    displayOrder: 9,
  },

  // ── ORDER BUMPS ──────────────────────────────────────────
  {
    section: "bumps",
    title: "Launch It! - Book (PDF)",
    description: "Step-by-step launch playbook for agency owners.",
    resourceType: "pdf",
    driveFileId: "1O2s3jLkIILIzQThfwDBaqgbKOuJ_Dmhv",
    coverDriveFileId: "1REAYd5Hf1Ji2xrocU4TEagXhGP_XEsiB",
    displayOrder: 1,
  },
  {
    section: "bumps",
    title: "Launch It! - Checklist (PDF)",
    description: "Action checklist companion to the Launch It! book.",
    resourceType: "pdf",
    driveFileId: "1ifPwK7wc5LR8a0c3oBKJeYhTeNaH7Wgr",
    displayOrder: 2,
  },
  {
    section: "bumps",
    title: "Marketing Plan Simplified - Book (PDF)",
    description: "A simplified marketing plan framework for agency owners.",
    resourceType: "pdf",
    driveFileId: "12VK_XSGrZzIz_c1Ur7TadDkvZW2YCqxK",
    coverDriveFileId: "1VEif9TTSeaE-lMcwjrsJft0p4JsC9Olw",
    displayOrder: 3,
  },

  // ── UPSELLS ──────────────────────────────────────────────
  {
    section: "upsells",
    title: "Power of Online Traffic - Book (PDF)",
    description: "Comprehensive guide to generating online traffic for your agency.",
    resourceType: "pdf",
    driveFileId: "1djxFTYwGsXRpGwa8hA05xCk4D08cOq_6",
    displayOrder: 1,
  },
  {
    section: "upsells",
    title: "Power of Online Traffic - Checklist (PDF)",
    description: "Action checklist companion for the traffic guide.",
    resourceType: "pdf",
    driveFileId: "1hEkV0GZy1ducjGE5IfqntgNoxfb9C0Do",
    displayOrder: 2,
  },
  {
    section: "upsells",
    title: "Power of Online Traffic - Audio Bundle (ZIP)",
    description: "Audio version of the traffic guide. Download and listen anywhere.",
    resourceType: "zip",
    externalUrl: "https://drive.google.com/uc?export=download&id=1UFc87bdF1_d5NLCK8VFuFUme3Lr-i4Zm",
    displayOrder: 3,
  },
  {
    section: "upsells",
    title: "Power of Online Traffic - Video Bundle (ZIP)",
    description: "Video version of the traffic guide.",
    resourceType: "zip",
    externalUrl: "https://drive.google.com/uc?export=download&id=1lx9RPsrFeBk5wL1P5ZMPy77Ve_nZFabx",
    displayOrder: 4,
  },
  {
    section: "upsells",
    title: "Strategic Marketing Playbook - Audio Bundle (ZIP)",
    description: "Advanced strategic marketing audio course.",
    resourceType: "zip",
    externalUrl: "https://drive.google.com/uc?export=download&id=1XWv2_hKfZ6Xi3UFrsguMxohP0GHA6ILN",
    displayOrder: 5,
  },
  {
    section: "upsells",
    title: "Strategic Marketing Playbook - Video Bundle (ZIP)",
    description: "Advanced strategic marketing video course.",
    resourceType: "zip",
    externalUrl: "https://drive.google.com/uc?export=download&id=1xVUKmVk6KE0loTTW7h_AxAHE3hdKBdcY",
    displayOrder: 6,
  },

  // ── CREATION ASSETS ──────────────────────────────────────
  {
    section: "creation_assets",
    title: "Research Doc: Agency Growth Blueprint",
    description:
      "In-depth market research document - 18,000+ characters of competitor analysis, audience insights, and positioning.",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/1aBEvhRTfKP5F6IEBIIJJ93qbdKh4MnEtN13shx1yDR4/edit",
    displayOrder: 1,
  },
  {
    section: "creation_assets",
    title: "VSL Script 1",
    description: "Video sales letter script - hook, body, and CTA for short-form content.",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/1ah_Qsl5KxY6F5rhtnZ1QD45Wmk99NSw3uBwzhCd_9-0/edit",
    displayOrder: 2,
  },
  {
    section: "creation_assets",
    title: "AI Influencer Green Screen Scripts",
    description: "Full green screen video scripts for AI influencer content - 20+ topics.",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/1iCr1rSaQlf6TyU6MuL7eiipw25-PcK0v81LAa0OLSgE/edit",
    displayOrder: 3,
  },
  {
    section: "creation_assets",
    title: "Podcast Clips Scripts - May 2026",
    description: "Scripts for podcast clip content pieces.",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/1OMfIeX3qgiM5LNxXqYt4rQChF-s5PQJXSgW6eBoLZsY/edit",
    displayOrder: 4,
  },
  {
    section: "creation_assets",
    title: "Selfie Yapping Videos Scripts - May 2026",
    description: "Scripts for selfie-style talking head content.",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/18qxOaZY0E-j-T36qlL8uZ94VsA-LIPzFNEyS9yv-NLw/edit",
    displayOrder: 5,
  },
  {
    section: "creation_assets",
    title: "Green Screen Background Images (20+ images)",
    description:
      "20+ background images for green screen AI influencer videos. Open the folder to download the full set.",
    resourceType: "drive_folder",
    externalUrl: "https://drive.google.com/drive/folders/1s36zw5c5N_TuJE8HIgZZsGc3WNW-K3lz",
    displayOrder: 6,
  },

  // ── CONTENT FULL SCRIPTS ─────────────────────────────────
  {
    section: "content_scripts",
    title: "Agency Challenge - Identity",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/1bgDC30Q97t5rpgAKPqIdihgdHz0OMPexjEZxd1VK-iY/edit",
    displayOrder: 1,
  },
  {
    section: "content_scripts",
    title: "Audience Challenge - Leadership",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/1BflpbLuouX3cG_naKneRXp1c1vg0GE-rq8xbFkj-zro/edit",
    displayOrder: 2,
  },
  {
    section: "content_scripts",
    title: "Contrarian Execution",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/1SlQeqCThi_fRFP1J6sUXreoym9Y_toN1TgSYkmKLyMk/edit",
    displayOrder: 3,
  },
  {
    section: "content_scripts",
    title: "Feature Based - AI",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/1KJBwMe11p-LEb1evOKBQ6AV_ruy21OjfB-uEfs9HNgA/edit",
    displayOrder: 4,
  },
  {
    section: "content_scripts",
    title: "Feature Based - Business",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/1BeniNM86rb3veGNGFtVvlv66gdRY6oC9mholzDm5jmg/edit",
    displayOrder: 5,
  },
  {
    section: "content_scripts",
    title: "Strong Statement - Content",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/19YhlbS5f6lYqz9ADKhjKoSO2ce3yKpvdb_9neq2mNQQ/edit",
    displayOrder: 6,
  },
  {
    section: "content_scripts",
    title: "Strong Statement - Scaling",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/1U12oqfzpBDgAH72acKMFQPt0DMdtsCalcFrS9gUnW4I/edit",
    displayOrder: 7,
  },
  {
    section: "content_scripts",
    title: "Strong Statement - Mindset",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/12mJwLeSTF3uSNdJPwhL803SIH--469rVnl5qe1KdBcU/edit",
    displayOrder: 8,
  },
  {
    section: "content_scripts",
    title: "Truth Bomb",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/1MlHzT8ZkeMcFmRdODIv-7ehFrUJAyfIULyczcAicvb8/edit",
    displayOrder: 9,
  },

  // ── ADS LIBRARY ──────────────────────────────────────────
  {
    section: "ads",
    title: "25+ DFY Meta Ad Static Creatives",
    description: "Ready-to-upload Meta ad images - all designed, all tested angles.",
    resourceType: "drive_folder",
    externalUrl: "https://drive.google.com/drive/folders/19O3FAsEXWUpYpmN9xxT7miMvHQSc37ez",
    displayOrder: 1,
  },
  {
    section: "ads",
    title: "DFY Meta Ad Creatives (Full Folder - 25+ variations)",
    description: "Full Meta Ads folder including all creative sizes and angles.",
    resourceType: "drive_folder",
    externalUrl: "https://drive.google.com/drive/folders/1tUfTydm14bUEVQvbkAxnOt_dKUXEZPSw",
    displayOrder: 2,
  },
  {
    section: "ads",
    title: "Google Ads Copy - 15 Variations",
    description:
      "15 Google Ad copy variations - headlines, descriptions, and sitelink extensions.",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/1LGhVSPdjZzLb-IO4zWFv_7cbLHTbTv6xlsiR1aQlN3o/edit",
    displayOrder: 3,
  },
  {
    section: "ads",
    title: "Google Ads Copy - Additional Set",
    description: "More Google Ads copy variations for testing.",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/19KjS9getSrTLNLsvLBTxR7pmX06FDShYQKugCuNGkns/edit",
    displayOrder: 4,
  },
  {
    section: "ads",
    title: "Canva Mockup Templates",
    description: "Editable Canva links for main offer, upsell 1, and upsell 2 mockups.",
    resourceType: "link",
    externalUrl: "https://docs.google.com/document/d/1I4h7OOhVOm_I6akwxYWiPbTjC3ZkuY3tr15albCo8Dg/edit",
    displayOrder: 5,
  },

  // ── SALES ASSETS ─────────────────────────────────────────
  {
    section: "sales_assets",
    title: "5+ Sales Email Sequence",
    description: "Pre-written email sequence - just swap in your link and name.",
    resourceType: "google_doc",
    externalUrl: "https://docs.google.com/document/d/140GPWkxaIzrDBd4Cy6sH47r8c8wyQ1SpBJr-uXnqcfc/edit",
    displayOrder: 1,
  },
  {
    section: "sales_assets",
    title: "Sales Page (Preview)",
    description: "The full sales page - study the copy, layout, and structure.",
    resourceType: "link",
    externalUrl: "https://sites.leadconnectorhq.com/preview/pqGve2ZClOVPC5WjuRbi?notrack=true",
    displayOrder: 2,
  },
  {
    section: "sales_assets",
    title: "Order Page (Preview)",
    description: "The checkout / order page layout.",
    resourceType: "link",
    externalUrl: "https://sites.leadconnectorhq.com/preview/bT5EOSyPsPLj65ha7Q00?notrack=true",
    displayOrder: 3,
  },
  {
    section: "sales_assets",
    title: "Upsell Page V1 (Preview)",
    description: "First upsell page design and copy.",
    resourceType: "link",
    externalUrl: "https://sites.leadconnectorhq.com/preview/uX21tipNkbPKkLYdJnEK?notrack=true",
    displayOrder: 4,
  },
  {
    section: "sales_assets",
    title: "Upsell Page V2 (Preview)",
    description: "Second upsell page design and copy.",
    resourceType: "link",
    externalUrl: "https://sites.leadconnectorhq.com/preview/fJkI6YQQmhkSlHoAr0Rd?notrack=true",
    displayOrder: 5,
  },
  {
    section: "sales_assets",
    title: "Thank You Page (Preview)",
    description: "Post-purchase thank you page.",
    resourceType: "link",
    externalUrl: "https://sites.leadconnectorhq.com/preview/mEGKXw9UgCdDc1iI0WoS?notrack=true",
    displayOrder: 6,
  },
  {
    section: "sales_assets",
    title: "Bridge Pages (GHL Funnel Share)",
    description: "Pre-built bridge page funnel - import directly into GoHighLevel.",
    resourceType: "link",
    externalUrl:
      "https://affiliates.gohighlevel.com/?fp_ref=gcooke&funnel_share=6a1a6214e90fed02e5483acb",
    displayOrder: 7,
  },

  // ── TOP 20 ADS ───────────────────────────────────────────
  {
    section: "top_ads",
    title: "Our Top 20 Best-Performing Ads",
    description:
      "Study the top 20 ads - includes multiple format variations (video hooks, bodies, CTAs) per ad. Open the folder to browse all creatives.",
    resourceType: "drive_folder",
    externalUrl: "https://drive.google.com/drive/folders/1Yg1NhMkAOCSslUEdI83QHn5lRAaepZE-",
    displayOrder: 1,
  },

  // ── CUSTOM GRAPHICS ──────────────────────────────────────
  {
    section: "custom_graphics",
    title: "Main Offer + Bonuses Mockups",
    description: "Professional mockup graphics for the main offer and all bonuses.",
    resourceType: "drive_folder",
    externalUrl: "https://drive.google.com/drive/folders/1ifDhOJxkcrO8_3uP-TNPh1Mw1202DMLk",
    displayOrder: 1,
  },
  {
    section: "custom_graphics",
    title: "Order Bumps Mockups",
    description: "Mockup graphics for the order bump products.",
    resourceType: "drive_folder",
    externalUrl: "https://drive.google.com/drive/folders/1rZa85k8pGBWnrgU284TCvGqWO9DIN7px",
    displayOrder: 2,
  },
  {
    section: "custom_graphics",
    title: "Upsells Mockups",
    description: "Mockup graphics for the upsell products.",
    resourceType: "drive_folder",
    externalUrl: "https://drive.google.com/drive/folders/1nQKTMT4MgPtaTaIWjkqpklCxJHoftcYk",
    displayOrder: 3,
  },
  {
    section: "custom_graphics",
    title: "Market Research Doc (PDF)",
    description: "Full market research document in PDF format.",
    resourceType: "pdf",
    driveFileId: "1muJ-PRiAiK_4ToVo3rjlDzJZX-e3PJYX",
    displayOrder: 4,
  },
];

// Arbitrary but fixed advisory-lock key so concurrent workers serialize the
// first insert instead of racing each other.
const SEED_ADVISORY_LOCK_KEY = 778_120_5301;

let seededThisProcess = false;

// One-off, idempotent rename pass for the white-label rebrand. The seeder
// above is seed-if-empty, so databases that were already populated keep the
// pre-rebrand titles forever. This targets ONLY the exact legacy titles we
// shipped, so an admin who has since renamed a row is never overwritten.
const LEGACY_TITLE_RENAMES: Array<{ from: string; to: string }> = [
  { from: "Gregory's Top 20 Best-Performing Ads", to: "Our Top 20 Best-Performing Ads" },
];

async function renameLegacyBrandedResources(): Promise<void> {
  for (const { from, to } of LEGACY_TITLE_RENAMES) {
    try {
      const result = await db.execute(sql`
        UPDATE ${platinumClubResourcesTable}
        SET title = ${to}
        WHERE title = ${from}
      `);
      const changed = (result as { rowCount?: number }).rowCount ?? 0;
      if (changed > 0) {
        logger.info({ from, to, changed }, "Renamed legacy-branded Platinum Club resource");
      }
    } catch (err) {
      logger.error(
        { err: (err as Error).message, from },
        "Failed to rename legacy-branded Platinum Club resource",
      );
    }
  }
}

export async function ensurePlatinumClubResourcesSeeded(): Promise<void> {
  if (seededThisProcess) return;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${SEED_ADVISORY_LOCK_KEY})`);

      // Seed-if-empty only: admins own the catalog at runtime, so never wipe or
      // reconcile existing rows here (that would destroy admin edits on the
      // next restart). Re-check inside the lock so a concurrent worker that
      // already seeded short-circuits us.
      const [{ count } = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(platinumClubResourcesTable);
      if (Number(count) > 0) {
        return; // already seeded; admins own it from here
      }

      await tx.insert(platinumClubResourcesTable).values(
        PLATINUM_CLUB_RESOURCES.map((r) => ({
          section: r.section,
          title: r.title,
          description: r.description ?? null,
          resourceType: r.resourceType,
          driveFileId: r.driveFileId ?? null,
          externalUrl: r.externalUrl ?? null,
          coverDriveFileId: r.coverDriveFileId ?? null,
          displayOrder: r.displayOrder,
          isActive: true,
        })),
      );
      logger.info(
        { count: PLATINUM_CLUB_RESOURCES.length },
        "Seeded Platinum Club resources (initial)",
      );
    });
    await renameLegacyBrandedResources();
    seededThisProcess = true;
  } catch (err) {
    logger.error(
      { err: (err as Error).message },
      "Failed to seed Platinum Club resources",
    );
  }
}
