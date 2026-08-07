import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

const CONNECTOR_NAME = "elevenlabs";
export const SEARCH_TOOL_NAME = "search_greg_knowledge";

export class ElevenLabsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ElevenLabsConfigError";
  }
}

export function getElevenLabsAgentId(): string {
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!agentId) {
    throw new ElevenLabsConfigError(
      "ELEVENLABS_AGENT_ID is not set. Create a Conversational AI agent at https://elevenlabs.io/app/conversational-ai and store the agent_id in the ELEVENLABS_AGENT_ID environment variable.",
    );
  }
  return agentId;
}

export async function getSignedConversationUrl(agentId: string): Promise<string> {
  const path = `/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(agentId)}`;
  const res = await connectors.proxy(CONNECTOR_NAME, path, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ElevenLabs get_signed_url failed (${res.status}): ${text || res.statusText}`);
  }
  const data = (await res.json()) as { signed_url?: string };
  if (!data?.signed_url) {
    throw new Error("ElevenLabs get_signed_url returned no signed_url field");
  }
  return data.signed_url;
}

// ----------------------------------------------------------------------------
// Tool registration
// ----------------------------------------------------------------------------
// ElevenLabs Convai tools are first-class objects managed at /v1/convai/tools,
// then attached to an agent via PATCH /v1/convai/agents/:id with
// conversation_config.agent.prompt.tool_ids = [...].
//
// We keep this idempotent so the admin "Sync tool" button is safe to spam:
//  1. List tools, find one named search_greg_knowledge.
//  2. Build the desired tool config from the public API base URL.
//  3. Create or update the tool.
//  4. PATCH the agent to ensure its tool_ids include this tool.
// ----------------------------------------------------------------------------

interface ConvaiTool {
  id: string;
  tool_config?: { name?: string; type?: string };
  name?: string;
}

interface ConvaiAgent {
  agent_id: string;
  conversation_config?: {
    agent?: {
      prompt?: {
        tool_ids?: string[];
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

function buildSearchToolConfig(apiBaseUrl: string) {
  return {
    tool_config: {
      type: "webhook",
      name: SEARCH_TOOL_NAME,
      description:
        "Search Greg's knowledge base for relevant chunks from Greg's own content and named domain experts in his library. Call this when a user question goes beyond your default training (specific frameworks, named experts, recent uploads, exact numbers). Pass a clear, focused query string. Returns up to 5 attributed chunks with source name, expert context, and document URL — quote them with brief attribution.",
      api_schema: {
        url: `${apiBaseUrl.replace(/\/$/, "")}/api/voice-tools/search_greg_knowledge`,
        method: "POST",
        request_headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer {{user_token}}",
        },
        request_body_schema: {
          type: "object",
          required: ["query"],
          properties: {
            query: {
              type: "string",
              description: "A clear, focused question or topic to search for (e.g. 'Charlie Lawrance ad creative testing methodology').",
            },
            limit: {
              type: "integer",
              description: "Optional: number of chunks to return, 1 to 10 (default 5).",
            },
          },
        },
        response_timeout_secs: 20,
      },
      assignments: [
        {
          source: "response",
          dynamic_variable: "search_greg_knowledge_results",
          value_path: "results",
        },
      ],
    },
  };
}

async function elevenlabsRequest(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return connectors.proxy(CONNECTOR_NAME, path, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

// ----------------------------------------------------------------------------
// Voice library + speech-to-speech (Task #838 - Video Studio voice changer).
// ----------------------------------------------------------------------------

export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  category: string | null;
  previewUrl: string | null;
  labels: Record<string, string> | null;
}

/** List the ElevenLabs voice library available to this account. */
export async function listElevenLabsVoices(): Promise<ElevenLabsVoice[]> {
  const res = await elevenlabsRequest("/v1/voices");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ElevenLabs list voices failed (${res.status}): ${text || res.statusText}`);
  }
  const data = (await res.json()) as {
    voices?: Array<{
      voice_id?: string;
      name?: string;
      category?: string | null;
      preview_url?: string | null;
      labels?: Record<string, string> | null;
    }>;
  };
  return (data.voices ?? [])
    .filter((v) => !!v.voice_id)
    .map((v) => ({
      voiceId: v.voice_id!,
      name: v.name ?? v.voice_id!,
      category: v.category ?? null,
      previewUrl: v.preview_url ?? null,
      labels: v.labels ?? null,
    }));
}

