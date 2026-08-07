import type {
  NormalizedError,
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderResult,
  ProviderStatus,
} from "../types";
import { ProviderConfigurationError, ProviderValidationError } from "../types";
import type { ProviderConfigStore } from "../provider-config";

const APIFY_BASE_URL = "https://api.apify.com/v2";

export interface ApifyInput {
  actorId?: string;
  runInput?: Record<string, unknown>;
  estimatedCredits?: number;
}

export interface ApifyOutput {
  runId: string;
  datasetId?: string;
  items: unknown[];
}

export interface ApifyAdapterOptions {
  configStore: ProviderConfigStore;
  fetchImpl?: typeof fetch;
  // Optional hook that lets the host application transform the Apify
  // run input right before it is POSTed. Used by the api-server host to
  // inject admin-managed Instagram session cookies (loginCookies /
  // sessionCookies) for Instagram actors so no scrape path runs
  // anonymously. Must never throw - failures fall back to original input.
  transformRunInput?: (
    actorId: string,
    runInput: Record<string, unknown>,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

function token(): string {
  const t = process.env["APIFY_TOKEN"] ?? process.env["APIFY_API_TOKEN"];
  if (!t) {
    throw new ProviderConfigurationError(
      "apify",
      "APIFY_TOKEN (or APIFY_API_TOKEN) environment variable is required",
    );
  }
  return t;
}

export class ApifyAdapter implements ProviderAdapter<ApifyInput, ApifyOutput> {
  readonly slug = "apify";
  private readonly configStore: ProviderConfigStore;
  private readonly fetchImpl: typeof fetch;
  private readonly transformRunInput?: ApifyAdapterOptions["transformRunInput"];

  constructor(opts: ApifyAdapterOptions) {
    this.configStore = opts.configStore;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.transformRunInput = opts.transformRunInput;
  }

  estimateCost(input: ApifyInput): number {
    return typeof input.estimatedCredits === "number" && input.estimatedCredits >= 0
      ? input.estimatedCredits
      : 1;
  }

  async validateInput(input: ApifyInput): Promise<void> {
    token();
    const actorId =
      input.actorId ??
      (await this.configStore.get<string | null>("apify", "default_actor_id"));
    if (!actorId) {
      throw new ProviderValidationError(
        "apify",
        "actorId is required (provide on input or set provider_configs apify/default_actor_id)",
      );
    }
  }

  async execute(
    input: ApifyInput,
    _ctx: ProviderExecutionContext,
  ): Promise<ProviderResult<ApifyOutput>> {
    await this.validateInput(input);
    const actorId =
      input.actorId ??
      (await this.configStore.require<string>("apify", "default_actor_id"));
    const t = token();
    let runInput: Record<string, unknown> = input.runInput ?? {};
    if (this.transformRunInput) {
      try {
        runInput = await this.transformRunInput(actorId, runInput);
      } catch {
        // Ignore - fall back to original input rather than fail the run.
      }
    }
    const startResp = await this.fetchImpl(
      `${APIFY_BASE_URL}/acts/${encodeURIComponent(actorId)}/runs?token=${encodeURIComponent(t)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(runInput),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!startResp.ok) {
      const text = await startResp.text();
      throw new Error(`Apify run start failed (${startResp.status}): ${text}`);
    }
    const startData = (await startResp.json()) as { data?: { id?: string } };
    const runId = startData.data?.id;
    if (!runId) throw new Error("Apify run start returned no run id");
    return {
      status: "waiting_provider",
      externalRef: runId,
      pollAfterMs: 10_000,
    };
  }

  async getStatus(externalRef: string): Promise<ProviderStatus<ApifyOutput>> {
    const t = token();
    const statusResp = await this.fetchImpl(
      `${APIFY_BASE_URL}/actor-runs/${externalRef}?token=${encodeURIComponent(t)}`,
      { method: "GET", signal: AbortSignal.timeout(15_000) },
    );
    if (!statusResp.ok) return { status: "pending", pollAfterMs: 10_000 };
    const data = (await statusResp.json()) as {
      data?: { status?: string; defaultDatasetId?: string };
    };
    const s = (data.data?.status ?? "").toUpperCase();
    if (s === "SUCCEEDED") {
      const datasetId = data.data?.defaultDatasetId;
      let items: unknown[] = [];
      if (datasetId) {
        const itemsResp = await this.fetchImpl(
          `${APIFY_BASE_URL}/datasets/${datasetId}/items?token=${encodeURIComponent(t)}&format=json`,
          { method: "GET", signal: AbortSignal.timeout(30_000) },
        );
        if (itemsResp.ok) {
          items = (await itemsResp.json()) as unknown[];
        }
      }
      return {
        status: "completed",
        output: { runId: externalRef, datasetId, items },
      };
    }
    if (s === "FAILED" || s === "ABORTED" || s === "TIMED-OUT") {
      return {
        status: "failed",
        errorCode: `APIFY_${s.replace(/-/g, "_")}`,
        errorMessage: `Apify run ${s.toLowerCase()}`,
        retryable: s !== "FAILED",
      };
    }
    return { status: "pending", pollAfterMs: 10_000 };
  }

  normalizeError(err: unknown): NormalizedError {
    if (err instanceof ProviderConfigurationError || err instanceof ProviderValidationError) {
      return { errorCode: err.code, errorMessage: err.message, retryable: false };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { errorCode: "APIFY_ERROR", errorMessage: msg, retryable: true };
  }
}
