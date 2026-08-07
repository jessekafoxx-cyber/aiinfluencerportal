import { db } from "@workspace/db";
import { JobQueue } from "@workspace/job-queue";
import { CreditEngine } from "@workspace/billing-engine";
import { WorkflowRunner, type WorkflowRegistry } from "@workspace/automation-core";
import type { ProviderConfigStore, ProviderRegistry } from "@workspace/provider-adapters";
import { logger } from "../lib/logger";
import { buildAutomationCore } from "./workflows";

export interface AutomationRuntime {
  jobQueue: JobQueue;
  creditEngine: CreditEngine;
  runner: WorkflowRunner;
  workerId: string;
  adapters: ProviderRegistry;
  workflows: WorkflowRegistry;
  configStore: ProviderConfigStore;
}

let runtime: AutomationRuntime | null = null;

export function getAutomationRuntime(): AutomationRuntime {
  if (runtime) return runtime;
  const workerId = `${process.env["HOSTNAME"] ?? "api-server"}:${process.pid}`;
  const jobQueue = new JobQueue({ db });
  const creditEngine = new CreditEngine({ db });
  // Pass the shared JobQueue so the internal scheduler adapter can enqueue
  // delayed publish_post jobs against the same queue this runtime is draining.
  const { workflows, adapters, configStore } = buildAutomationCore({ jobQueue });
  const runner = new WorkflowRunner({
    db,
    jobQueue,
    creditEngine,
    workflows,
    adapters,
    workerId,
    log: (level, msg, meta) => logger[level]({ ...meta }, msg),
    isProviderDisabled: async (providerSlug) => {
      // Reads the (providerSlug, key='disabled') row from `provider_configs`
      // through the cached ProviderConfigStore. Admins toggle this via
      // PATCH /api/admin/automation/provider-configs/:id (audited).
      const v = await configStore.get<{ disabled?: boolean } | boolean>(
        providerSlug,
        "disabled",
      );
      if (v == null) return false;
      if (typeof v === "boolean") return v;
      return v.disabled === true;
    },
  });
  runtime = { jobQueue, creditEngine, runner, workerId, adapters, workflows, configStore };
  logger.info(
    { workerId, workflowCount: workflows.list().length, adapterCount: adapters.list().length },
    "Automation runtime initialized",
  );
  return runtime;
}
