import type {
  NormalizedError,
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderResult,
} from "../types";
import { ProviderConfigurationError, ProviderValidationError } from "../types";
import type { ProviderConfigStore } from "../provider-config";

export interface ClaudeMessageInput {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  /**
   * If provided, overrides the default credit cost estimate. Otherwise the
   * adapter falls back to roughly 1 credit per 1k completion tokens (rounded
   * up), based on `maxTokens`.
   */
  estimatedCredits?: number;
}

export interface ClaudeMessageOutput {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface ClaudeMessageRaw {
  model: string;
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface ClaudeClientLike {
  messages: {
    create(payload: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
    }): Promise<ClaudeMessageRaw>;
  };
}

export interface ClaudeAdapterOptions {
  configStore: ProviderConfigStore;
  /**
   * Returns an Anthropic-compatible client. The api-server has its own
   * `@workspace/integrations-anthropic-ai` accessor; the adapter is decoupled
   * to keep this lib self-contained and easy to test.
   */
  getClient: () => Promise<ClaudeClientLike> | ClaudeClientLike;
}

export class ClaudeAdapter
  implements ProviderAdapter<ClaudeMessageInput, ClaudeMessageOutput>
{
  readonly slug = "claude";
  private readonly configStore: ProviderConfigStore;
  private readonly getClient: ClaudeAdapterOptions["getClient"];

  constructor(opts: ClaudeAdapterOptions) {
    this.configStore = opts.configStore;
    this.getClient = opts.getClient;
  }

  estimateCost(input: ClaudeMessageInput): number {
    if (typeof input.estimatedCredits === "number" && input.estimatedCredits >= 0) {
      return input.estimatedCredits;
    }
    const max = input.maxTokens ?? 1024;
    return Math.max(1, Math.ceil(max / 1000));
  }

  validateInput(input: ClaudeMessageInput): void {
    if (!input.prompt || input.prompt.trim().length === 0) {
      throw new ProviderValidationError("claude", "prompt is required");
    }
  }

  async resolveDefaults(): Promise<{ model: string; maxTokens: number }> {
    const model =
      (await this.configStore.get<string>("claude", "default_model")) ?? "claude-sonnet-4-6";
    const maxTokens =
      (await this.configStore.get<number>("claude", "default_max_tokens")) ?? 4096;
    return { model, maxTokens };
  }

  async execute(
    input: ClaudeMessageInput,
    _ctx: ProviderExecutionContext,
  ): Promise<ProviderResult<ClaudeMessageOutput>> {
    this.validateInput(input);
    const defaults = await this.resolveDefaults();
    let client: ClaudeClientLike;
    try {
      client = await this.getClient();
    } catch (err) {
      throw new ProviderConfigurationError(
        "claude",
        err instanceof Error ? err.message : String(err),
      );
    }
    const message = await client.messages.create({
      model: input.model ?? defaults.model,
      max_tokens: input.maxTokens ?? defaults.maxTokens,
      system: input.systemPrompt,
      messages: [{ role: "user", content: input.prompt }],
    });
    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n\n");
    const inputTokens = message.usage?.input_tokens ?? 0;
    const outputTokens = message.usage?.output_tokens ?? 0;
    const actualCostCredits = Math.max(1, Math.ceil(outputTokens / 1000));
    return {
      status: "completed",
      output: { text, inputTokens, outputTokens, model: message.model },
      actualCostCredits,
      metadata: { inputTokens, outputTokens },
    };
  }

  normalizeError(err: unknown): NormalizedError {
    if (err instanceof ProviderValidationError) {
      return { errorCode: err.code, errorMessage: err.message, retryable: false };
    }
    if (err instanceof ProviderConfigurationError) {
      return { errorCode: err.code, errorMessage: err.message, retryable: false };
    }
    const msg = err instanceof Error ? err.message : String(err);
    const status =
      typeof (err as { status?: unknown })?.status === "number"
        ? (err as { status: number }).status
        : undefined;
    if (status === 400 || status === 401 || status === 403 || status === 422) {
      return { errorCode: `CLAUDE_${status}`, errorMessage: msg, retryable: false };
    }
    if (status === 429 || status === 502 || status === 503 || status === 504) {
      return { errorCode: `CLAUDE_${status}`, errorMessage: msg, retryable: true };
    }
    return { errorCode: "CLAUDE_ERROR", errorMessage: msg, retryable: true };
  }
}