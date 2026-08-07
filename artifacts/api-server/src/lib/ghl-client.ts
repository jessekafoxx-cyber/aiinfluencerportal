/**
 * Thin GoHighLevel API v2 client (Private Integration token).
 * Products endpoint requires the "View Products" scope on the token.
 */
const GHL_API = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export class GhlApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface GhlProduct {
  id: string;
  name: string;
  description?: string;
  productType?: string;
}

async function ghlFetch(url: string, token: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Network/DNS/timeout — normalize so routes return a controlled 502.
    throw new GhlApiError(0, "Could not reach GoHighLevel");
  }
}

async function throwFromResponse(res: Response): Promise<never> {
  const body = await res.text().catch(() => "");
  let message = `GoHighLevel API error (HTTP ${res.status})`;
  try {
    const parsed = JSON.parse(body) as { message?: string | string[] };
    const m = parsed?.message;
    if (m) message = Array.isArray(m) ? m.join("; ") : m;
  } catch {
    /* keep default */
  }
  throw new GhlApiError(res.status, message);
}

/**
 * Fetch all products for a location, following pagination. Throws
 * GhlApiError with the upstream status (401 = bad credentials/scope).
 */
export async function fetchGhlProducts(token: string, locationId: string): Promise<GhlProduct[]> {
  const products: GhlProduct[] = [];
  const limit = 100;
  let offset = 0;
  for (;;) {
    const url = `${GHL_API}/products/?locationId=${encodeURIComponent(locationId)}&limit=${limit}&offset=${offset}`;
    const res = await ghlFetch(url, token);
    if (!res.ok) await throwFromResponse(res);
    const data = (await res.json()) as {
      products?: Array<{ _id: string; name: string; description?: string; productType?: string }>;
    };
    const page = data.products ?? [];
    for (const p of page) {
      products.push({ id: p._id, name: p.name, description: p.description, productType: p.productType });
    }
    if (page.length < limit) break;
    offset += limit;
    if (offset > 10_000) {
      throw new GhlApiError(0, "This GoHighLevel location has more products than can be synced (10,000+)");
    }
  }
  return products;
}

/** Token verification used on save: a 1-item products list call. */
export async function verifyGhlCredentials(token: string, locationId: string): Promise<void> {
  const url = `${GHL_API}/products/?locationId=${encodeURIComponent(locationId)}&limit=1&offset=0`;
  const res = await ghlFetch(url, token);
  if (!res.ok) await throwFromResponse(res);
}
