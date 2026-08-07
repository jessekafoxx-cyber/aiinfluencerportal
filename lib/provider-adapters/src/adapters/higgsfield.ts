import type {
  NormalizedError,
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderResult,
  ProviderStatus,
} from "../types";
import { ProviderConfigurationError, ProviderValidationError } from "../types";
import type { ProviderConfigStore } from "../provider-config";

const HIGGSFIELD_BASE_URL = "https://platform.higgsfield.ai";
const FALLBACK_TEXT_TO_IMAGE_MODEL = "google/nano-banana-pro/text-to-image";
const FALLBACK_ANGLES_MODEL = "qwen/image-edit-plus-lora";

export type HiggsfieldOpKind = "text_to_image" | "angles";

export interface HiggsfieldInput {
  op: HiggsfieldOpKind;
  prompt?: string;
  imageUrl?: string;
  resolution?: string;
  aspectRatio?: string;
  rotateRightLeft?: number;
  moveForward?: number;
  verticalAngle?: number;
  wideAngleLens?: boolean;
  estimatedCredits?: number;
}

export interface HiggsfieldOutput {
  status: string;
  images: Array<{ url: string }>;
  externalRef?: string;
}

export interface HiggsfieldAdapterOptions {
  configStore: ProviderConfigStore;
  /**
   * Default credit cost when an input does not specify estimatedCredits.
   * Defaults: text_to_image = 1, angles = 1.
   */
  defaultCreditCostPerOp?: Partial<Record<HiggsfieldOpKind, number>>;
  fetchImpl?: typeof fetch;
}

function authHeaders(): Record<string, string> {
  const keyId = process.env.HIGGSFIELD_KEY_ID;
  const keySecret = process.env.HIGGSFIELD_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new ProviderConfigurationError(
      "higgsfield",
      "HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET environment variables are required",
    );
  }
  return {
    Authorization: `Key ${keyId}:${keySecret}`,
    "Content-Type": "application/json",
  };
}

