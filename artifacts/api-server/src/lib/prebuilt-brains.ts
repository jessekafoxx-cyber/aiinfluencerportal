// Curated "pre-built brains" Room30 portal users can pick instead of writing
// their own positioning from scratch. Each entry stands in for an offer they
// can promote (starting with our own AI Influencer Portfolio). The OS tool
// generators read brainData/generatedBrain when a user has brainMode='prebuilt'
// so every output (research docs, low-ticket builds, ads, VSLs, etc.) is
// scoped to that offer.
//
// Storage model: brains live in the `prebuilt_brains` table. The admin CRUD
// UI has been retired, so the catalog is now driven entirely by the seed
// payload below (and any rows already present). The canonical seed payload
// (`AI_INFLUENCER_PORTFOLIO_SEED`) is imported from the shared
// `@workspace/prebuilt-brains-seed` lib - the same module used by the SQL
// seed migration (lib/db/migrations/0054_t550_seed_ai_influencer_portfolio.sql)
// and the DFY scripts seeder, so all three sources of truth stay in sync.
// `refreshPrebuiltBrainsCache()` upserts the seed (insert-if-missing) on
// first boot so a fresh database (or a transient DB outage at boot) still
// ships the flagship offer.
//
// To keep call sites simple, the public read API stays synchronous: brains
// are loaded into an in-memory cache at boot via `refreshPrebuiltBrainsCache`
// (called from index.ts) and refreshed after every admin write. If a request
// somehow hits before the cache is populated we fall back to the seed array
// so the user-facing picker is never empty.

