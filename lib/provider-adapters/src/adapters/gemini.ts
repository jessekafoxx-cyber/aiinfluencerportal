import type {
  NormalizedError,
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderResult,
} from "../types";
import { ProviderConfigurationError, ProviderValidationError } from "../types";
import type { ProviderConfigStore } from "../provider-config";

export interface GeminiInput {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  estimatedCredits?: number;
}

export interface GeminiOutput {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface GeminiAdapterOptions {
  configStore: ProviderConfigStore;
  fetchImpl?: typeof fetch;
}

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiAdapter implements ProviderAdapter<GeminiInput, GeminiOutput> {
  readonly slug = "gemini";
  private readonly configStore: ProviderConfigStore;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GeminiAdapterOptions) {
    this.configStore = opts.configStore;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  estimateCost(input: GeminiInput): number {
    if (typeof input.estimatedCredits === "number" && input.estimatedCredits >= 0) {
      return input.estimatedCredits;
    }
    return Math.max(1, Math.ceil((input.maxTokens ?? 1024) / 1500));
  }

  validateInput(input: GeminiInput): void {
    if (!input.prompt || input.prompt.trim().length === 0) {
      throw new ProviderValidationError("gemini", "prompt is required");
    }
    if (!process.env["GEMINI_API_KEY"]) {
      throw new ProviderConfigurationError(
        "gemini",
        "GEMINI_API_KEY environment variable is required",
      );
    }
  }

  async execute(
    input: GeminiInput,
    _ctx: ProviderExecutionContext,
  ): Promise<ProviderResult<GeminiOutput>> {
    this.validateInput(input);
    const model =
      input.model ??
      ((await this.configStore.get<string>("gemini", "default_model")) ?? "gemini-2.5-flash");
    const apiKey = process.env["GEMINI_API_KEY"]!;
    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: input.prompt }],
        },
      ],
      ...(input.systemPrompt
        ? { systemInstruction: { role: "system", parts: [{ text: input.systemPrompt }] } }
        : {}),
      generationConfig: {
        maxOutputTokens: input.maxTokens ?? 1024,
      },
    };
    const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const resp = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Gemini generateContent failed (${resp.status}): ${text}`);
    }
    const data = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("\n") ?? "";
    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
    return {
      status: "completed",
      output: { text, model, inputTokens, outputTokens },
      actualCostCredits: Math.max(1, Math.ceil(outputTokens / 1500)),
      metadata: { inputTokens, outputTokens },
    };
  }

  normalizeError(err: unknown): NormalizedError {
    if (err instanceof ProviderConfigurationError || err instanceof ProviderValidationError) {
      return { errorCode: err.code, errorMessage: err.message, retryable: false };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/401|403|api key/i.test(msg)) {
      return { errorCode: "GEMINI_AUTH", errorMessage: msg, retryable: false };
    }
    if (/429|quota|rate limit/i.test(msg)) {
      return { errorCode: "GEMINI_RATE_LIMIT", errorMessage: msg, retryable: true };
    }
    return { errorCode: "GEMINI_ERROR", errorMessage: msg, retryable: true };
  }
}
