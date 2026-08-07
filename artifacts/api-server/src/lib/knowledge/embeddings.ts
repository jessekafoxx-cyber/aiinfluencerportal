import OpenAI from "openai";

const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIM = 1536;
const BATCH_SIZE = 96;

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (_client) return _client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is required for knowledge base embeddings.");
  }
  _client = new OpenAI({ apiKey: key });
  return _client;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const slice = texts.slice(i, i + BATCH_SIZE).map((t) => t.slice(0, 8000));
    const res = await client().embeddings.create({
      model: EMBED_MODEL,
      input: slice,
    });
    for (const item of res.data) {
      out.push(item.embedding as number[]);
    }
  }
  return out;
}

export async function embedText(text: string): Promise<number[]> {
  const [v] = await embedBatch([text]);
  return v ?? new Array(EMBED_DIM).fill(0);
}

const CHUNK_TARGET_CHARS = 1800; // ~450 tokens
const CHUNK_OVERLAP_CHARS = 200;

export function chunkText(raw: string): string[] {
  const cleaned = raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned.length <= CHUNK_TARGET_CHARS) {
    return cleaned.length > 0 ? [cleaned] : [];
  }
  // Split by paragraph then accumulate to target size.
  const paragraphs = cleaned.split(/\n\n+/);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    const para = p.trim();
    if (!para) continue;
    if (para.length > CHUNK_TARGET_CHARS) {
      if (buf) {
        chunks.push(buf.trim());
        buf = "";
      }
      // Hard-split very long paragraphs into sliding windows.
      let pos = 0;
      while (pos < para.length) {
        chunks.push(para.slice(pos, pos + CHUNK_TARGET_CHARS));
        pos += CHUNK_TARGET_CHARS - CHUNK_OVERLAP_CHARS;
      }
      continue;
    }
    if (buf.length + para.length + 2 > CHUNK_TARGET_CHARS) {
      chunks.push(buf.trim());
      buf = para;
    } else {
      buf = buf ? `${buf}\n\n${para}` : para;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter((c) => c.length > 30);
}

export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