import { db, prebuiltBrainsTable, prebuiltBrainDocumentsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { AI_INFLUENCER_PORTFOLIO_SEED } from "@workspace/prebuilt-brains-seed";
import { logger } from "./logger.js";

export interface PrebuiltBrain {
  id: string;
  name: string;
  tagline: string;
  shortDescription: string;
  audience: string;
  highlights: string[];
  badge?: string | null;
  comingSoon?: boolean;
  brainData: {
    name: string;
    companyName: string;
    whoDoYouHelp: string;
    howDoYouHelpThem: string;
    keyAchievements: string;
  };
  generatedBrain: string;
  sourceNotes?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

// Canonical seed payload, shared with the DFY scripts seeder and the SQL seed
// migration via `@workspace/prebuilt-brains-seed` so all three sources of
// truth stay in sync.
const SEED_BRAINS: PrebuiltBrain[] = [AI_INFLUENCER_PORTFOLIO_SEED];

// In-memory cache. Populated by refreshPrebuiltBrainsCache() at boot and after
// every admin write. Stays SYNC-readable so the 17+ existing call sites in
// portal.ts / low-ticket-funnel.ts / high-ticket-funnel.ts / user-context.ts
// don't need to be turned async.
let cache: PrebuiltBrain[] = [...SEED_BRAINS];
let cacheLoaded = false;

function rowToBrain(row: any): PrebuiltBrain {
  const data = (row.brainData ?? {}) as Partial<PrebuiltBrain["brainData"]>;
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline ?? "",
    shortDescription: row.shortDescription ?? "",
    audience: row.audience ?? "",
    highlights: Array.isArray(row.highlights) ? row.highlights : [],
    badge: row.badge ?? null,
    comingSoon: !!row.comingSoon,
    brainData: {
      name: data.name ?? "",
      companyName: data.companyName ?? "",
      whoDoYouHelp: data.whoDoYouHelp ?? "",
      howDoYouHelpThem: data.howDoYouHelpThem ?? "",
      keyAchievements: data.keyAchievements ?? "",
    },
    generatedBrain: row.generatedBrain ?? "",
    sourceNotes: row.sourceNotes ?? null,
    sortOrder: row.sortOrder ?? 0,
    isActive: row.isActive !== false,
  };
}

function brainToInsert(b: PrebuiltBrain) {
  return {
    id: b.id,
    name: b.name,
    tagline: b.tagline,
    shortDescription: b.shortDescription,
    audience: b.audience,
    highlights: b.highlights,
    badge: b.badge ?? null,
    comingSoon: !!b.comingSoon,
    brainData: b.brainData,
    generatedBrain: b.generatedBrain,
    sourceNotes: b.sourceNotes ?? null,
    sortOrder: b.sortOrder ?? 0,
    isActive: b.isActive !== false,
  };
}

const LEGACY_BRAND_MARKERS = ["greg cooke", "greg's", "room30", "room 30"];
export async function refreshPrebuiltBrainsCache(): Promise<void> {
  try {
    for (const seed of SEED_BRAINS) {
      await db
        .insert(prebuiltBrainsTable)
        .values(brainToInsert(seed))
        .onConflictDoNothing({ target: prebuiltBrainsTable.id });
    }
    // White-label rebrand: rows seeded before the rebrand still carry the
    // old founder/brand names in copy members can read. Rewrite ONLY those
    // rows (matched on the legacy tokens) from the seed, so admin edits made
    // after the rebrand are never clobbered.
    await refreshLegacyBrandedSeedRows();
    const rows = await db
      .select()
      .from(prebuiltBrainsTable)
      .orderBy(asc(prebuiltBrainsTable.sortOrder), asc(prebuiltBrainsTable.name));
    cache = rows.map(rowToBrain);
    cacheLoaded = true;
    logger.info({ count: cache.length }, "prebuilt-brains: cache loaded");
  } catch (err) {
    logger.error({ err }, "prebuilt-brains: failed to load cache, using seed");
    if (!cacheLoaded) {
      cache = [...SEED_BRAINS];
    }
  }
}

export function getPrebuiltBrain(id: string | null | undefined): PrebuiltBrain | null {
  if (!id) return null;
  return cache.find((b) => b.id === id) || null;
}

// Resolves the "effective" brain a user's OS tools should generate against.
// If the user has brainMode='prebuilt' with a valid catalog id, the curated
// brain's positioning + generatedBrain replace whatever sits on their own row
// (so every downstream prompt sells the curated offer). Otherwise the row is
// returned unchanged. Other own-brain fields (confirmedLowTicketOffer, brand
// colours, etc.) are preserved either way so users keep their saved offers.
export function resolveEffectiveBrain<T extends Record<string, any> | null | undefined>(
  brainRow: T,
  _portalKey?: string | null,
): T {
  if (!brainRow) return brainRow;
  const row: any = brainRow;
  if (row.brainMode !== "prebuilt") return brainRow;
  const prebuilt = getPrebuiltBrain(row.selectedPrebuiltBrainId);
  if (!prebuilt) return brainRow;
  return {
    ...row,
    name: prebuilt.brainData.name,
    companyName: prebuilt.brainData.companyName,
    whoDoYouHelp: prebuilt.brainData.whoDoYouHelp,
    howDoYouHelpThem: prebuilt.brainData.howDoYouHelpThem,
    keyAchievements: prebuilt.brainData.keyAchievements,
    generatedBrain: prebuilt.generatedBrain,
    status: "generated",
  } as T;
}

// Display-only projection sent to the portal. Strips the heavy generatedBrain
// markdown so the catalog endpoint stays small. Hides inactive brains.
export function listPrebuiltBrainsForClient() {
  return cache
    .filter((b) => b.isActive !== false)
    .map((b) => ({
      id: b.id,
      name: b.name,
      tagline: b.tagline,
      shortDescription: b.shortDescription,
      audience: b.audience,
      highlights: b.highlights,
      badge: b.badge ?? null,
      comingSoon: !!b.comingSoon,
    }));
}

// Admin-facing list - returns all brains (active + inactive) with full body.
export async function adminListPrebuiltBrains() {
  const rows = await db
    .select()
    .from(prebuiltBrainsTable)
    .orderBy(asc(prebuiltBrainsTable.sortOrder), asc(prebuiltBrainsTable.name));
  return rows.map(rowToBrain);
}

export async function adminGetPrebuiltBrain(id: string) {
  const [row] = await db.select().from(prebuiltBrainsTable).where(eq(prebuiltBrainsTable.id, id));
  if (!row) return null;
  const docs = await db
    .select()
    .from(prebuiltBrainDocumentsTable)
    .where(eq(prebuiltBrainDocumentsTable.brainId, id))
    .orderBy(asc(prebuiltBrainDocumentsTable.id));
  return { brain: rowToBrain(row), documents: docs };
}

function hasLegacyBranding(row: any): boolean {
  const haystack = [
    row?.name,
    row?.tagline,
    row?.shortDescription,
    row?.audience,
    row?.generatedBrain,
    JSON.stringify(row?.brainData ?? {}),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return LEGACY_BRAND_MARKERS.some((m) => haystack.includes(m));
}

async function refreshLegacyBrandedSeedRows(): Promise<void> {
  for (const seed of SEED_BRAINS) {
    try {
      const [row] = await db
        .select()
        .from(prebuiltBrainsTable)
        .where(eq(prebuiltBrainsTable.id, seed.id));
      if (!row || !hasLegacyBranding(row)) continue;
      const next = brainToInsert(seed);
      await db
        .update(prebuiltBrainsTable)
        .set({
          name: next.name,
          tagline: next.tagline,
          shortDescription: next.shortDescription,
          audience: next.audience,
          highlights: next.highlights,
          brainData: next.brainData,
          generatedBrain: next.generatedBrain,
        })
        .where(eq(prebuiltBrainsTable.id, seed.id));
      logger.info({ id: seed.id }, "prebuilt-brains: re-seeded legacy-branded row");
    } catch (err) {
      logger.error(
        { err: (err as Error).message, id: seed.id },
        "prebuilt-brains: failed to re-seed legacy-branded row",
      );
    }
  }
}
