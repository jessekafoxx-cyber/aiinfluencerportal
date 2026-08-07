// safeJson: read a fetch Response without crashing on non-JSON bodies.
// AI endpoints (vision, long generation) can take 30-60s and a proxy or
// gateway sometimes returns an HTML error page instead of our JSON.
// Calling r.json() on HTML throws "Unexpected token '<', '<!DOCTYPE'..."
// which surfaces to the user as gibberish. This helper returns a usable
// { error } object for any non-JSON body so the catch block can render
// a real message.
export async function safeJson(r: Response): Promise<any> {
  const text = await r.text();
  if (!text) {
    return r.ok ? {} : { error: `Server returned an empty response (HTTP ${r.status}).` };
  }
  try {
    return JSON.parse(text);
  } catch {
    if (r.status === 504 || r.status === 502 || r.status === 408) {
      return { error: "The request timed out. Try again with fewer / smaller inputs." };
    }
    if (r.status === 413) {
      return { error: "Those files are too large. Try compressing them or sending fewer." };
    }
    if (r.status === 401 || r.status === 403) {
      return { error: "Your session expired. Refresh the page and try again." };
    }
    const snippet = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    return {
      error: snippet
        ? `Server error (HTTP ${r.status}): ${snippet}`
        : `Server error (HTTP ${r.status}).`,
    };
  }
}
