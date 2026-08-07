/**
 * Podcast-edit b-roll selection (Task #839).
 *
 * The owner curated a small, purpose-built b-roll set in Google Drive - one
 * folder per topical category, with trigger instructions. This module:
 *   - maps transcript keyword hits to a category + timestamp (planBrollCutaways)
 *   - resolves a category to a concrete local clip pulled on-demand from its
 *     Drive folder, cached on the worker disk (resolveBrollClip)
 *
 * On-demand fetch keeps it always in sync with the owner's Drive (no import
 * job, no extra table) and is fine because edits run as long async worker jobs.
 */

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  listDriveFolderVideosRecursive,
  getDriveFileStream,
} from "./google-drive";
import { logger } from "./logger";
import type { TranscriptWord } from "./transcription";

type Category = {
  id: string;
  label: string;
  driveFolderId: string;
  /** Higher wins when several categories match the same window. */
  priority: number;
  /** Lowercased trigger phrases (1-3 words) matched on word boundaries. */
  triggers: string[];
};

/**
 * Category -> Drive folder + trigger phrases, derived from the owner's B-Roll
 * spreadsheet (Name / Instructions / Folder).
 */
export const BROLL_CATEGORIES: readonly Category[] = [
  {
    id: "income_claim",
    label: "Income Claim",
    driveFolderId: "1gg4lfLy6VqKMa_e2-UBXm_ZFGbQ-1cy_",
    priority: 100,
    triggers: [
      "money",
      "income",
      "revenue",
      "profit",
      "profits",
      "cash",
      "paid",
      "payout",
      "dollars",
      "thousand",
      "grand",
      "made",
      "earn",
      "earned",
      "earning",
      "earnings",
      "make money",
      "making money",
      "per month",
      "a month",
      "a day",
      "per day",
    ],
  },
  {
    id: "buying_cta",
    label: "Buying AI Influencers / Portfolio Access",
    driveFolderId: "1oxWb0Kp28Yo_tc9D_C-Ljnai8Wr_m2Ic",
    priority: 90,
    triggers: [
      "get started",
      "buy yours",
      "buy your",
      "buy one",
      "go to",
      "sign up",
      "get yours",
      "grab yours",
      "check out",
      "link in bio",
      "this site",
      "the link",
      "order now",
      "join now",
    ],
  },
  {
    id: "managing",
    label: "Managing AI Influencers",
    driveFolderId: "11nrmVXEOqesLtxc3PcFodtBDyi52Y8xd",
    priority: 80,
    triggers: [
      "managing",
      "manage",
      "hundreds",
      "multiple accounts",
      "many influencers",
      "lots of",
      "at scale",
      "scaling",
    ],
  },
  {
    id: "ai_influencers",
    label: "AI Influencers",
    driveFolderId: "1-nD6Ht7Z1yo-R-aCuqtoqPA6eeZoH4BD",
    priority: 70,
    triggers: [
      "ai influencer",
      "ai influencers",
      "ai model",
      "ai models",
      "virtual influencer",
      "virtual influencers",
      "influencer",
      "influencers",
    ],
  },
  {
    id: "portfolio",
    label: "Portfolio of products",
    driveFolderId: "1d5DGyAN0Dl5zilA4IPNMiOkKn7UjvYOz",
    priority: 60,
    triggers: [
      "product",
      "products",
      "sell",
      "selling",
      "portfolio",
      "digital product",
      "digital products",
    ],
  },
  {
    id: "other_methods",
    label: "Other Methods",
    driveFolderId: "1KHB_ZDALYPe1QH17KTJH1zpjvYlA0HeK",
    priority: 50,
    triggers: [
      "dropshipping",
      "drop shipping",
      "smma",
      "ecom",
      "ecommerce",
      "agency",
      "affiliate",
      "amazon fba",
      "crypto",
      "trading",
      "stocks",
    ],
  },
  {
    id: "we_dont",
    label: "We Don't Do Any Of This",
    driveFolderId: "1ooCe0Rjdzyfzr51txXVVSVz_S_E0IpgW",
    priority: 40,
    triggers: [
      "we don't",
      "we dont",
      "none of this",
      "not like everyone",
      "no need to",
      "without doing",
      "forget about",
    ],
  },
  {
    id: "lifestyle",
    label: "Lifestyle",
    driveFolderId: "1dVVPM98TutTd-AFwotFcUuCL9I7MlZST",
    priority: 30,
    triggers: [
      "lifestyle",
      "freedom",
      "travel",
      "traveling",
      "luxury",
      "vacation",
      "beach",
      "laptop",
      "anywhere",
      "dream life",
    ],
  },
] as const;

