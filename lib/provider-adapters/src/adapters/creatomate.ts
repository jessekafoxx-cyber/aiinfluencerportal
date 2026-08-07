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

const CREATOMATE_BASE_URL = "https://api.creatomate.com/v1";

export interface CreatomateRenderInput {
  templateId?: string;
  modifications: Record<string, unknown>;
  estimatedCredits?: number;
}

export interface CreatomateRenderOutput {
  url: string;
  renderId: string;
}

export interface CreatomateAdapterOptions {
  configStore: ProviderConfigStore;
  fetchImpl?: typeof fetch;
}

function authHeaders(): Record<string, string> {
  const apiKey = process.env["CREATOMATE_API_KEY"];
  if (!apiKey) {
    throw new ProviderConfigurationError(
      "creatomate",
      "CREATOMATE_API_KEY environment variable is required",
    );
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

export class CreatomateAdapter
  implements ProviderAdapter<CreatomateRenderInput, CreatomateRenderOutput>
{
  readonly slug = "creatomate";
  private readonly configStore: ProviderConfigStore;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CreatomateAdapterOptions) {
    this.configStore = opts.configStore;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  estimateCost(input: CreatomateRenderInput): number {
    return typeof input.estimatedCredits === "number" && input.estimatedCredits >= 0
      ? input.estimatedCredits
      : 2;
  }

  async validateInput(input: CreatomateRenderInput): Promise<void> {
    if (!input.modifications || typeof input.modifications !== "object") {
      throw new ProviderValidationError("creatomate", "modifications object is required");
    }
    authHeaders();
    const templateId =
      input.templateId ??
      (await this.configStore.get<string | null>("creatomate", "default_template_id"));
    if (!templateId) {
      throw new ProviderValidationError(
        "creatomate",
        "templateId is required (provide on input or set provider_configs creatomate/default_template_id)",
      );
    }
  }

  async execute(
    input: CreatomateRenderInput,
    _ctx: ProviderExecutionContext,
  ): Promise<ProviderResult<CreatomateRenderOutput>> {
    await this.validateInput(input);
    const templateId =
      input.templateId ??
      (await this.configStore.require<string>("creatomate", "default_template_id"));
    const resp = await this.fetchImpl(`${CREATOMATE_BASE_URL}/renders`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ template_id: templateId, modifications: input.modifications }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Creatomate render failed (${resp.status}): ${text}`);
    }
    const data = (await resp.json()) as
      | Array<{ id: string; status: string; url?: string }>
      | { id: string; status: string; url?: string };
    const first = Array.isArray(data) ? data[0] : data;
    if (!first?.id) {
      throw new Error("Creatomate render submitted but missing render id");
    }
    const status = (first.status ?? "").toLowerCase();
    if (status === "succeeded" && first.url) {
      return {
        status: "completed",
        output: { url: first.url, renderId: first.id },
        externalRef: first.id,
      };
    }
    return {
      status: "waiting_provider",
      externalRef: first.id,
      pollAfterMs: 8000,
    };
  }

  async getStatus(externalRef: string): Promise<ProviderStatus<CreatomateRenderOutput>> {
    const resp = await this.fetchImpl(`${CREATOMATE_BASE_URL}/renders/${externalRef}`, {
      method: "GET",
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return { status: "pending", pollAfterMs: 8000 };
    const data = (await resp.json()) as { status?: string; url?: string; error_message?: string };
    const s = (data.status ?? "").toLowerCase();
    if (s === "succeeded" && data.url) {
      return {
        status: "completed",
        output: { url: data.url, renderId: externalRef },
      };
    }
    if (s === "failed") {
      return {
        status: "failed",
        errorCode: "CREATOMATE_FAILED",
        errorMessage: data.error_message ?? "render failed",
        retryable: false,
      };
    }
    return { status: "pending", pollAfterMs: 8000 };
  }

  handleWebhook(payload: unknown): ProviderWebhookUpdate<CreatomateRenderOutput> | null {
    if (!payload || typeof payload !== "object") return null;
    const body = payload as { id?: string; status?: string; url?: string; error_message?: string };
    if (!body.id) return null;
    const s = (body.status ?? "").toLowerCase();
    if (s === "succeeded" && body.url) {
      return {
        externalRef: body.id,
        status: "completed",
        output: { url: body.url, renderId: body.id },
        dedupeKey: `creatomate:${body.id}:succeeded`,
      };
    }
    if (s === "failed") {
      return {
        externalRef: body.id,
        status: "failed",
        errorCode: "CREATOMATE_FAILED",
        errorMessage: body.error_message ?? "render failed",
        retryable: false,
        dedupeKey: `creatomate:${body.id}:failed`,
      };
    }
    return null;
  }

  normalizeError(err: unknown): NormalizedError {
    if (err instanceof ProviderConfigurationError || err instanceof ProviderValidationError) {
      return { errorCode: err.code, errorMessage: err.message, retryable: false };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { errorCode: "CREATOMATE_ERROR", errorMessage: msg, retryable: true };
  }
}
