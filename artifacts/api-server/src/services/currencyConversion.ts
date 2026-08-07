const rateCache = new Map<string, number>();
let latestRate: number | null = null;

async function fetchLatestRate(): Promise<number> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/GBP");
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const data = await res.json() as { result: string; rates: { USD: number } };
    if (data.result === "success" && data.rates?.USD) {
      latestRate = data.rates.USD;
      return data.rates.USD;
    }
    throw new Error("Invalid response format");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Currency] Failed to fetch latest GBP/USD rate:", message);
    return latestRate || 1.32;
  }
}

async function fetchRate(date: string): Promise<number> {
  if (rateCache.has(date)) {
    return rateCache.get(date)!;
  }

  if (latestRate === null) {
    await fetchLatestRate();
  }

  if (latestRate) {
    rateCache.set(date, latestRate);
    return latestRate;
  }

  const fallbackRate = 1.32;
  console.warn(`[Currency] Using fallback rate ${fallbackRate} for ${date}`);
  return fallbackRate;
}

export async function gbpToUsd(amountGbp: number, date: string): Promise<number> {
  if (amountGbp === 0) return 0;
  const rate = await fetchRate(date);
  return Math.round(amountGbp * rate * 100) / 100;
}

export async function preloadRates(startDate: string, endDate: string): Promise<void> {
  if (latestRate !== null) return;
  try {
    const rate = await fetchLatestRate();
    console.log(`[Currency] Loaded GBP/USD rate: ${rate}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Currency] Failed to preload rates:`, message);
  }
}

export function getCachedRate(date: string): number | undefined {
  return rateCache.get(date);
}

export async function getRate(date: string): Promise<number> {
  return fetchRate(date);
}