export type BrollCutaway = { categoryId: string; startSec: number };

const CLIP_LEN = 4; // seconds each cutaway is shown (SOP)
const FIRST_ALLOWED = 4; // never before the 4s mark
const MIN_GAP_START = 8; // seconds between cutaway start points
const MAX_CUTAWAYS = 8;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9$ ]/g, "").trim();
}

/** Detect a money phrase like "$5,000", "5k", "10 grand". */
function isMoneyToken(raw: string): boolean {
  const t = raw.toLowerCase();
  if (/\$\s?\d/.test(t)) return true;
  if (/\b\d[\d,.]*\s?k\b/.test(t)) return true;
  if (/\b\d[\d,.]*\s?(grand|dollars?|bucks)\b/.test(t)) return true;
  return false;
}

/**
 * Scan transcript words for category triggers and schedule spaced cutaways.
 * Earliest-first, priority breaks ties inside a window, min-gap enforced.
 */
export function planBrollCutaways(words: TranscriptWord[]): BrollCutaway[] {
  if (words.length === 0) return [];
  const normWords = words.map((w) => norm(w.word));

  type Hit = { categoryId: string; priority: number; startSec: number };
  const hits: Hit[] = [];

  for (let i = 0; i < words.length; i++) {
    if (words[i].start < FIRST_ALLOWED) continue;
    // Build 1-3 word lowercased phrases starting at i.
    const phrases: string[] = [];
    let acc = "";
    for (let n = 0; n < 3 && i + n < words.length; n++) {
      acc = (acc + " " + normWords[i + n]).trim();
      if (acc) phrases.push(acc);
    }
    for (const cat of BROLL_CATEGORIES) {
      let matched = phrases.some((p) => cat.triggers.includes(p));
      if (!matched && cat.id === "income_claim" && isMoneyToken(words[i].word)) {
        matched = true;
      }
      if (matched) {
        hits.push({
          categoryId: cat.id,
          priority: cat.priority,
          startSec: words[i].start,
        });
      }
    }
  }

  hits.sort((a, b) =>
    a.startSec === b.startSec ? b.priority - a.priority : a.startSec - b.startSec,
  );

  const chosen: BrollCutaway[] = [];
  let lastStart = -Infinity;
  for (const h of hits) {
    if (chosen.length >= MAX_CUTAWAYS) break;
    if (h.startSec - lastStart < MIN_GAP_START) continue;
    chosen.push({ categoryId: h.categoryId, startSec: h.startSec });
    lastStart = h.startSec;
  }
  return chosen;
}

export { CLIP_LEN as BROLL_CLIP_LEN };

// ---------------------------------------------------------------------------
// On-demand Drive resolution + disk cache.
// ---------------------------------------------------------------------------

const LISTING_TTL_MS = 60 * 60 * 1000; // 1h
const listingCache = new Map<string, { ids: string[]; ts: number }>();

function cacheDir(): string {
  return path.join(os.tmpdir(), "podcast-broll-cache");
}

async function listFolderFileIds(folderId: string): Promise<string[]> {
  const cached = listingCache.get(folderId);
  if (cached && Date.now() - cached.ts < LISTING_TTL_MS) return cached.ids;
  const files = await listDriveFolderVideosRecursive(folderId);
  const ids = files.map((f) => f.id).filter(Boolean);
  listingCache.set(folderId, { ids, ts: Date.now() });
  return ids;
}

/**
 * Resolve a category to a concrete local clip path, downloading a random clip
 * from its Drive folder (cached on disk by file id). Returns null on any
 * failure or when the folder is empty so the caller skips that cutaway.
 */
export async function resolveBrollClip(categoryId: string): Promise<string | null> {
  const cat = BROLL_CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) return null;
  try {
    const ids = await listFolderFileIds(cat.driveFolderId);
    if (ids.length === 0) return null;
    const fileId = ids[Math.floor(Math.random() * ids.length)];

    await fs.mkdir(cacheDir(), { recursive: true });
    const localPath = path.join(cacheDir(), `${fileId}.mp4`);
    try {
      const st = await fs.stat(localPath);
      if (st.size > 0) return localPath;
    } catch {
      // not cached yet
    }

    const resp = await getDriveFileStream(fileId);
    if (!resp.ok) {
      logger.warn(
        { categoryId, fileId, status: resp.status },
        "[podcast-broll] drive download failed",
      );
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0) return null;
    await fs.writeFile(localPath, buf);
    return localPath;
  } catch (err) {
    logger.warn(
      { categoryId, err: err instanceof Error ? err.message : String(err) },
      "[podcast-broll] resolve failed; skipping cutaway",
    );
    return null;
  }
}
