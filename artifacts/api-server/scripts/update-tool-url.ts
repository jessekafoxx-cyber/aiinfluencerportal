// One-off: re-point the search_greg_knowledge tool at the current REPLIT_DEV_DOMAIN.
// Run after a smoke test that left the tool pointing at example.com, or to
// re-sync if the public URL changed.
import { syncSearchGregKnowledgeTool, getElevenLabsAgentId } from "../src/lib/elevenlabs";

const baseUrl =
  process.env.PUBLIC_API_BASE_URL ||
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null);
if (!baseUrl) {
  console.error("Set PUBLIC_API_BASE_URL or REPLIT_DEV_DOMAIN");
  process.exit(1);
}

const agentId = getElevenLabsAgentId();
const result = await syncSearchGregKnowledgeTool(agentId, baseUrl);
console.log(JSON.stringify(result, null, 2));
process.exit(0);
