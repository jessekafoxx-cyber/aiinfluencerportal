import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  db,
  onboardingProfilesTable,
  aiInfluencersTable,
  influencerAnglesTable,
  influencerSettingsTable,
  settingImagesTable,
  type OnboardingProfile,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

const router: IRouter = Router();

const HIGGSFIELD_BASE_URL = "https://platform.higgsfield.ai";

interface OnboardingPostBody {
  gender?: string;
  ageRange?: string;
  age_range?: string;
  ethnicity?: string;
  brandColorTheme?: string;
  brandColor?: string;
  brand_color?: string;
  generatedName?: string;
  influencerName?: string;
  influencer_name?: string;
}

interface HiggsfieldWebhookBody {
  external_ref?: string;
  externalRef?: string;
  images?: Array<{ url?: string }>;
  imageUrl?: string;
  image_url?: string;
}

function higgsfieldHeaders(): Record<string, string> | null {
  const id = process.env.HIGGSFIELD_KEY_ID;
  const sec = process.env.HIGGSFIELD_KEY_SECRET;
  if (!id || !sec) return null;
  return {
    Authorization: `Key ${id}:${sec}`,
    "Content-Type": "application/json",
  };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || `influencer-${Date.now()}`
  );
}

async function dispatchHiggsfieldAvatar(
  profileId: number,
  prompt: string,
): Promise<string | null> {
  const headers = higgsfieldHeaders();
  if (!headers) {
    logger.warn(
      { profileId },
      "Higgsfield keys missing — skipping avatar dispatch",
    );
    return null;
  }
  try {
    // Higgsfield's actual text-to-image API uses /v1/text2image/{model}
    // with body { params: {...} } (Task #288 - the legacy
    // /v1/text-to-image path returns 404 "Model not found" against
    // current accounts). The profile id rides on the webhook URL as
    // a query param so the webhook handler can correlate the callback
    // back to its onboarding profile.
    const webhookUrl = `${process.env.PUBLIC_URL ?? ""}/api/onboarding/higgsfield-webhook?profile=${profileId}`;
    const res = await fetch(
      `${HIGGSFIELD_BASE_URL}/v1/text2image/soul?hf_webhook=${encodeURIComponent(webhookUrl)}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          params: {
            prompt,
            width_and_height: "1536x1536",
            quality: "1080p",
            batch_size: 1,
          },
          webhook: { url: webhookUrl },
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      logger.error(
        { profileId, status: res.status, text },
        "Higgsfield dispatch failed",
      );
      return null;
    }
    const json = (await res.json()) as { id?: string; request_id?: string };
    return json.request_id ?? json.id ?? null;
  } catch (err) {
    logger.error({ err, profileId }, "Higgsfield dispatch threw");
    return null;
  }
}

const ANGLE_PRESETS: Array<{ label: string; prompt: string }> = [
  { label: "Front", prompt: "Front-facing portrait, studio lighting." },
  { label: "Three-quarter", prompt: "Three-quarter portrait, soft side light." },
  { label: "Side", prompt: "Profile side portrait." },
  { label: "Back", prompt: "Back portrait, looking over shoulder." },
];

const SETTING_PRESETS: Array<{
  name: string;
  description: string;
  imageCount: number;
}> = [
  { name: "Studio", description: "Clean studio backdrop, neutral tones.", imageCount: 4 },
  { name: "Outdoor", description: "Natural outdoor setting, golden hour.", imageCount: 4 },
  { name: "Urban", description: "City streetscape, evening lights.", imageCount: 4 },
];

/**
 * Persist generated angles + settings + per-setting images for a freshly
 * built influencer. When Higgsfield returns derivative renders we will
 * replace these placeholder rows; until then they pin the avatar so the
 * detail page has content to render.
 */
async function persistDerivedAssets(
  influencerId: number,
  baseImageUrl: string,
): Promise<void> {
  await db
    .insert(influencerAnglesTable)
    .values(
      ANGLE_PRESETS.map((a, i) => ({
        influencerId,
        label: a.label,
        prompt: a.prompt,
        imageUrl: baseImageUrl,
        sortOrder: i,
      })),
    );

  for (const [sIdx, preset] of SETTING_PRESETS.entries()) {
    const [setting] = await db
      .insert(influencerSettingsTable)
      .values({
        influencerId,
        name: preset.name,
        description: preset.description,
        sortOrder: sIdx,
      })
      .returning();
    if (!setting) continue;
    await db.insert(settingImagesTable).values(
      Array.from({ length: preset.imageCount }, (_, i) => ({
        settingId: setting.id,
        imageUrl: baseImageUrl,
        label: `${preset.name} ${i + 1}`,
        sortOrder: i,
      })),
    );
  }
}

// POST /api/onboarding — create onboarding profile + dispatch Higgsfield avatar
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }

  const body = (req.body ?? {}) as OnboardingPostBody;
  const gender = String(body.gender ?? "person").trim();
  const ageRange = String(body.ageRange ?? body.age_range ?? "young adult").trim();
  const ethnicity = String(body.ethnicity ?? "diverse").trim();
  const brandColorTheme = String(
    body.brandColorTheme ?? body.brandColor ?? body.brand_color ?? "#C9A44C",
  ).trim();
  const generatedName = String(
    body.generatedName ??
      body.influencerName ??
      body.influencer_name ??
      `Influencer ${Date.now()}`,
  ).trim();
  const generatedSlug = `${slugify(generatedName)}-${Date.now().toString(36)}`;

  const prompt = `Photorealistic portrait of a ${ageRange} ${ethnicity} ${gender} for an AI influencer brand. Soft natural lighting, professional headshot.`;

  try {
    const [row] = await db
      .insert(onboardingProfilesTable)
      .values({
        clientId: userId,
        gender,
        ageRange,
        ethnicity,
        brandColorTheme,
        generatedName,
        generatedSlug,
        status: "pending",
        buildProgress: 10,
        buildLog: ["Profile created"],
      })
      .onConflictDoUpdate({
        target: onboardingProfilesTable.clientId,
        set: {
          gender,
          ageRange,
          ethnicity,
          brandColorTheme,
          generatedName,
          status: "pending",
          buildProgress: 10,
          buildLog: ["Profile updated"],
        },
      })
      .returning();
    if (!row) {
      res.status(500).json({ error: "internal_error" }); return;
    }

    const jobId = await dispatchHiggsfieldAvatar(row.id, prompt);
    if (jobId) {
      await db
        .update(onboardingProfilesTable)
        .set({
          higgsFieldJobId: jobId,
          status: "rendering",
          buildProgress: 40,
        })
        .where(eq(onboardingProfilesTable.id, row.id));
    }

    res.status(201).json({ profile: row, jobId }); return;
  } catch (err) {
    logger.error({ err }, "onboarding: create failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

// GET /api/onboarding/me
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
  try {
    const [row] = await db
      .select()
      .from(onboardingProfilesTable)
      .where(eq(onboardingProfilesTable.clientId, userId))
      .orderBy(desc(onboardingProfilesTable.id))
      .limit(1);
    res.json({ profile: row ?? null }); return;
  } catch (err) {
    logger.error({ err }, "onboarding: me failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

interface OnboardingStatusResponse {
  status: OnboardingProfile["status"] | "not_started";
  progress: number;
  log: string[];
  avatarUrl: string | null;
  profile: OnboardingProfile | null;
  influencerId: number | null;
}

// GET /api/onboarding/status — polled by /your-build
router.get("/status", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
  try {
    const [row] = await db
      .select()
      .from(onboardingProfilesTable)
      .where(eq(onboardingProfilesTable.clientId, userId))
      .orderBy(desc(onboardingProfilesTable.id))
      .limit(1);
    if (!row) {
      const r: OnboardingStatusResponse = {
        status: "not_started",
        progress: 0,
        log: [],
        avatarUrl: null,
        profile: null,
        influencerId: null,
      };
      res.json(r); return;
    }
    let influencerId: number | null = null;
    if (row.status === "complete") {
      const [inf] = await db
        .select({ id: aiInfluencersTable.id })
        .from(aiInfluencersTable)
        .where(eq(aiInfluencersTable.clientId, userId))
        .orderBy(desc(aiInfluencersTable.id))
        .limit(1);
      influencerId = inf?.id ?? null;
    }
    const r: OnboardingStatusResponse = {
      status: row.status,
      progress: row.buildProgress,
      log: row.buildLog ?? [],
      avatarUrl: row.avatarProfileUrl,
      profile: row,
      influencerId,
    };
    res.json(r); return;
  } catch (err) {
    logger.error({ err }, "onboarding: status failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

/**
 * Verify the Higgsfield webhook authenticity.
 *
 * - When `HIGGSFIELD_WEBHOOK_SECRET` is set we require either an
 *   HMAC-SHA256 signature header (`x-higgsfield-signature`) over the raw
 *   body, or a constant-time-compared shared secret in
 *   `x-higgsfield-secret`.
 * - When the secret is NOT set we still accept the webhook (so the only
 *   two required secrets remain `HIGGSFIELD_KEY_ID` +
 *   `HIGGSFIELD_KEY_SECRET`) but log a loud warning so operators see the
 *   open path.
 *
 * Returns true when the request should be processed.
 */
function verifyHiggsfieldWebhook(req: Request): boolean {
  const secret = process.env.HIGGSFIELD_WEBHOOK_SECRET;
  if (!secret) {
    // Secure-by-default: in production we refuse unsigned webhooks. In
    // development we accept and log a loud warning so the only mandatory
    // secrets remain HIGGSFIELD_KEY_ID + HIGGSFIELD_KEY_SECRET while
    // iterating locally.
    if (process.env.NODE_ENV === "production") {
      logger.error(
        "Higgsfield webhook REJECTED in production — HIGGSFIELD_WEBHOOK_SECRET is not set",
      );
      return false;
    }
    logger.warn(
      "Higgsfield webhook accepted WITHOUT signature verification (NODE_ENV !== production) — set HIGGSFIELD_WEBHOOK_SECRET to enable spoof protection",
    );
    return true;
  }
  const sigHeader = req.header("x-higgsfield-signature");
  const sharedHeader = req.header("x-higgsfield-secret");
  const rawBuf: Buffer =
    req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), "utf8");

  if (sigHeader) {
    const expected = createHmac("sha256", secret).update(rawBuf).digest("hex");
    try {
      const a = Buffer.from(expected, "hex");
      const b = Buffer.from(sigHeader.replace(/^sha256=/, ""), "hex");
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
  if (sharedHeader) {
    const a = Buffer.from(secret);
    const b = Buffer.from(sharedHeader);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  return false;
}

// POST /api/onboarding/higgsfield-webhook — NO Clerk auth (signed by Higgsfield).
router.post(
  "/higgsfield-webhook",
  async (req: Request, res: Response) => {
    if (!verifyHiggsfieldWebhook(req)) {
      logger.warn("Higgsfield webhook signature/secret mismatch");
      res.status(401).json({ error: "invalid_signature" }); return;
    }

    const body = (req.body ?? {}) as HiggsfieldWebhookBody;
    const imageUrl: string | null =
      body?.images?.[0]?.url ?? body?.imageUrl ?? body?.image_url ?? null;
    // Profile correlation: prefer the ?profile=<id> query param we set
    // on the webhook URL at dispatch time (Task #288 - the current
    // Higgsfield text2image API does not echo a custom external_ref).
    // Fall back to the legacy numeric external_ref body field for any
    // in-flight callbacks queued by the previous code path.
    const rawProfile = req.query.profile;
    const profileQs = Array.isArray(rawProfile)
      ? String(rawProfile[0] ?? "")
      : String(rawProfile ?? "");
    const externalRef = String(body.external_ref ?? body.externalRef ?? "");
    const profileSrc = profileQs || externalRef;
    if (!profileSrc) {
      res.status(400).json({ error: "missing_profile" }); return;
    }
    try {
      const profileId = Number(profileSrc);
      if (!Number.isFinite(profileId)) {
        res.status(400).json({ error: "invalid_profile" }); return;
      }
      const [profile] = await db
        .select()
        .from(onboardingProfilesTable)
        .where(eq(onboardingProfilesTable.id, profileId))
        .limit(1);
      if (!profile) { res.status(404).json({ error: "not_found" }); return; }

      await db
        .update(onboardingProfilesTable)
        .set({
          status: imageUrl ? "complete" : "failed",
          buildProgress: imageUrl ? 100 : profile.buildProgress,
          avatarProfileUrl: imageUrl ?? profile.avatarProfileUrl,
          completedAt: imageUrl ? new Date() : null,
        })
        .where(eq(onboardingProfilesTable.id, profileId));

      if (imageUrl) {
        const [influencer] = await db
          .insert(aiInfluencersTable)
          .values({
            clientId: profile.clientId,
            name: profile.generatedName,
            avatarUrl: imageUrl,
            status: "active",
          })
          .returning();
        if (influencer) {
          await persistDerivedAssets(influencer.id, imageUrl).catch((err) =>
            logger.error(
              { err, influencerId: influencer.id },
              "onboarding: persist derived assets failed",
            ),
          );
        }
      }
      res.json({ ok: true }); return;
    } catch (err) {
      logger.error({ err }, "onboarding: webhook failed");
      res.status(500).json({ error: "internal_error" }); return;
    }
  },
);

export default router;
