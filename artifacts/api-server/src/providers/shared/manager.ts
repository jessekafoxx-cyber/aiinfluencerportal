// ─────────────────────────────────────────────────────────────────────────────
// Slice C: Provider manager.
//
// Single registry the orchestration engine talks to. In this slice the
// engine still pins each stage to one provider (higgsfield for base,
// enhancor for skin, gemini for scene swap) - the manager is the
// boundary that future routing/failover logic will sit behind.
//
// Capability matrix is exposed for future routing decisions; flags are
// scaffolded but NOT consumed yet.
// ─────────────────────────────────────────────────────────────────────────────

import { higgsfieldAdapter } from "../higgsfield/adapter";
import { enhancorAdapter } from "../enhancor/adapter";
import { geminiAdapter } from "../gemini/adapter";
import {
  flagsSnapshot,
  ENABLE_PROVIDER_FAILOVER,
  ENABLE_PROVIDER_ROUTING,
  ENABLE_PROVIDER_SCORING,
} from "./flags";
import { getReliabilitySnapshot } from "./reliability";
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderId,
} from "./types";

const REGISTRY: Record<ProviderId, ProviderAdapter<any, any, any>> = {
  higgsfield: higgsfieldAdapter,
  enhancor: enhancorAdapter,
  gemini: geminiAdapter,
};

export function getProvider<T extends ProviderId>(
  id: T,
): ProviderAdapter<any, any, any> {
  const adapter = REGISTRY[id];
  if (!adapter) {
    throw new Error(`Unknown provider id: ${id}`);
  }
  return adapter;
}

export function listProviders(): ProviderId[] {
  return Object.keys(REGISTRY) as ProviderId[];
}

export function capabilityMatrix(): Record<ProviderId, ProviderCapabilities> {
  const out: Record<string, ProviderCapabilities> = {};
  for (const id of listProviders()) {
    out[id] = REGISTRY[id].capabilities;
  }
  return out as Record<ProviderId, ProviderCapabilities>;
}

// Routing primitives (scaffolded - not consumed in this slice).
//
// Each stage of the pipeline declares its preferred provider chain.
// When ENABLE_PROVIDER_ROUTING flips on later, the engine will iterate
// this chain and call getProvider(id).submit(...) on each member until
// one succeeds. Today every chain is a single-element list pinning the
// current production provider so behavior stays identical.
export const STAGE_PROVIDER_CHAINS: Record<string, ProviderId[]> = {
  base_generation: ["higgsfield"],
  base_fallback: ["gemini"],
  enhancement: ["enhancor"],
  scene_swap: ["gemini"],
};

export function providerChainFor(stage: string): ProviderId[] {
  return STAGE_PROVIDER_CHAINS[stage] ?? [];
}

// Snapshot helper exposed for /healthz and admin endpoints.
export function providersSnapshot(): {
  providers: Array<{ id: ProviderId; capabilities: ProviderCapabilities }>;
  chains: Record<string, ProviderId[]>;
  flags: ReturnType<typeof flagsSnapshot>;
  reliability: ReturnType<typeof getReliabilitySnapshot>;
} {
  return {
    providers: listProviders().map((id) => ({
      id,
      capabilities: REGISTRY[id].capabilities,
    })),
    chains: STAGE_PROVIDER_CHAINS,
    flags: flagsSnapshot(),
    reliability: getReliabilitySnapshot(),
  };
}

// Re-export the flag values so a single import path covers everything.
export {
  ENABLE_PROVIDER_FAILOVER,
  ENABLE_PROVIDER_ROUTING,
  ENABLE_PROVIDER_SCORING,
};
