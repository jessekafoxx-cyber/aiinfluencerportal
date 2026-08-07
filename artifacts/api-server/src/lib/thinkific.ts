import { logger } from "./logger";

const BASE_URL = "https://api.thinkific.com/api/public/v1";

// All eight Gregory Cooke courses on the gregorycooke.thinkific.com site.
// The accelerator event giveaway grants access to every one of them.
// Names are kept inline for log readability; ID is the source of truth.
export const ACCELERATOR_THINKIFIC_COURSE_IDS: ReadonlyArray<{ id: number; name: string }> = [
  { id: 3122986, name: "Skyrox AI" },
  { id: 3129914, name: "My 1000 Viral Meta Ads That Made $3.2M in 6 months" },
  { id: 3129945, name: "The EXACT Sales Funnel That Made $794K/mo" },
  { id: 3129962, name: "5 X VSL Templates That Have Done $1M+ Each In Sales" },
  { id: 3130220, name: "My $3.2K Per Email AI Creative Agent" },
  { id: 3131658, name: "Internal Creative Strategist Training, AI Tools & Hiring" },
  { id: 3248884, name: "AI Asset Farming (Digital Products)" },
  { id: 3248900, name: "The VIP Club (Exclusive Bonuses)" },
];

function authHeaders(): Record<string, string> | null {
  const token = process.env.THINKIFIC_API_KEY?.trim();
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = 10_000,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body: unknown = text;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        /* leave as text */
      }
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function findUserId(email: string, headers: Record<string, string>): Promise<number | null> {
  const url = `${BASE_URL}/users?query%5Bemail%5D=${encodeURIComponent(email)}`;
  const res = await fetchJson(url, { method: "GET", headers });
  if (!res.ok) {
    throw new Error(`Thinkific user lookup ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  const items = (res.body as { items?: Array<{ id?: number }> }).items ?? [];
  const id = items[0]?.id;
  return typeof id === "number" ? id : null;
}

function isEmailTakenError(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const errors = (body as { errors?: { email?: unknown } }).errors;
  const emailErrs = errors?.email;
  if (!Array.isArray(emailErrs)) return false;
  return emailErrs.some((e) => typeof e === "string" && /taken|exist/i.test(e));
}

function isAlreadyEnrolledError(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const errors = (body as { errors?: unknown }).errors;
  const flatten = (v: unknown): string[] => {
    if (typeof v === "string") return [v];
    if (Array.isArray(v)) return v.flatMap(flatten);
    if (v && typeof v === "object") return Object.values(v).flatMap(flatten);
    return [];
  };
  return flatten(errors).some((s) => /already enrolled|already exists|taken/i.test(s));
}

async function createUser(
  email: string,
  firstName: string | undefined,
  headers: Record<string, string>,
): Promise<number> {
  // Thinkific requires both first_name and last_name to be non-blank (422
  // otherwise). If the buyer supplied a single name we use a hyphen as the
  // last-name placeholder; if they gave a multi-word name we split on the
  // first space.
  const trimmed = firstName?.trim() ?? "";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0] || "Friend";
  const last = parts.slice(1).join(" ") || "-";

  const res = await fetchJson(`${BASE_URL}/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      first_name: first,
      last_name: last,
      send_welcome_email: false,
    }),
  });
  if (!res.ok) {
    // Race: another request created the user between our lookup and our
    // create. Thinkific responds 422 `{"errors":{"email":["has already been
    // taken"]}}`. Re-run the lookup and reuse the existing id rather than
    // failing the whole enrollment.
    if (res.status === 422 && isEmailTakenError(res.body)) {
      const existing = await findUserId(email, headers);
      if (existing != null) return existing;
    }
    throw new Error(`Thinkific user create ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  const id = (res.body as { id?: number }).id;
  if (typeof id !== "number") {
    throw new Error(`Thinkific user create returned no id: ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return id;
}

async function enrollOne(
  userId: number,
  courseId: number,
  headers: Record<string, string>,
): Promise<void> {
  const res = await fetchJson(`${BASE_URL}/enrollments`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      course_id: courseId,
      user_id: userId,
      activated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    // Replay safety: a prior fire of this flow may already have created the
    // enrollment row. Treat "already enrolled / already exists / taken"
    // 422s as success-equivalent so a retry never reports false failure.
    if (res.status === 422 && isAlreadyEnrolledError(res.body)) return;
    throw new Error(
      `Thinkific enroll ${res.status} course=${courseId}: ${JSON.stringify(res.body).slice(0, 200)}`,
    );
  }
}

export type AcceleratorEnrollResult =
  | { ok: true; userId: number; enrolledCourseIds: number[]; failedCourseIds: number[] }
  | { ok: false; reason: string };

/**
 * Find-or-create the Thinkific user for `email`, then enroll them in every
 * accelerator course. Returns a summary; never throws so the caller can
 * fire-and-forget safely from the public accelerator route. Re-running for
 * the same email is fully idempotent on Thinkific's side - existing user is
 * reused, existing enrollment rows are returned unchanged.
 */
export async function enrollEmailInAcceleratorCourses(
  email: string,
  firstName?: string,
): Promise<AcceleratorEnrollResult> {
  const headers = authHeaders();
  if (!headers) {
    return { ok: false, reason: "thinkific_api_key_missing" };
  }
  try {
    const existing = await findUserId(email, headers);
    const userId = existing ?? (await createUser(email, firstName, headers));

    const results = await Promise.allSettled(
      ACCELERATOR_THINKIFIC_COURSE_IDS.map((c) => enrollOne(userId, c.id, headers)),
    );
    const enrolled: number[] = [];
    const failed: number[] = [];
    results.forEach((r, i) => {
      const id = ACCELERATOR_THINKIFIC_COURSE_IDS[i]!.id;
      if (r.status === "fulfilled") enrolled.push(id);
      else {
        failed.push(id);
        logger.warn(
          { event: "thinkific_enroll_failed", email, courseId: id, error: String(r.reason) },
          "[thinkific] per-course enroll failed",
        );
      }
    });

    logger.info(
      { event: "thinkific_enroll_done", email, userId, enrolled, failed },
      "[thinkific] accelerator enrollment processed",
    );
    return { ok: true, userId, enrolledCourseIds: enrolled, failedCourseIds: failed };
  } catch (err) {
    logger.warn(
      { event: "thinkific_enroll_error", email, error: err instanceof Error ? err.message : String(err) },
      "[thinkific] accelerator enrollment threw",
    );
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