/** Quick connectivity probe so routes can return a clean 503 when the
 * ElevenLabs connector is not configured. */
export async function isElevenLabsConfigured(): Promise<boolean> {
  try {
    const res = await connectors.proxy(CONNECTOR_NAME, "/v1/voices", { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Convert a recorded/uploaded audio clip into a target ElevenLabs voice via
 * the speech-to-speech endpoint. Returns the converted audio as an mp3 Buffer.
 * Sends multipart/form-data through the connector proxy; we must NOT set a
 * Content-Type header so undici injects the multipart boundary itself.
 */
export async function convertSpeechToSpeech(opts: {
  voiceId: string;
  audio: Buffer;
  contentType: string;
  fileName?: string;
  modelId?: string;
}): Promise<Buffer> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(opts.audio)], {
    type: opts.contentType || "application/octet-stream",
  });
  form.append("audio", blob, opts.fileName || "input.webm");
  form.append("model_id", opts.modelId || "eleven_multilingual_sts_v2");
  const path = `/v1/speech-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=mp3_44100_128`;
  const res = await connectors.proxy(CONNECTOR_NAME, path, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `ElevenLabs speech-to-speech failed (${res.status}): ${text || res.statusText}`,
    );
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function listTools(): Promise<ConvaiTool[]> {
  const res = await elevenlabsRequest("/v1/convai/tools");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ElevenLabs list tools failed (${res.status}): ${text || res.statusText}`);
  }
  const data = (await res.json()) as { tools?: ConvaiTool[] };
  return data.tools ?? [];
}

async function getAgent(agentId: string): Promise<ConvaiAgent> {
  const res = await elevenlabsRequest(`/v1/convai/agents/${encodeURIComponent(agentId)}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ElevenLabs get agent failed (${res.status}): ${text || res.statusText}`);
  }
  return (await res.json()) as ConvaiAgent;
}

export interface SyncToolResult {
  ok: true;
  toolId: string;
  created: boolean;
  attached: boolean;
  agentToolIds: string[];
  webhookUrl: string;
}

/**
 * Idempotently ensure the search_greg_knowledge tool exists in ElevenLabs and
 * is attached to the given agent. Safe to call repeatedly.
 */
export async function syncSearchGregKnowledgeTool(
  agentId: string,
  apiBaseUrl: string,
): Promise<SyncToolResult> {
  const desired = buildSearchToolConfig(apiBaseUrl);
  const tools = await listTools();
  const existing = tools.find((t) => {
    const name = t.tool_config?.name ?? t.name;
    return name === SEARCH_TOOL_NAME;
  });

  let toolId: string;
  let created = false;

  if (existing) {
    toolId = existing.id;
    const patchRes = await elevenlabsRequest(
      `/v1/convai/tools/${encodeURIComponent(toolId)}`,
      { method: "PATCH", body: desired },
    );
    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => "");
      throw new Error(`ElevenLabs update tool failed (${patchRes.status}): ${text || patchRes.statusText}`);
    }
  } else {
    const createRes = await elevenlabsRequest("/v1/convai/tools", {
      method: "POST",
      body: desired,
    });
    if (createRes.ok) {
      const created_ = (await createRes.json()) as { id?: string };
      if (!created_?.id) throw new Error("ElevenLabs create tool returned no id");
      toolId = created_.id;
      created = true;
    } else if (createRes.status === 409 || createRes.status === 422) {
      // Likely a concurrent create or duplicate-name conflict. Re-list and
      // adopt whatever already exists.
      const text = await createRes.text().catch(() => "");
      const refreshed = await listTools();
      const found = refreshed.find((t) => (t.tool_config?.name ?? t.name) === SEARCH_TOOL_NAME);
      if (!found) {
        throw new Error(`ElevenLabs create tool failed (${createRes.status}): ${text || createRes.statusText}`);
      }
      toolId = found.id;
      // Patch the rediscovered tool to ensure it matches our desired config.
      const patchRes = await elevenlabsRequest(
        `/v1/convai/tools/${encodeURIComponent(toolId)}`,
        { method: "PATCH", body: desired },
      );
      if (!patchRes.ok) {
        const ptext = await patchRes.text().catch(() => "");
        throw new Error(`ElevenLabs update existing tool after conflict failed (${patchRes.status}): ${ptext || patchRes.statusText}`);
      }
    } else {
      const text = await createRes.text().catch(() => "");
      throw new Error(`ElevenLabs create tool failed (${createRes.status}): ${text || createRes.statusText}`);
    }
  }

  // Attach to agent if not already. Re-fetch agent state right before the
  // PATCH so we merge into the freshest tool_ids list (still racy in the
  // strict CAS sense, but minimises the window to a single round-trip).
  const agent = await getAgent(agentId);
  const currentIds = agent.conversation_config?.agent?.prompt?.tool_ids ?? [];
  let attached = currentIds.includes(toolId);
  let nextIds = currentIds;
  if (!attached) {
    nextIds = [...currentIds, toolId];
    const patchAgentRes = await elevenlabsRequest(
      `/v1/convai/agents/${encodeURIComponent(agentId)}`,
      {
        method: "PATCH",
        body: {
          conversation_config: {
            agent: {
              prompt: { tool_ids: nextIds },
            },
          },
        },
      },
    );
    if (!patchAgentRes.ok) {
      const text = await patchAgentRes.text().catch(() => "");
      throw new Error(`ElevenLabs attach tool failed (${patchAgentRes.status}): ${text || patchAgentRes.statusText}`);
    }
    attached = true;
  }

  return {
    ok: true,
    toolId,
    created,
    attached,
    agentToolIds: nextIds,
    webhookUrl: desired.tool_config.api_schema.url,
  };
}

// ----------------------------------------------------------------------------
// Agent prompt + first message sync
// ----------------------------------------------------------------------------
// Idempotently writes Greg's persona prompt + first message into the live
// ElevenLabs agent. Also re-runs the tool sync so a single admin click fully
// rewires the voice agent. We declare every field we care about so the agent
// never drifts back to ElevenLabs defaults (e.g. "You are a helpful
// assistant.") if someone clicks Reset in their dashboard.

export interface SyncAgentConfigResult {
  ok: true;
  agentId: string;
  promptUpdated: boolean;
  firstMessageUpdated: boolean;
  tool: SyncToolResult;
}

export async function syncAgentConfig(
  agentId: string,
  apiBaseUrl: string,
  systemPrompt: string,
  firstMessage: string,
): Promise<SyncAgentConfigResult> {
  // Read current state so we can report whether anything actually changed and
  // so we can preserve existing tool_ids when we PATCH the prompt block.
  const before = await getAgent(agentId);
  const currentPrompt = (before.conversation_config?.agent?.prompt as any)?.prompt ?? "";
  const currentFirst = (before.conversation_config?.agent as any)?.first_message ?? "";

  const promptChanged = currentPrompt !== systemPrompt;
  const firstChanged = currentFirst !== firstMessage;

  if (promptChanged || firstChanged) {
    const patchRes = await elevenlabsRequest(
      `/v1/convai/agents/${encodeURIComponent(agentId)}`,
      {
        method: "PATCH",
        body: {
          conversation_config: {
            agent: {
              first_message: firstMessage,
              language: "en",
              prompt: { prompt: systemPrompt },
            },
          },
        },
      },
    );
    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => "");
      throw new Error(`ElevenLabs agent prompt update failed (${patchRes.status}): ${text || patchRes.statusText}`);
    }
  }

  // After updating prompt, ensure the tool is still attached (the PATCH above
  // does not touch tool_ids, but we re-run sync so a fresh agent gets fully
  // wired in one call).
  const tool = await syncSearchGregKnowledgeTool(agentId, apiBaseUrl);

  return {
    ok: true,
    agentId,
    promptUpdated: promptChanged,
    firstMessageUpdated: firstChanged,
    tool,
  };
}
