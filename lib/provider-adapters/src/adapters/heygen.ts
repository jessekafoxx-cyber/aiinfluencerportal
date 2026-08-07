import type {
  NormalizedError,
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderResult,
  ProviderStatus,
  ProviderWebhookUpdate,
} from "../types";
import { ProviderConfigurationError, ProviderValidationError } from "../types";
import type { ProviderConfigStore } from "../provider-config";

const HEYGEN_BASE_URL = "https://api.heygen.com";

export interface HeygenVideoInput {
  script: string;
  avatarId?: string;
  voiceId?: string;
  background?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  estimatedCredits?: number;
}

export interface HeygenVideoOutput {
  videoUrl: string;
  videoId: string;
  duration?: number;
  /**
   * True when HeyGen burned captions/subtitles into the rendered video.
   * Downstream workflows (e.g. `full_daily_ai_post`) use this to skip a
   * second caption-render pass through Creatomate.
   */
  captionsBurnedIn?: boolean;
}

export interface HeygenAdapterOptions {
  configStore: ProviderConfigStore;
  fetchImpl?: typeof fetch;
}

function authHeaders(): Record<string, string> {
  const apiKey = process.env["HEYGEN_API_KEY"];
  if (!apiKey) {
    throw new ProviderConfigurationError(
      "heygen",
      "HEYGEN_API_KEY environment variable is required",
    );
  }
  return {
    "X-Api-Key": apiKey,
    "Content-Type": "application/json",
  };
}

