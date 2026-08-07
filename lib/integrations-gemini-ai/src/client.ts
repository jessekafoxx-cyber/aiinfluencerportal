import { GoogleGenAI } from "@google/genai";

const integrationApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
const integrationBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const directApiKey = process.env.GEMINI_API_KEY;

const apiKey = integrationApiKey || directApiKey;

if (!apiKey) {
  throw new Error(
    "No Gemini API key found. Set AI_INTEGRATIONS_GEMINI_API_KEY (via Replit AI integration) or GEMINI_API_KEY in Secrets.",
  );
}

const clientOptions: ConstructorParameters<typeof GoogleGenAI>[0] = { apiKey };

if (integrationBaseUrl && integrationApiKey) {
  clientOptions.httpOptions = {
    apiVersion: "",
    baseUrl: integrationBaseUrl,
  };
}

export const ai = new GoogleGenAI(clientOptions);
