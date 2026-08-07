import type {
  NormalizedError,
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderResult,
} from "../types";
import { ProviderConfigurationError, ProviderValidationError } from "../types";
import type { ProviderConfigStore } from "../provider-config";

export interface ResendEmailInput {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  estimatedCredits?: number;
}

export interface ResendEmailOutput {
  emailId: string;
  to: string[];
}

export interface ResendClientLike {
  emails: {
    send(payload: {
      from: string;
      to: string[];
      subject: string;
      html?: string;
      text?: string;
    }): Promise<{ data?: { id?: string } | null; error?: { message?: string } | null }>;
  };
}

export interface ResendAdapterOptions {
  configStore: ProviderConfigStore;
  /**
   * Returns a Resend client and the from email. The api-server has its own
   * Replit-connector backed accessor (`getUncachableResendClient`) so we
   * accept it as an injected factory rather than instantiating Resend here.
   */
  getClient: () => Promise<{ client: ResendClientLike; fromEmail: string }>;
}

export class ResendAdapter
  implements ProviderAdapter<ResendEmailInput, ResendEmailOutput>
{
  readonly slug = "resend";
  private readonly configStore: ProviderConfigStore;
  private readonly getClient: ResendAdapterOptions["getClient"];

  constructor(opts: ResendAdapterOptions) {
    this.configStore = opts.configStore;
    this.getClient = opts.getClient;
  }

  estimateCost(input: ResendEmailInput): number {
    return typeof input.estimatedCredits === "number" && input.estimatedCredits >= 0
      ? input.estimatedCredits
      : 0;
  }

  validateInput(input: ResendEmailInput): void {
    if (!input.to || (Array.isArray(input.to) && input.to.length === 0)) {
      throw new ProviderValidationError("resend", "to is required");
    }
    if (!input.subject || input.subject.trim().length === 0) {
      throw new ProviderValidationError("resend", "subject is required");
    }
    if (!input.html && !input.text) {
      throw new ProviderValidationError("resend", "html or text body is required");
    }
  }

  async execute(
    input: ResendEmailInput,
    _ctx: ProviderExecutionContext,
  ): Promise<ProviderResult<ResendEmailOutput>> {
    this.validateInput(input);
    let client: ResendClientLike;
    let defaultFrom: string;
    try {
      const got = await this.getClient();
      client = got.client;
      defaultFrom = got.fromEmail;
    } catch (err) {
      throw new ProviderConfigurationError(
        "resend",
        err instanceof Error ? err.message : String(err),
      );
    }
    const fromConfig = await this.configStore.get<string>("resend", "from_email");
    const from = input.from ?? fromConfig ?? defaultFrom;
    const to = Array.isArray(input.to) ? input.to : [input.to];
    const result = await client.emails.send({
      from,
      to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (result.error || !result.data?.id) {
      throw new Error(`Resend send failed: ${result.error?.message ?? "no id returned"}`);
    }
    return {
      status: "completed",
      output: { emailId: result.data.id, to },
      externalRef: result.data.id,
    };
  }

  normalizeError(err: unknown): NormalizedError {
    if (err instanceof ProviderConfigurationError || err instanceof ProviderValidationError) {
      return { errorCode: err.code, errorMessage: err.message, retryable: false };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/401|403|invalid api key/i.test(msg)) {
      return { errorCode: "RESEND_AUTH", errorMessage: msg, retryable: false };
    }
    return { errorCode: "RESEND_ERROR", errorMessage: msg, retryable: true };
  }
}
