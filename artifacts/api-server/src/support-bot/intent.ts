// Keyword intent detection, ported from the product spec.

const BUG_KEYWORDS = [
  "bug", "broken", "not working", "error", "crash", "glitch",
  "can't load", "won't load", "blank page", "stuck", "frozen",
  "doesn't work", "not loading", "404", "500", "something wrong",
  "technical issue", "white screen",
];

const CONTEXT_WORDS = [
  "page", "portal", "button", "screen", "video", "link", "tool",
  "feature", "generation", "loading", "section", "tab", "dashboard",
];

const PURCHASE_KEYWORDS = [
  "what did i buy", "what did i purchase", "my purchases", "my order",
  "check my account", "what do i have access", "can't access", "locked",
  "not unlocked", "should have access", "paid for", "receipt",
  "my subscription", "billing", "charge", "payment", "what i bought",
  // Access / login trouble - the most common support case. These all
  // route into the email-then-account-lookup flow.
  "don't have access", "dont have access", "no access", "cant access",
  "can't log", "cant log", "can't sign", "cant sign", "log in", "login",
  "sign in", "password", "purchased", "i bought", "already paid",
];

const ESCALATION_KEYWORDS = [
  "speak to someone", "speak to a human", "real person", "manager",
  "supervisor", "complaint", "lawyer", "legal", "sue", "chargeback",
  "dispute", "scam", "fraud", "report you", "bbb",
];

// Added for the escalation email flow: signals the customer is annoyed
// with the bot itself (distinct from spec escalation keywords).
const FRUSTRATION_KEYWORDS = [
  "not helping", "you're useless", "youre useless", "this is useless",
  "waste of time", "wasting my time", "ridiculous", "this is stupid",
  "you don't understand", "you dont understand", "going in circles",
  "same answer", "fed up", "annoyed", "frustrated",
];

// Refund requests. Checked after escalation (chargeback/dispute threats
// stay escalations) but before the generic purchase keywords, since
// "refund" alone would otherwise fall through to purchase_check.
const REFUND_KEYWORDS = [
  "refund", "money back", "moneyback", "get my money", "want my money",
  "cancel my order", "cancel the order", "cancel this order",
  "return the product", "charge me back",
];

// AI influencer generation complaints. Checked FIRST (after bug
// collection mode) because words like "stuck" or "not generating"
// would otherwise be swallowed by the bug-report detector.
const INFLUENCER_WORDS = ["influencer", "my model", "my avatar"];
const GENERATION_PROBLEM_WORDS = [
  "not generat", "hasn't generat", "hasnt generat", "isn't generat",
  "isnt generat", "never generat", "still generat", "not been generated",
  "no images", "still waiting", "still not", "not ready", "stuck",
  "24 hour", "24hrs", "24 hrs", "a day", "days", "yesterday",
  "not arrived", "haven't received", "havent received", "not received",
  "nothing has", "taking too long", "too long", "not showing",
  "hasn't come", "hasnt come", "never came", "failed", "not done",
  "where is", "where are",
];

export type SupportBotIntent =
  | "bug_report"
  | "escalation"
  | "purchase_check"
  | "refund_request"
  | "influencer_stuck"
  | "needs_email"
  | "general";

export function detectIntent(
  message: string,
  session: { email: string | null; bugCollecting: boolean },
): SupportBotIntent {
  const m = message.toLowerCase();

  if (session.bugCollecting) return "bug_report";

  if (
    INFLUENCER_WORDS.some((k) => m.includes(k)) &&
    GENERATION_PROBLEM_WORDS.some((k) => m.includes(k))
  ) {
    return "influencer_stuck";
  }

  if (
    BUG_KEYWORDS.some((k) => m.includes(k)) &&
    CONTEXT_WORDS.some((w) => m.includes(w))
  ) {
    return "bug_report";
  }

  if (ESCALATION_KEYWORDS.some((k) => m.includes(k))) return "escalation";

  if (REFUND_KEYWORDS.some((k) => m.includes(k))) return "refund_request";

  if (PURCHASE_KEYWORDS.some((k) => m.includes(k))) {
    return session.email ? "purchase_check" : "needs_email";
  }

  return "general";
}

export function isFrustrated(message: string): boolean {
  const m = message.toLowerCase();
  return FRUSTRATION_KEYWORDS.some((k) => m.includes(k));
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function extractEmail(message: string): string | null {
  const match = message.match(EMAIL_RE);
  return match ? match[0].toLowerCase() : null;
}
