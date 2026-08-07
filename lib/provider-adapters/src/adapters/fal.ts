import type {
  NormalizedError,
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderResult,
  ProviderStatus,
} from "../types";
import { ProviderConfigurationError, ProviderValidationError } from "../types";
import type { ProviderConfigStore } from "../provider-config";

const FAL_BASE_URL = "https://queue.fal.run";

export interface FalImageInput {
  prompt: string;
  model?: string;
  imageSize?: string;
  estimatedCredits?: number;
}

export interface FalImageOutput {
  images: Array<{ url: string; width?: number; height?: number }>;
  externalRef: string;
}

export interface FalAdapterOptions {
  configStore: ProviderConfigStore;
  fetchImpl?: typeof fetch;
}

function authHeaders(): Record<string, string> {
  const apiKey = process.env["FAL_KEY"] ?? process.env["FAL_API_KEY"];
  if (!apiKey) {
    throw new ProviderConfigurationError(
      "fal",
      "FAL_KEY (or FAL_API_KEY) environment variable is required",
    );
  }
  return {
    Authorization: `Key ${apiKey}`,
    "Content-Type": "application/json",
  };
}

export class FalAdapter implements ProviderAdapter<FalImageInput, FalImageOutput> {
  readonly slug = "fal";
  private readonly configStore: ProviderConfigStore;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: FalAdapterOptions) {
    this.configStore = opts.configStore;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  estimateCost(input: FalImageInput): number {
    return typeof input.estimatedCredits === "number" && input.estimatedCredits >= 0
      ? input.estimatedCredits
      : 1;
  }

  validateInput(input: FalImageInput): void {
    if (!input.prompt || input.prompt.trim().length === 0) {
      throw new ProviderValidationError("fal", "prompt is required");
    }
    authHeaders();
  }

  async execute(
    input: FalImageInput,
    _ctx: ProviderExecutionContext,
  ): Promise<ProviderResult<FalImageOutput>> {
    this.validateInput(input);
    const model =
      input.model ??
      ((await this.configStore.get<string>("fal", "default_model")) ?? "fal-ai/flux/schnell");
    const resp = await this.fetchImpl(`${FAL_BASE_URL}/${model}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ prompt: input.prompt, image_size: input.imageSize ?? "square_hd" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`fal submit failed (${resp.status}): ${text}`);
    }
    const data = (await resp.json()) as { request_id?: string };
    if (!data.request_id) {
      throw new Error("fal submit succeeded without request_id");
    }
    return {
      status: "waiting_provider",
      externalRef: `${model}::${data.request_id}`,
      pollAfterMs: 3000,
    };
  }

  async getStatus(externalRef: string): Promise<ProviderStatus<FalImageOutput>> {
    const [model, requestId] = externalRef.split("::");
    if (!model || !requestId) {
      return {
        status: "failed",
        errorCode: "FAL_BAD_REF",
        errorMessage: `malformed externalRef '${externalRef}'`,
        retryable: false,
      };
    }
    const statusResp = await this.fetchImpl(
      `${FAL_BASE_URL}/${model}/requests/${requestId}/status`,
      { method: "GET", headers: authHeaders(), signal: AbortSignal.timeout(15_000) },
    );
    if (!statusResp.ok) return { status: "pending", pollAfterMs: 5000 };
    const statusData = (await statusResp.json()) as { status?: string };
    const s = (statusData.status ?? "").toUpperCase();
    if (s === "COMPLETED") {
      const resultResp = await this.fetchImpl(
        `${FAL_BASE_URL}/${model}/requests/${requestId}`,
        { method: "GET", headers: authHeaders(), signal: AbortSignal.timeout(15_000) },
      );
      if (!resultResp.ok) {
        return {
          status: "failed",
          errorCode: "FAL_RESULT_FETCH_FAILED",
          errorMessage: `(${resultResp.status})`,
          retryable: true,
        };
      }
      const resultData = (await resultResp.json()) as { images?: FalImageOutput["images"] };
      return {
        status: "completed",
        output: { images: resultData.images ?? [], externalRef },
      };
    }
    if (s === "FAILED" || s === "CANCELLED") {
      return {
        status: "failed",
        errorCode: `FAL_${s}`,
        errorMessage: `fal job ${s.toLowerCase()}`,
        retryable: false,
      };
    }
    return { status: "pending", pollAfterMs: 3000 };
  }

  normalizeError(err: unknown): NormalizedError {
    if (err instanceof ProviderConfigurationError || err instanceof ProviderValidationError) {
      return { errorCode: err.code, errorMessage: err.message, retryable: false };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { errorCode: "FAL_ERROR", errorMessage: msg, retryable: true };
  }
}
