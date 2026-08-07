const APIFY_BASE = "https://api.apify.com/v2";

function getToken(): string {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error("APIFY_TOKEN is not set. Cannot use scrapers.");
  return t;
}

export interface ApifyRunOptions {
  actorId: string;
  input: Record<string, unknown>;
  // Max wait in seconds for the run to finish before we abandon polling. Default 300.
  maxWaitSeconds?: number;
}

export interface ApifyRunResult<TItem> {
  runId: string;
  status: string;
  items: TItem[];
}

/**
 * Runs an Apify actor synchronously (start + poll + fetch dataset items).
 * Apify charges per actor compute, not per call; small runs are cheap.
 */
export async function runApifyActor<TItem = unknown>(
  opts: ApifyRunOptions,
): Promise<ApifyRunResult<TItem>> {
  const token = getToken();
  const maxWait = opts.maxWaitSeconds ?? 300;

  // Task #169: inject admin-managed IG session cookies for IG actors.
  let actorInput: Record<string, unknown> = opts.input;
  try {
    const igMod = await import("../instagram-session-cookies");
    if (igMod.isInstagramActor(opts.actorId)) {
      actorInput = await igMod.withInstagramSessionCookies(opts.actorId, opts.input);
    }
  } catch {
    // proceed without cookies - existing behaviour
  }

  // 1) Start the run.
  const startRes = await fetch(
    `${APIFY_BASE}/acts/${encodeURIComponent(opts.actorId)}/runs?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(actorInput),
    },
  );
  if (!startRes.ok) {
    const txt = await startRes.text().catch(() => "");
    throw new Error(`Apify actor ${opts.actorId} start failed: ${startRes.status} ${txt}`);
  }
  const startJson = (await startRes.json()) as { data: { id: string; defaultDatasetId: string } };
  const runId = startJson.data.id;
  const datasetId = startJson.data.defaultDatasetId;

  // 2) Poll until finished or timeout.
  const deadline = Date.now() + maxWait * 1000;
  let status = "RUNNING";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const stRes = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${encodeURIComponent(token)}`);
    if (!stRes.ok) continue;
    const stJson = (await stRes.json()) as { data: { status: string } };
    status = stJson.data.status;
    if (status === "SUCCEEDED" || status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      break;
    }
  }
  if (status !== "SUCCEEDED") {
    throw new Error(`Apify actor ${opts.actorId} ended with status ${status}`);
  }

  // 3) Fetch dataset items.
  const itemsRes = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?clean=true&format=json&token=${encodeURIComponent(token)}`,
  );
  if (!itemsRes.ok) {
    const txt = await itemsRes.text().catch(() => "");
    throw new Error(`Apify dataset fetch failed: ${itemsRes.status} ${txt}`);
  }
  const items = (await itemsRes.json()) as TItem[];
  return { runId, status, items };
}
