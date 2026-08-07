// Public scarcity counter shown on /sep2026 and /pavel ("X of Y seats left").
// VIP is sold out, so every remaining seat is a Gold Pass. Keep this in lockstep
// with the hard backend cap PORTUGAL_GOLD_MAX_TICKETS in
// artifacts/api-server/src/routes/coaching.ts, which is what actually prevents
// an 8th Gold sale.
export const SEP2026_SEATS_LEFT = 7;
export const SEP2026_SEATS_TOTAL = 30;

// VIP Pass is sold out - only the Gold Pass can be purchased. The /sep2026
// sales page and the /sep2026/checkout flow both read this single flag so the
// VIP option is disabled everywhere at once. Flip to false to re-open VIP.
export const SEP2026_VIP_SOLD_OUT = true;
