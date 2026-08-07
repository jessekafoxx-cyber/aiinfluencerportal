/**
 * Probe Whop /payments + /users/{id} for the last 24h to find out why
 * the reconciliation scheduler is reporting skippedNoEmail=143.
 * Read-only. Does NOT touch the database.
 *
 * Usage: pnpm --filter @workspace/scripts run probe:whop-emails
 */
const WHOP_API_BASE = "https://api.whop.com/api/v2";
const KEY = process.env.WHOP_API_KEY || "";
const BIZ = process.env.WHOP_BUSINESS_ID || "";
if (!KEY || !BIZ) {
  console.error("Missing WHOP_API_KEY or WHOP_BUSINESS_ID");
  process.exit(1);
}
const HEADERS = {
  Authorization: `Bearer ${KEY}`,
  "x-company-id": BIZ,
  "Content-Type": "application/json",
};

async function whopGet<T>(path: string, query: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(`${WHOP_API_BASE}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString(), { headers: HEADERS });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${path} ${t.slice(0, 300)}`);
  return JSON.parse(t) as T;
}

async function main() {
  const startedAfter = Math.floor(Date.now() / 1000) - 24 * 3600;
  const list = await whopGet<{ data: any[]; pagination: any }>("/payments", {
    page: 1,
    per: 5,
    started_after: startedAfter,
    status: "paid",
  });
  console.log(`pagination=${JSON.stringify(list.pagination)}`);
  console.log(`sampling first ${list.data.length} receipts`);
  for (const r of list.data) {
    const userField = r.user;
    const userId =
      typeof userField === "string"
        ? userField
        : userField && typeof userField === "object"
          ? userField.id
          : r.user_id ?? null;
    console.log("---");
    console.log("receipt", r.id, "status", r.status, "product", r.product, "user_field_type", typeof userField);
    console.log("inline user object:", JSON.stringify(userField));
    console.log("billing_first_name:", r.billing_first_name, "billing_last_name:", r.billing_last_name);
    if (!userId) {
      console.log("  -> no userId on receipt");
      continue;
    }
    try {
      const u = await whopGet<any>(`/users/${userId}`);
      console.log(`  /users/${userId} ->`, JSON.stringify(u));
    } catch (e) {
      console.log(`  /users/${userId} FAILED:`, (e as Error).message);
    }
    // Also try /memberships fallback for one receipt
    if (r.membership) {
      try {
        const m = await whopGet<any>(`/memberships/${r.membership}`);
        console.log(`  /memberships/${r.membership} ->`, JSON.stringify(m));
      } catch (e) {
        console.log(`  /memberships FAILED:`, (e as Error).message);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