export class HiggsfieldAdapter
  implements ProviderAdapter<HiggsfieldInput, HiggsfieldOutput>
{
  readonly slug = "higgsfield";
  private readonly configStore: ProviderConfigStore;
  private readonly defaults: Partial<Record<HiggsfieldOpKind, number>>;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HiggsfieldAdapterOptions) {
    this.configStore = opts.configStore;
    this.defaults = opts.defaultCreditCostPerOp ?? {};
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async resolveModel(op: HiggsfieldOpKind): Promise<string> {
    if (op === "text_to_image") {
      const v = await this.configStore.get<string>("higgsfield", "text_to_image_model");
      return v && v.length > 0 ? v : FALLBACK_TEXT_TO_IMAGE_MODEL;
    }
    const v = await this.configStore.get<string>("higgsfield", "angles_model");
    return v && v.length > 0 ? v : FALLBACK_ANGLES_MODEL;
  }

  async resolveDefaults(): Promise<{ resolution: string; aspectRatio: string }> {
    const resolution =
      (await this.configStore.get<string>("higgsfield", "default_resolution")) ?? "2K";
    const aspectRatio =
      (await this.configStore.get<string>("higgsfield", "default_aspect_ratio")) ?? "1:1";
    return { resolution, aspectRatio };
  }

  estimateCost(input: HiggsfieldInput): number {
    if (typeof input.estimatedCredits === "number" && input.estimatedCredits >= 0) {
      return input.estimatedCredits;
    }
    return this.defaults[input.op] ?? 1;
  }

  validateInput(input: HiggsfieldInput): void {
    if (!input.op || (input.op !== "text_to_image" && input.op !== "angles")) {
      throw new ProviderValidationError("higgsfield", `Unknown op '${String(input.op)}'`);
    }
    if (input.op === "text_to_image" && (!input.prompt || input.prompt.trim().length === 0)) {
      throw new ProviderValidationError("higgsfield", "text_to_image requires non-empty prompt");
    }
    if (input.op === "angles") {
      if (!input.imageUrl || input.imageUrl.trim().length === 0) {
        throw new ProviderValidationError("higgsfield", "angles requires non-empty imageUrl");
      }
      if (typeof input.rotateRightLeft !== "number") {
        throw new ProviderValidationError("higgsfield", "angles requires rotateRightLeft (number)");
      }
      if (typeof input.verticalAngle !== "number") {
        throw new ProviderValidationError("higgsfield", "angles requires verticalAngle (number)");
      }
      if (typeof input.moveForward !== "number") {
        throw new ProviderValidationError("higgsfield", "angles requires moveForward (number)");
      }
    }
    // Will throw ProviderConfigurationError if creds missing.
    authHeaders();
  }

  async execute(
    input: HiggsfieldInput,
    _ctx: ProviderExecutionContext,
  ): Promise<ProviderResult<HiggsfieldOutput>> {
    await this.validateInput(input);
    const model = await this.resolveModel(input.op);
    const defaults = await this.resolveDefaults();

    let body: Record<string, unknown>;
    if (input.op === "text_to_image") {
      body = {
        prompt: input.prompt,
        resolution: input.resolution ?? defaults.resolution,
        aspect_ratio: input.aspectRatio ?? defaults.aspectRatio,
      };
    } else {
      body = {
        images_list: [input.imageUrl],
        rotate_right_left: input.rotateRightLeft,
        move_forward: input.moveForward,
        vertical_angle: input.verticalAngle,
        wide_angle_lens: input.wideAngleLens ?? false,
      };
    }

    const submitResp = await this.fetchImpl(`${HIGGSFIELD_BASE_URL}/applications/${model}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!submitResp.ok) {
      const text = await submitResp.text();
      throw new Error(`Higgsfield submit failed (${submitResp.status}): ${text}`);
    }
    const submitData = (await submitResp.json()) as { request_id: string };
    return {
      status: "waiting_provider",
      externalRef: submitData.request_id,
      pollAfterMs: 3000,
      metadata: { op: input.op, model },
    };
  }

  async getStatus(externalRef: string): Promise<ProviderStatus<HiggsfieldOutput>> {
    const statusResp = await this.fetchImpl(
      `${HIGGSFIELD_BASE_URL}/requests/${externalRef}/status`,
      {
        method: "GET",
        headers: authHeaders(),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!statusResp.ok) {
      return {
        status: "pending",
        pollAfterMs: 5000,
      };
    }
    const statusData = (await statusResp.json()) as { status?: string };
    const raw = (statusData.status ?? "").toLowerCase();
    if (raw === "completed") {
      const resultResp = await this.fetchImpl(
        `${HIGGSFIELD_BASE_URL}/requests/${externalRef}/result`,
        {
          method: "GET",
          headers: authHeaders(),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!resultResp.ok) {
        return {
          status: "failed",
          errorCode: "HIGGSFIELD_RESULT_FETCH_FAILED",
          errorMessage: `Result fetch failed (${resultResp.status})`,
          retryable: true,
        };
      }
      const resultData = (await resultResp.json()) as HiggsfieldOutput;
      return {
        status: "completed",
        output: { ...resultData, externalRef },
      };
    }
    if (raw === "failed" || raw === "cancelled") {
      return {
        status: "failed",
        errorCode: `HIGGSFIELD_${raw.toUpperCase()}`,
        errorMessage: `Image generation ${raw}`,
        retryable: false,
      };
    }
    if (raw === "nsfw") {
      return {
        status: "failed",
        errorCode: "HIGGSFIELD_NSFW",
        errorMessage: "Image flagged as NSFW",
        retryable: false,
      };
    }
    return { status: "pending", pollAfterMs: 3000 };
  }

  normalizeError(err: unknown): NormalizedError {
    if (err instanceof ProviderConfigurationError) {
      return { errorCode: err.code, errorMessage: err.message, retryable: false };
    }
    if (err instanceof ProviderValidationError) {
      return { errorCode: err.code, errorMessage: err.message, retryable: false };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/nsfw/i.test(msg)) {
      return { errorCode: "HIGGSFIELD_NSFW", errorMessage: msg, retryable: false };
    }
    if (/404|not found|model not found/i.test(msg)) {
      return {
        errorCode: "HIGGSFIELD_MODEL_NOT_FOUND",
        errorMessage: msg,
        retryable: false,
      };
    }
    return { errorCode: "HIGGSFIELD_ERROR", errorMessage: msg, retryable: true };
  }
}
