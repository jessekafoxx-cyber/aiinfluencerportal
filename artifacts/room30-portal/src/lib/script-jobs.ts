import { useEffect, useRef, useState } from "react";
import { fetchAuthed, getAuthHeaders } from "@/lib/api";
import { safeJson } from "./safe-json";

export type ScriptJobType =
  | "green-screen"
  | "hook-demo"
  | "podcast-clip"
  | "speaking-clip"
  | "selfie-clip"
  | "slideshow"
  | "carousel"
  | "overlay"
  | "fastmotion"
  | "green-screen-ideas"
  | "hook-demo-ideas"
  | "podcast-ideas"
  | "speaking-ideas"
  | "selfie-ideas"
  | "slideshow-ideas"
  | "carousel-ideas"
  | "overlay-ideas"
  | "fastmotion-ideas";

export interface ScriptJobRow {
  id: number;
  type: ScriptJobType;
  status: "queued" | "running" | "succeeded" | "failed";
  progressPct: number;
  stage: string | null;
  label: string | null;
  errorMessage: string | null;
  result: any;
  inputPayload: any;
  createdAt: string;
  updatedAt: string;
}

const POLL_MS = 1500;
const STORAGE_PREFIX = "scriptJob:";

export function storeJobId(type: ScriptJobType, jobId: number): void {
  try { localStorage.setItem(`${STORAGE_PREFIX}${type}`, String(jobId)); } catch {}
}
export function readStoredJobId(type: ScriptJobType): number | null {
  try {
    const v = localStorage.getItem(`${STORAGE_PREFIX}${type}`);
    if (!v) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
export function clearStoredJobId(type: ScriptJobType): void {
  try { localStorage.removeItem(`${STORAGE_PREFIX}${type}`); } catch {}
}

export type FetchJobResult =
  | { kind: "ok"; job: ScriptJobRow }
  | { kind: "notFound" }
  | { kind: "error"; status: number };

export async function fetchJobResult(jobId: number): Promise<FetchJobResult> {
  let r: Response;
  try {
    r = await fetchAuthed(`/script-writer/jobs/${jobId}`);
  } catch {
    return { kind: "error", status: 0 };
  }
  if (r.status === 404) return { kind: "notFound" };
  if (!r.ok) return { kind: "error", status: r.status };
  const data = await safeJson(r);
  // Server returns the job fields at the top level (not wrapped in `{ job }`).
  if (!data || typeof data.id !== "number") return { kind: "error", status: r.status };
  return { kind: "ok", job: data as ScriptJobRow };
}

// Back-compat helper. Prefer `fetchJobResult` for differentiated handling.
export async function fetchJob(jobId: number): Promise<ScriptJobRow | null> {
  const r = await fetchJobResult(jobId);
  return r.kind === "ok" ? r.job : null;
}

export async function listJobs(
  type: ScriptJobType,
  limit = 12,
): Promise<ScriptJobRow[]> {
  const r = await fetchAuthed(
    `/script-writer/jobs?type=${encodeURIComponent(type)}&limit=${limit}`,
  );
  if (!r.ok) return [];
  const data = await safeJson(r);
  return (data && Array.isArray(data.jobs)) ? (data.jobs as ScriptJobRow[]) : [];
}

// Newest in-flight (queued|running) job for this user across ALL SOP types,
// or null. Lets the page re-attach to a job that was started on a different
// device/tab where localStorage has no record of it (cross-device resume).
export async function fetchActiveJob(): Promise<Pick<
  ScriptJobRow,
  "id" | "type" | "status"
> | null> {
  let r: Response;
  try {
    r = await fetchAuthed(`/script-writer/jobs/active`);
  } catch {
    return null;
  }
  if (!r.ok) return null;
  const data = await safeJson(r);
  const job = data?.job;
  if (!job || typeof job.id !== "number") return null;
  return { id: job.id, type: job.type, status: job.status };
}

// Rough expected wall-clock duration per SOP type, used purely to render an
// honest ETA and to pace the synthetic progress creep. Ideas jobs are short
// (one OpenAI call); full scripts are longer. These are estimates - the real
// server progress always wins once it advances.
const EXPECTED_MS: Partial<Record<ScriptJobType, number>> = {
  "green-screen": 45000,
  "hook-demo": 50000,
  "podcast-clip": 45000,
  "speaking-clip": 45000,
  "selfie-clip": 45000,
  slideshow: 50000,
  carousel: 55000,
  overlay: 45000,
  fastmotion: 45000,
};
const DEFAULT_EXPECTED_MS = 40000;
const IDEAS_EXPECTED_MS = 20000;
export function expectedDurationMs(type: ScriptJobType): number {
  if (type.endsWith("-ideas")) return IDEAS_EXPECTED_MS;
  return EXPECTED_MS[type] ?? DEFAULT_EXPECTED_MS;
}

export interface UseScriptJobState {
  jobId: number | null;
  status: ScriptJobRow["status"] | null;
  progressPct: number;
  stage: string;
  errorMessage: string | null;
  isActive: boolean;
  // Milliseconds since the job started (or since resume on this device), and
  // a best-effort remaining estimate based on the per-type expected duration.
  // `etaMs` is null once the estimate is exhausted (job running long).
  elapsedMs: number;
  etaMs: number | null;
  start: (jobId: number) => void;
  cancel: () => void;
}

export function useScriptJob(
  type: ScriptJobType,
  onComplete: (job: ScriptJobRow) => void,
  onError: (job: ScriptJobRow) => void,
  opts?: { autoResume?: boolean },
): UseScriptJobState {
  const autoResume = opts?.autoResume !== false;
  const [jobId, setJobId] = useState<number | null>(null);
  const [status, setStatus] = useState<ScriptJobRow["status"] | null>(null);
  // `serverPct` is what the server actually reported; `progressPct` is what
  // we expose to the UI. We smoothly creep `progressPct` up between server
  // updates so the bar feels alive instead of jumping 20 -> 100.
  const [serverPct, setServerPct] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const [stage, setStage] = useState("Queued");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Wall-clock anchor for elapsed/ETA. Set when a job is started or resumed.
  const startedAtRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const cbRef = useRef({ onComplete, onError });
  cbRef.current = { onComplete, onError };

  // Auto-resume on mount if a jobId is in localStorage for this SOP.
  useEffect(() => {
    if (!autoResume) return;
    const stored = readStoredJobId(type);
    if (stored) {
      setJobId(stored);
      setStatus("running");
      setStage("Resuming");
      // We don't know the original start time on a resumed device, so anchor
      // to now. ETA is best-effort and the real server progress takes over.
      startedAtRef.current = Date.now();
      setElapsedMs(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const start = (id: number) => {
    setJobId(id);
    setStatus("queued");
    setServerPct(0);
    setProgressPct(0);
    setStage("Queued");
    setErrorMessage(null);
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    storeJobId(type, id);
  };

  const cancel = () => {
    setJobId(null);
    setStatus(null);
    setServerPct(0);
    setProgressPct(0);
    setStage("Queued");
    setErrorMessage(null);
    startedAtRef.current = null;
    setElapsedMs(0);
    clearStoredJobId(type);
  };

  // Smoothly creep `progressPct` up while the job is running so the bar never
  // sits frozen during long OpenAI calls. Synthetic progress is CAPPED at 90%
  // and paced against the per-type expected duration - we never claim more
  // than 90% until the server reports a higher real value (then we snap up),
  // so the bar can't lie about being "almost done". The 90->100 jump only
  // happens on server-confirmed completion. We also tick `elapsedMs` here so
  // the UI can show elapsed + ETA.
  const SYNTHETIC_CAP = 90;
  useEffect(() => {
    if (!jobId) return;
    if (status !== "running" && status !== "queued") return;
    if (startedAtRef.current == null) startedAtRef.current = Date.now();
    const expected = expectedDurationMs(type);
    const interval = setInterval(() => {
      const startedAt = startedAtRef.current ?? Date.now();
      setElapsedMs(Date.now() - startedAt);
      setProgressPct((current) => {
        const floor = serverPct;
        // Time-paced synthetic ceiling: approaches but never exceeds the cap
        // until expected duration elapses; the server's real value can push
        // past the cap when it advances.
        const elapsed = Date.now() - startedAt;
        const timePaced = Math.min(
          SYNTHETIC_CAP,
          (elapsed / Math.max(1, expected)) * SYNTHETIC_CAP,
        );
        const syntheticCeiling = Math.max(timePaced, Math.min(SYNTHETIC_CAP, floor));
        const target = Math.max(syntheticCeiling, floor);
        if (current >= target) return Math.max(current, floor);
        const remaining = target - Math.max(current, floor);
        // Ease: bigger steps when far from target, smaller as we approach.
        const step = Math.max(0.25, remaining * 0.05);
        const next = Math.max(current, floor) + step;
        return Math.min(next, target);
      });
    }, 400);
    return () => clearInterval(interval);
  }, [jobId, status, serverPct, type]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: any = null;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 8; // ~12s of failures -> bail out
    const poll = async () => {
      const r = await fetchJobResult(jobId);
      if (cancelled) return;
      // 404 -> the job is gone (different user, different env, DB reset,
      // etc). Silently clear localStorage so the UI unsticks instead of
      // polling forever showing "Resuming".
      if (r.kind === "notFound") {
        clearStoredJobId(type);
        setJobId(null);
        setStatus(null);
        setServerPct(0);
        setProgressPct(0);
        setStage("Queued");
        setErrorMessage(null);
        return;
      }
      if (r.kind === "error") {
        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          clearStoredJobId(type);
          setErrorMessage("Lost connection to the job. Please try again.");
          const stub: ScriptJobRow = {
            id: jobId,
            type,
            status: "failed",
            progressPct: 0,
            stage: "Failed",
            label: null,
            errorMessage: "Lost connection to the job",
            result: null,
            inputPayload: null,
            createdAt: "",
            updatedAt: "",
          };
          cbRef.current.onError(stub);
          setJobId(null);
          return;
        }
        timer = setTimeout(poll, POLL_MS);
        return;
      }
      consecutiveErrors = 0;
      const job = r.job;
      setStatus(job.status);
      const reported = job.progressPct || 0;
      setServerPct((prev) => Math.max(prev, reported));
      // Snap displayed pct up if the server jumped ahead of our smoothing.
      setProgressPct((prev) => Math.max(prev, reported));
      if (job.stage) setStage(job.stage);
      if (job.status === "succeeded") {
        setServerPct(100);
        setProgressPct(100);
        clearStoredJobId(type);
        cbRef.current.onComplete(job);
        setJobId(null);
        return;
      }
      if (job.status === "failed") {
        setErrorMessage(job.errorMessage || "Job failed");
        clearStoredJobId(type);
        cbRef.current.onError(job);
        setJobId(null);
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, type]);

  // Best-effort remaining estimate: expected duration minus elapsed while the
  // job is in flight. Null once we've blown past the estimate (so the UI shows
  // "almost done" rather than a fake countdown) or when no job is running.
  const inFlight = status === "running" || status === "queued";
  const expectedMs = expectedDurationMs(type);
  const etaMs = inFlight && elapsedMs < expectedMs
    ? Math.max(0, expectedMs - elapsedMs)
    : null;

  return {
    jobId,
    status,
    progressPct,
    stage,
    errorMessage,
    isActive: jobId !== null,
    elapsedMs,
    etaMs,
    start,
    cancel,
  };
}

// POST a generic JSON body to a script-writer endpoint expecting 202 { jobId }.
// `url` must be the absolute API path (e.g. "/api/portal/script-writer/hook-demo-ideas").
export async function startScriptJobJson(
  url: string,
  body: any,
): Promise<number> {
  const auth = await getAuthHeaders();
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Portal-Key": "room30",
      ...auth,
    },
    body: JSON.stringify(body),
  });
  const data = await safeJson(r);
  if (!r.ok || !data || typeof data.jobId !== "number") {
    const msg = (data && data.error) || `Request failed (${r.status})`;
    const details = data && Array.isArray(data.details) ? ` - ${data.details.join(", ")}` : "";
    throw new Error(msg + details);
  }
  return data.jobId as number;
}

// Run a single script job to completion as an awaitable promise, polling the
// same /script-writer/jobs/:id endpoint the hook uses. This sidesteps the
// one-job-at-a-time hook architecture so callers can drive a sequential
// batch (e.g. "write a script for each selected idea") without fighting the
// global activeJob panel. Resolves with the succeeded job, rejects on
// failure / not-found / lost connection / cancellation.
export async function runScriptJobToCompletion(
  url: string,
  body: any,
  opts?: {
    isCancelled?: () => boolean;
    onProgress?: (pct: number, stage: string) => void;
    pollMs?: number;
  },
): Promise<ScriptJobRow> {
  const pollMs = opts?.pollMs ?? POLL_MS;
  if (opts?.isCancelled?.()) throw new Error("Cancelled");
  const jobId = await startScriptJobJson(url, body);
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 8;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (opts?.isCancelled?.()) throw new Error("Cancelled");
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    if (opts?.isCancelled?.()) throw new Error("Cancelled");
    const r = await fetchJobResult(jobId);
    if (r.kind === "notFound") throw new Error("Job not found");
    if (r.kind === "error") {
      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw new Error("Lost connection to the job");
      }
      continue;
    }
    consecutiveErrors = 0;
    opts?.onProgress?.(r.job.progressPct || 0, r.job.stage || "");
    if (r.job.status === "succeeded") return r.job;
    if (r.job.status === "failed") throw new Error(r.job.errorMessage || "Job failed");
  }
}

// POST a multipart FormData to a script-writer endpoint expecting 202 { jobId }.
// `url` must be the absolute API path.
export async function startScriptJobFormData(
  url: string,
  fd: FormData,
): Promise<number> {
  const auth = await getAuthHeaders();
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      "X-Portal-Key": "room30",
      ...auth,
    },
    body: fd,
  });
  const data = await safeJson(r);
  if (!r.ok || !data || typeof data.jobId !== "number") {
    const msg = (data && data.error) || `Request failed (${r.status})`;
    throw new Error(msg);
  }
  return data.jobId as number;
}
