import type {
  NormalizedError,
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderResult,
} from "../types";
import { ProviderConfigurationError, ProviderValidationError } from "../types";
import type { ProviderConfigStore } from "../provider-config";

const BLOTATO_BASE_URL = "https://backend.blotato.com/v2";

export interface BlotatoPostInput {
  /** Identifier of the user's social account in Blotato. */
  accountId: string;
  /** Platform slug (e.g. "tiktok", "instagram", "youtube_shorts"). */
  platform: string;
  caption: string;
  videoUrl?: string;
  imageUrl?: string;
  hashtags?: string[];
  estimatedCredits?: number;
}

export interface BlotatoPostOutput {
  postId: string;
  platform: string;
  postUrl?: string;
}

export interface BlotatoAdapterOptions {
  configStore: ProviderConfigStore;
  fetchImpl?: typeof fetch;
}

function authHeaders(): Record<string, string> {
  const apiKey = process.env["BLOTATO_API_KEY"];
  if (!apiKey) {
    throw new ProviderConfigurationError(
      "blotato",
      "BLOTATO_API_KEY environment variable is required",
    );
  }
  return {
    "blotato-api-key": apiKey,
    "Content-Type": "application/json",
  };
}

export class BlotatoAdapter
  implements ProviderAdapter<BlotatoPostInput, BlotatoPostOutput>
{
  readonly slug = "blotato";
  private readonly configStore: ProviderConfigStore;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BlotatoAdapterOptions) {
    this.configStore = opts.configStore;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  estimateCost(input: BlotatoPostInput): number {
    return typeof input.estimatedCredits === "number" && input.estimatedCredits >= 0
      ? input.estimatedCredits
      : 1;
  }

  validateInput(input: BlotatoPostInput): void {
    if (!input.accountId) throw new ProviderValidationError("blotato", "accountId is required");
    if (!input.platform) throw new ProviderValidationError("blotato", "platform is required");
    if (!input.caption) throw new ProviderValidationError("blotato", "caption is required");
    if (!input.videoUrl && !input.imageUrl) {
      throw new ProviderValidationError(
        "blotato",
        "videoUrl or imageUrl is required",
      );
    }
    authHeaders();
  }

  async execute(
    input: BlotatoPostInput,
    _ctx: ProviderExecutionContext,
  ): Promise<ProviderResult<BlotatoPostOutput>> {
    this.validateInput(input);
    const defaultKind =
      (await this.configStore.get<string>("blotato", "default_post_kind")) ?? "video";
    const fullCaption = input.hashtags && input.hashtags.length > 0
      ? `${input.caption}\n\n${input.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}`
      : input.caption;
    const body = {
      account_id: input.accountId,
      platform: input.platform,
      kind: input.videoUrl ? "video" : "image",
      content: {
        text: fullCaption,
        media_url: input.videoUrl ?? input.imageUrl,
        default_kind: defaultKind,
      },
    };
    const resp = await this.fetchImpl(`${BLOTATO_BASE_URL}/posts`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Blotato post failed (${resp.status}): ${text}`);
    }
    const data = (await resp.json()) as { id?: string; post_url?: string };
    if (!data.id) {
      throw new Error("Blotato post submitted but missing id");
    }
    return {
      status: "completed",
      output: { postId: data.id, platform: input.platform, postUrl: data.post_url },
      externalRef: data.id,
    };
  }

  normalizeError(err: unknown): NormalizedError {
    if (err instanceof ProviderConfigurationError || err instanceof ProviderValidationError) {
      return { errorCode: err.code, errorMessage: err.message, retryable: false };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/401|403|invalid api key/i.test(msg)) {
      return { errorCode: "BLOTATO_AUTH", errorMessage: msg, retryable: false };
    }
    if (/429|rate limit/i.test(msg)) {
      return { errorCode: "BLOTATO_RATE_LIMIT", errorMessage: msg, retryable: true };
    }
    return { errorCode: "BLOTATO_ERROR", errorMessage: msg, retryable: true };
  }
}