export class HeygenAdapter
  implements ProviderAdapter<HeygenVideoInput, HeygenVideoOutput>
{
  readonly slug = "heygen";
  private readonly configStore: ProviderConfigStore;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HeygenAdapterOptions) {
    this.configStore = opts.configStore;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  estimateCost(input: HeygenVideoInput): number {
    if (typeof input.estimatedCredits === "number" && input.estimatedCredits >= 0) {
      return input.estimatedCredits;
    }
    // Roughly 5 credits per minute of script (~150 words/min).
    const words = (input.script ?? "").trim().split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(0.25, words / 150);
    return Math.max(5, Math.ceil(minutes * 5));
  }

  async validateInput(input: HeygenVideoInput): Promise<void> {
    if (!input.script || input.script.trim().length === 0) {
      throw new ProviderValidationError("heygen", "script is required");
    }
    authHeaders();
    const avatarId =
      input.avatarId ?? (await this.configStore.get<string | null>("heygen", "default_avatar_id"));
    const voiceId =
      input.voiceId ?? (await this.configStore.get<string | null>("heygen", "default_voice_id"));
    if (!avatarId) {
      throw new ProviderValidationError(
        "heygen",
        "avatarId is required (provide on input or set provider_configs heygen/default_avatar_id)",
      );
    }
    if (!voiceId) {
      throw new ProviderValidationError(
        "heygen",
        "voiceId is required (provide on input or set provider_configs heygen/default_voice_id)",
      );
    }
  }

  async execute(
    input: HeygenVideoInput,
    _ctx: ProviderExecutionContext,
  ): Promise<ProviderResult<HeygenVideoOutput>> {
    await this.validateInput(input);
    const avatarId =
      input.avatarId ?? (await this.configStore.require<string>("heygen", "default_avatar_id"));
    const voiceId =
      input.voiceId ?? (await this.configStore.require<string>("heygen", "default_voice_id"));

    const ratioMap: Record<string, { dimension: { width: number; height: number } }> = {
      "16:9": { dimension: { width: 1920, height: 1080 } },
      "9:16": { dimension: { width: 1080, height: 1920 } },
      "1:1": { dimension: { width: 1080, height: 1080 } },
    };
    const dimension = ratioMap[input.aspectRatio ?? "9:16"] ?? ratioMap["9:16"]!;

    const resp = await this.fetchImpl(`${HEYGEN_BASE_URL}/v2/video/generate`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        video_inputs: [
          {
            character: { type: "avatar", avatar_id: avatarId, avatar_style: "normal" },
            voice: { type: "text", input_text: input.script, voice_id: voiceId },
            background: input.background
              ? { type: "color", value: input.background }
              : { type: "color", value: "#FFFFFF" },
          },
        ],
        dimension: dimension.dimension,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`HeyGen video generate failed (${resp.status}): ${text}`);
    }
    const data = (await resp.json()) as { data?: { video_id?: string } };
    const videoId = data.data?.video_id;
    if (!videoId) {
      throw new Error("HeyGen video generate succeeded but did not return a video_id");
    }
    return {
      status: "waiting_provider",
      externalRef: videoId,
      pollAfterMs: 15_000,
    };
  }

  async getStatus(externalRef: string): Promise<ProviderStatus<HeygenVideoOutput>> {
    const resp = await this.fetchImpl(
      `${HEYGEN_BASE_URL}/v1/video_status.get?video_id=${encodeURIComponent(externalRef)}`,
      { method: "GET", headers: authHeaders(), signal: AbortSignal.timeout(15000) },
    );
    if (!resp.ok) {
      return { status: "pending", pollAfterMs: 15_000 };
    }
    const data = (await resp.json()) as {
      data?: { status?: string; video_url?: string; duration?: number; error?: { message?: string } };
    };
    const status = (data.data?.status ?? "").toLowerCase();
    if (status === "completed" || status === "succeeded") {
      const videoUrl = data.data?.video_url;
      if (!videoUrl) {
        return {
          status: "failed",
          errorCode: "HEYGEN_NO_VIDEO_URL",
          errorMessage: "completed but missing video_url",
          retryable: true,
        };
      }
      return {
        status: "completed",
        output: { videoUrl, videoId: externalRef, duration: data.data?.duration },
      };
    }
    if (status === "failed") {
      return {
        status: "failed",
        errorCode: "HEYGEN_FAILED",
        errorMessage: data.data?.error?.message ?? "HeyGen reported failed",
        retryable: false,
      };
    }
    return { status: "pending", pollAfterMs: 15_000 };
  }

  handleWebhook(payload: unknown): ProviderWebhookUpdate<HeygenVideoOutput> | null {
    if (!payload || typeof payload !== "object") return null;
    const body = payload as {
      event_type?: string;
      event_data?: { video_id?: string; url?: string; error?: { message?: string } };
    };
    const videoId = body.event_data?.video_id;
    if (!videoId) return null;
    if (body.event_type === "avatar_video.success") {
      const url = body.event_data?.url;
      if (!url) {
        return {
          externalRef: videoId,
          status: "failed",
          errorCode: "HEYGEN_NO_VIDEO_URL",
          errorMessage: "success webhook missing url",
          retryable: true,
          dedupeKey: `heygen:${videoId}:success`,
        };
      }
      return {
        externalRef: videoId,
        status: "completed",
        output: { videoUrl: url, videoId },
        dedupeKey: `heygen:${videoId}:success`,
      };
    }
    if (body.event_type === "avatar_video.fail") {
      return {
        externalRef: videoId,
        status: "failed",
        errorCode: "HEYGEN_FAILED",
        errorMessage: body.event_data?.error?.message ?? "HeyGen reported failed",
        retryable: false,
        dedupeKey: `heygen:${videoId}:fail`,
      };
    }
    return null;
  }

  normalizeError(err: unknown): NormalizedError {
    if (err instanceof ProviderConfigurationError || err instanceof ProviderValidationError) {
      return { errorCode: err.code, errorMessage: err.message, retryable: false };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/401|403|invalid api key/i.test(msg)) {
      return { errorCode: "HEYGEN_AUTH", errorMessage: msg, retryable: false };
    }
    return { errorCode: "HEYGEN_ERROR", errorMessage: msg, retryable: true };
  }
}
