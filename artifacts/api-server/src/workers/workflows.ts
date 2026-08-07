import { db } from "@workspace/db";
import { JobQueue } from "@workspace/job-queue";
import {
  WorkflowRegistry,
  buildBuiltinWorkflows,
} from "@workspace/automation-core";
import {
  ProviderConfigStore,
  ProviderRegistry,
  ClaudeAdapter,
  HiggsfieldAdapter,
  HeygenAdapter,
  GeminiAdapter,
  FalAdapter,
  CreatomateAdapter,
  BlotatoAdapter,
  ResendAdapter,
  ApifyAdapter,
} from "@workspace/provider-adapters";
import type {
  ClaudeClientLike,
  ResendClientLike,
} from "@workspace/provider-adapters";
import { InternalSchedulerAdapter } from "./internal-adapters";

export interface BuiltAutomationCore {
  configStore: ProviderConfigStore;
  adapters: ProviderRegistry;
  workflows: WorkflowRegistry;
}

export interface BuildAutomationCoreOptions {
  jobQueue?: JobQueue;
}

/**
 * Builds the automation core. Adapters that require external clients
 * (Claude/Anthropic, Resend) are registered with no-op getClient functions
 * that throw when invoked — they will never be exercised at runtime in this
 * deployment unless their respective workflows are scheduled.
 */
export function buildAutomationCore(
  opts: BuildAutomationCoreOptions = {},
): BuiltAutomationCore {
  const configStore = new ProviderConfigStore({ db });
  const adapters = new ProviderRegistry();

  adapters.register(
    new ClaudeAdapter({
      configStore,
      getClient: (): ClaudeClientLike => {
        throw new Error(
          "Claude/Anthropic client is not configured in this deployment",
        );
      },
    }),
  );
  adapters.register(new HiggsfieldAdapter({ configStore }));
  adapters.register(new HeygenAdapter({ configStore }));
  adapters.register(new GeminiAdapter({ configStore }));
  adapters.register(new FalAdapter({ configStore }));
  adapters.register(new CreatomateAdapter({ configStore }));
  adapters.register(new BlotatoAdapter({ configStore }));
  adapters.register(
    new ResendAdapter({
      configStore,
      getClient: async (): Promise<{
        client: ResendClientLike;
        fromEmail: string;
      }> => {
        throw new Error("Resend client is not configured in this deployment");
      },
    }),
  );
  adapters.register(
    new ApifyAdapter({
      configStore,
      transformRunInput: async (actorId, runInput) => {
        const { withInstagramSessionCookies } = await import(
          "../lib/instagram-session-cookies"
        );
        return withInstagramSessionCookies(actorId, runInput);
      },
    }),
  );

  const jobQueue = opts.jobQueue ?? new JobQueue({ db });
  adapters.register(new InternalSchedulerAdapter({ jobQueue }));

  const workflows = new WorkflowRegistry();
  for (const def of buildBuiltinWorkflows({ db, jobQueue })) {
    workflows.register(def);
  }
  return { configStore, adapters, workflows };
}

export { WorkflowRegistry, ProviderRegistry, ProviderConfigStore };
