import {
  getStartAdminImpersonationUrl,
  getStopAdminImpersonationUrl,
  getGetAdminImpersonationStatusUrl,
  type AdminImpersonationStartResponse,
  type AdminImpersonationStatusResponse,
  type StopAdminImpersonation200,
} from "@workspace/api-client-react";

const API_BASE = "/api/portal";

// Per-run sync session payloads exposed on the research board dashboards.
// Counters mirror the sync_sessions table; events power the Live tab.
export interface WorkshopRecordingKeyMention { name: string; context?: string }
export interface WorkshopRecordingLink { url: string; label?: string; context?: string }
export interface WorkshopRecordingActionPoint { text: string }
export interface WorkshopRecordingMember {
  id: number;
  title: string;
  recordedAt: string;
  wistiaMediaId: string;
  durationMinutes: number | null;
  summary: string;
  keyMentions: WorkshopRecordingKeyMention[];
  links: WorkshopRecordingLink[];
  actionPoints: WorkshopRecordingActionPoint[];
  additionalNotes: string;
  publishedAt: string | null;
}
export type SyncSessionStatus = "running" | "completed" | "failed";
export type SyncSessionTrigger = "manual" | "scheduled" | "boot-freshness";
export type SyncSessionBoard = "ad-research" | "funnels-research";

export interface SyncSession {
  id: number;
  board: SyncSessionBoard;
  trigger: SyncSessionTrigger;
  status: SyncSessionStatus;
  startedAt: string;
  completedAt: string | null;
  buildSha: string | null;
  workerPid: string | null;
  workerId: string | null;
  error: string | null;
  rowsFetched: number;
  rowsProcessed: number;
  successfulExtractions: number;
  authFailures: number;
  retries: number;
  escalations: number;
  recoveries: number;
  invalidUrls: number;
  deadContent: number;
  extractionRateBp: number;
  throughputPerMin: number;
  queueDepth: number;
  summary: Record<string, unknown> | null;
}

export interface SyncSessionEvent {
  id: number;
  sessionId: number;
  occurredAt: string;
  kind: string;
  severity: "info" | "warn" | "error";
  message: string | null;
  detail: Record<string, unknown> | null;
}

export interface SyncSessionLiveResponse {
  ok: boolean;
  session: SyncSession | null;
  events: SyncSessionEvent[];
}

// T257: Background Reel Music import job (admin polling).
export type BackgroundMusicJobStatus = "pending" | "running" | "done" | "failed";
export interface BackgroundMusicJob {
  id: string;
  status: BackgroundMusicJobStatus;
  startedAt: number;
  finishedAt: number | null;
  total: number;
  processed: number;
  added: number;
  updated: number;
  skipped: number;
  failed: number;
  message: string | null;
  error: string | null;
}

export type OsToolGenerationJobStatus =
  | "pending"
  | "processing"
  | "done"
  | "failed";

export interface OsToolGenerationJob {
  id: number;
  userId: number;
  slug: string;
  status: OsToolGenerationJobStatus;
  label: string | null;
  errorMessage: string | null;
  answers: Record<string, any> | null;
  content: string | null;
  slides: any[] | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type OsToolSaveJobStatus =
  | "pending"
  | "saving_asset"
  | "generating_secondary"
  | "done"
  | "failed";

export interface OsToolSaveJob {
  id: number;
  userId: number;
  slug: string;
  status: OsToolSaveJobStatus;
  step: number;
  totalSteps: number;
  label: string | null;
  errorMessage: string | null;
  primaryAssetId: number | null;
  secondaryAssetId: number | null;
  primaryContent: string | null;
  primaryTitle: string | null;
  primaryCategory: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

let _getToken: (() => Promise<string | null>) | null = null;

export function setTokenGetter(fn: () => Promise<string | null>) {
  _getToken = fn;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (_getToken) {
    try {
      const token = await withTimeout(_getToken(), 8000, "auth token");
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {}
  }
  const imp = getImpersonationToken();
  if (imp) headers["X-Impersonate-Session"] = imp;
  return headers;
}

// Task #710: super-admin "view as user" token. Stored in sessionStorage so
// it never outlives the tab; the server enforces an 8h hard expiry and the
// admin_impersonation_sessions row is the source of truth for revocation.
export const IMPERSONATION_STORAGE_KEY = "r30_impersonation_token";
export const IMPERSONATION_META_KEY = "r30_impersonation_meta";

export function getImpersonationToken(): string | null {
  try {
    return typeof window === "undefined"
      ? null
      : window.sessionStorage.getItem(IMPERSONATION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export interface ImpersonationMeta {
  sessionId: number;
  expiresAt: string;
  target: { id: number; email: string; firstName: string | null; lastName: string | null };
  admin: { clerkId: string; email: string | null };
}

export function getImpersonationMeta(): ImpersonationMeta | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(IMPERSONATION_META_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ImpersonationMeta;
  } catch {
    return null;
  }
}

export function setImpersonation(token: string, meta: ImpersonationMeta) {
  try {
    window.sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, token);
    window.sessionStorage.setItem(IMPERSONATION_META_KEY, JSON.stringify(meta));
    window.dispatchEvent(new Event("r30:impersonation-changed"));
  } catch {}
}

/**
 * Task #710: best-effort impersonation stop hook for Clerk sign-out paths.
 * Fires the stop endpoint (so the audit row is closed) and clears the local
 * sessionStorage token. Never throws — sign-out must succeed regardless of
 * network state. Safe to call when no impersonation session is active.
 */
export async function stopImpersonationBeforeSignOut(): Promise<void> {
  if (!getImpersonationToken()) return;
  try {
    await Promise.race([
      api.admin.stopImpersonation(),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch {}
  clearImpersonation();
}

export function clearImpersonation() {
  try {
    window.sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY);
    window.sessionStorage.removeItem(IMPERSONATION_META_KEY);
    window.dispatchEvent(new Event("r30:impersonation-changed"));
  } catch {}
}

// Defensive timeout wrapper so a hung Clerk token refresh or network blackhole
// can never freeze a query in pending state forever.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// Client-side activity emitter. Fires page_view on every wouter route
// change (wired in PortalLayout) and can also be called manually to log
// clicks / feature use. Fire-and-forget; never throws. The server
// stamps IP + UA from the request itself so we deliberately do not try
// to include them here. Action is restricted server-side to a small
// allowlist (page_view | click | ui_* | feature_*); anything else 400s.
export function trackEvent(
  action: string,
  detail?: { path?: string; resourceType?: string; resourceId?: string; metadata?: Record<string, unknown> },
): void {
  // Skip while impersonating - otherwise CS reviewing a buyer's account
  // would pollute that buyer's own activity log with the CS rep's
  // page_views.
  if (getImpersonationToken()) return;
  void fetchApi("/track", {
    method: "POST",
    body: JSON.stringify({
      action,
      path: detail?.path,
      resourceType: detail?.resourceType,
      resourceId: detail?.resourceId,
      metadata: detail?.metadata,
    }),
    timeoutMs: 5000,
  }).catch(() => {
    /* swallow - tracking must never break the UI */
  });
}

export async function fetchApi<T = any>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 25000;
  // Use a Headers object (case-insensitive, last-write-wins) so a caller
  // passing `headers: { "content-type": "application/json" }` (lowercase)
  // collapses to a single Content-Type entry. A plain-object spread keeps
  // both `Content-Type` and `content-type` keys, and the Fetch layer then
  // serializes them as a comma-joined header ("application/json, application/json"),
  // which makes Express's body parser refuse to parse the body and the
  // server sees `req.body === undefined`.
  const headers = new Headers();
  // Only default to JSON when the caller is NOT sending FormData. For
  // multipart uploads (e.g. dfy/bridge-pages image upload) the browser
  // MUST set Content-Type itself so it can inject the multipart boundary
  // - hard-coding application/json here would strand the upload.
  if (!(options?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("X-Portal-Key", "room30");
  if (options?.headers) {
    new Headers(options.headers as HeadersInit).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  if (_getToken) {
    try {
      const token = await withTimeout(_getToken(), 8000, "auth token");
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
    } catch {}
  }
  // Task #710: forward the super-admin impersonation token on every API
  // call so the server swaps to the target user transparently.
  const _imp = getImpersonationToken();
  if (_imp) headers.set("X-Impersonate-Session", _imp);

  // Cache-bust GETs so the browser never sends If-None-Match (which can return
  // a bodyless 304 that React Query cannot parse, leaving the UI spinning).
  const isGet = !options?.method || options.method.toUpperCase() === "GET";
  // Absolute-path escape hatch: callers that need to hit a router mounted
  // outside `/api/portal` (e.g. /api/coaching/admin/* on the shared
  // coachingRouter) can pass a path beginning with `/api/` and we leave it
  // alone. Without this, fetchApi("/coaching/admin/agreements") becomes
  // /api/portal/coaching/admin/agreements -> 404 and the page silently
  // renders an empty list.
  const base = path.startsWith("/api/") ? "" : API_BASE;
  const url = isGet
    ? `${base}${path}${path.includes("?") ? "&" : "?"}_t=${Date.now()}`
    : `${base}${path}`;

  const controller = new AbortController();
  const reqTimeout = setTimeout(() => controller.abort(), timeoutMs);

  // Strip our custom timeoutMs option before passing to fetch.
  const { timeoutMs: _omit, ...fetchOptions } = options ?? {};

  let res: Response;
  try {
    // IMPORTANT: spread `...fetchOptions` BEFORE `headers` so that a
    // caller passing `headers: { "Content-Type": "application/json" }`
    // in options cannot accidentally blow away the merged headers
    // object (which already contains the caller's Content-Type folded
    // in alongside our Authorization / X-Portal-Key). Putting `headers`
    // after the spread guarantees the merged value wins.
    res = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
      ...fetchOptions,
      headers,
    });
  } catch (err: any) {
    clearTimeout(reqTimeout);
    if (err?.name === "AbortError") {
      throw new Error("Request timed out. Please refresh and try again.");
    }
    throw err;
  }
  clearTimeout(reqTimeout);

  if (res.status === 304) {
    // Should not happen with cache: no-store + cache-bust + server no-store,
    // but if it ever does, surface it as a recoverable error rather than hanging.
    throw new Error("Stale response. Please refresh.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Task #710: centralized impersonation-read-only handling. Any
    // 403 { error: "impersonation_read_only" } from any endpoint pops a
    // single global toast and converts the throw into a typed error the
    // caller can ignore. We dispatch a CustomEvent so the toast wiring
    // lives in the React tree (where useToast is available) without
    // making this module depend on it.
    if (res.status === 403 && body?.error === "impersonation_read_only") {
      try {
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("r30:impersonation-write-blocked", {
              detail: { path, method: options?.method ?? "GET" },
            }),
          );
        }
      } catch {}
    }
    // Task #512: preserve the structured `code` field on the thrown
    // error so callers (e.g. <BoardLoadError />) can render a stable,
    // machine-readable error class to the user instead of a generic
    // "try refreshing" toast.
    const err = new Error(body?.error || `API error: ${res.status}`) as Error & {
      code?: string;
      status?: number;
      body?: unknown;
    };
    if (typeof body?.code === "string") err.code = body.code;
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json();
}

export async function fetchAuthed(path: string, options?: RequestInit) {
  const headers: Record<string, string> = {
    "X-Portal-Key": "room30",
    ...(options?.headers as Record<string, string>),
  };
  if (_getToken) {
    try {
      const token = await withTimeout(_getToken(), 8000, "auth token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } catch {}
  }
  // Task #710: forward super-admin impersonation token.
  const _impA = getImpersonationToken();
  if (_impA) headers["X-Impersonate-Session"] = _impA;
  // IMPORTANT: spread `...options` BEFORE `headers` so that a caller
  // passing `headers: { "Content-Type": "application/json" }` in
  // options cannot accidentally blow away the merged headers object
  // (which already contains the caller's Content-Type folded in
  // alongside our Authorization / X-Portal-Key). Putting `headers`
  // after the spread guarantees the merged value wins. The previous
  // order silently dropped Authorization on every POST that set its
  // own Content-Type (e.g. /stripe/addon/charge-saved), producing a
  // 2ms 401 in requireAuth and a "Unauthorized" overlay in the portal
  // sidebar add-on modals (Done For You Pack, etc.).
  return fetch(`${API_BASE}${path}`, { credentials: "include", cache: "no-store", ...options, headers });
}
export type OnboardingCallStatusResponse = {
  configured: boolean;
  hasBooked: boolean;
  shouldPrompt: boolean;
  bookingUrl: string;
  promptSeen: boolean;
  apiError: boolean;
};

export async function getOnboardingCallStatus(): Promise<OnboardingCallStatusResponse> {
  return fetchApi("/onboarding-call/status");
}

export async function markOnboardingCallPromptSeen(): Promise<{ ok: boolean }> {
  return fetchApi("/onboarding-call/prompt-seen", { method: "POST" });
}
export type AdResearchBoardMediaItem = {
  kind: "video" | "image";
  objectPath: string;
  contentType: string;
};

export type AdResearchBoardMediaMeta = {
  isCarousel?: boolean;
  expectedSlides?: number;
  capturedSlides?: number;
  source?: string | null;
  retryStrategy?: string | null;
  typename?: string | null;
};

export type AdResearchBoardItem = {
  id: number;
  rowKey: string;
  sortIndex: number;
  adLink: string;
  type: string | null;
  awarenessStage: string | null;
  style: string | null;
  notes: string | null;
  mediaKind: "video" | "image" | null;
  mediaObjectPath: string | null;
  mediaContentType: string | null;
  // Cached video poster (Task #186). Populated by the media downloader for
  // video rows so the grid can render a cheap <img> instead of spinning up
  // a <video preload="metadata"> element per tile.
  mediaThumbnailObjectPath: string | null;
  mediaThumbnailContentType: string | null;
  mediaThumbnailSource: string | null;
  mediaThumbnailSourceUrl: string | null;
  mediaItems: AdResearchBoardMediaItem[] | null;
  mediaMeta: AdResearchBoardMediaMeta | null;
  mediaStatus: "pending" | "downloading" | "ok" | "partial" | "failed" | "skipped" | null;
  mediaError: string | null;
  // Admin-only fields (omitted from non-admin payloads by the server).
  mediaAttempts?: number;
  dismissed?: boolean;
  hiddenFromSheet?: boolean;
  urlKind?:
    | "instagram-post" | "instagram-reel" | "instagram-story"
    | "facebook-post" | "facebook-reel" | "facebook-video" | "facebook-share-redirect"
    | "direct-image" | "direct-video" | "unknown" | null;
  resolvedUrl?: string | null;
  updatedAt: string;
  createdAt: string;
};

// Server-side paginated payload. `items` is just the requested page; `total`
// + `counts` describe the full board so the UI can render filter chips and
// the "Retry Failed (N)" badge accurately. `facets` enumerates every
// distinct dropdown value across the visibility-filtered population so the
// filter dropdowns are populated even on page 1.
export type AdResearchBoardCounts = {
  ok: number;
  failed: number;
  // Task #401: count that exactly mirrors the admin "Needs Fixing"
  // visibility filter (failed | partial | hiddenFromSheet, never
  // dismissed). The header badge reads this so it can never disagree
  // with the row count the filter produces.
  needsFixing: number;
  // Task #401: terminal-exhaustion bucket (mediaStatus='failed_permanent').
  // Always dismissed, so it folds into `dismissed` for the invariant
  // sum, but operators want to see it independently.
  failedPermanent: number;
  pending: number;
  // Task #134: partial is a first-class status — carousels where SOME
  // slides downloaded but not all expected. Visible to users (we render
  // what we have) AND counted separately for admin triage.
  partial: number;
  // Task #366: explicit downloading + invalid buckets (previously
  // collapsed into `pending`) so the breakdown popover can reconcile
  // every row to a status the operator recognises.
  downloading: number;
  invalid: number;
  dismissed: number;
  // Task #134: rows that fell out of the sheet but kept their cached media.
  // Admin-only — non-admins always see 0 here because their visibility
  // filter excludes hidden rows.
  hidden: number;
  // Task #366: rows that are mediaStatus=ok/partial but have no
  // mediaObjectPath (download succeeded then the object write was
  // lost) — they fail the visibility filter and don't render as cards.
  missingObjectPath: number;
  // Task #366: source rows the most recent sync silently dropped
  // before they could be upserted (currently only sheet rows whose
  // link cell is empty).
  sourceRowsSkipped: number;
};

export type AdResearchBoardFacets = {
  types: string[];
  awarenessStages: string[];
  styles: string[];
};

export type PlatinumClubResource = {
  id: number;
  section: string;
  title: string;
  description: string | null;
  resourceType: string;
  downloadUrl: string | null;
  externalUrl: string | null;
  coverUrl: string | null;
};

export type PlatinumClubBuildSection = {
  key: string;
  label: string;
};

export type PlatinumClubBuild = {
  id: number;
  label: string;
  slug: string;
  sections: PlatinumClubBuildSection[];
  displayOrder: number;
  isActive: boolean;
};

export type PlatinumClubResourcesResponse = {
  isLive: boolean;
  canPreview: boolean;
  dropAtIso: string;
  resources: PlatinumClubResource[];
  builds: PlatinumClubBuild[];
};

export type PlatinumClubAdminResource = {
  id: number;
  section: string;
  title: string;
  description: string | null;
  resourceType: string;
  driveFileId: string | null;
  externalUrl: string | null;
  coverDriveFileId: string | null;
  downloadUrl: string | null;
  coverUrl: string | null;
  displayOrder: number;
  isActive: boolean;
};

export type PlatinumClubAdminResponse = {
  sections: string[];
  resourceTypes: string[];
  builds: PlatinumClubBuild[];
  resources: PlatinumClubAdminResource[];
};

export type PlatinumClubResourceInput = {
  section: string;
  title: string;
  description?: string | null;
  resourceType: string;
  driveFileId?: string | null;
  externalUrl?: string | null;
  coverDriveFileId?: string | null;
  displayOrder?: number;
  isActive?: boolean;
};

export type AdResearchBoardResponse = {
  items: AdResearchBoardItem[];
  page: number;
  pageSize: number;
  // `total` matches the page query population (visibility + active
  // filter chips). Drives pagination/infinite scroll - never repurpose
  // it for the header.
  total: number;
  // Task #366: full inventory count - every row in the table, ignoring
  // visibility filters and user filter chips. Drives the header
  // "X of Y ready" counter and the breakdown popover total.
  inventoryTotal: number;
  // Task #366: server-derived headline `ready` count (rows visible on
  // the board: dismissed=false AND mediaStatus IN (ok,partial) AND
  // mediaObjectPath IS NOT NULL), GLOBAL - not narrowed by filter
  // chips. Authoritative; do not re-derive from page state.
  ready: number;
  counts: AdResearchBoardCounts;
  facets: AdResearchBoardFacets;
  lastSyncedAt: string | null;
  lastSyncOk: boolean | null;
  lastSyncError: string | null;
};

export type AdResearchBoardSort = "default" | "newest";
export type AdResearchBoardView = "default" | "needsFixing";

export type AdResearchBoardQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: string[];
  awarenessStage?: string[];
  style?: string[];
  mediaOnly?: boolean;
  sort?: AdResearchBoardSort;
  view?: AdResearchBoardView;
};

function buildAdResearchBoardQueryString(q: AdResearchBoardQuery = {}): string {
  const sp = new URLSearchParams();
  if (q.page && q.page > 1) sp.set("page", String(q.page));
  if (q.pageSize) sp.set("pageSize", String(q.pageSize));
  if (q.search && q.search.trim()) sp.set("search", q.search.trim());
  for (const t of q.type || []) sp.append("type", t);
  for (const a of q.awarenessStage || []) sp.append("awarenessStage", a);
  for (const s of q.style || []) sp.append("style", s);
  if (q.mediaOnly) sp.set("mediaOnly", "1");
  if (q.sort && q.sort !== "default") sp.set("sort", q.sort);
  if (q.view && q.view !== "default") sp.set("view", q.view);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export type FunnelsResearchBoardItem = {
  id: number;
  rowKey: string;
  sortIndex: number;
  funnelLink: string;
  type: string | null;
  awarenessStage: string | null;
  style: string | null;
  notes: string | null;
  previewSourceUrl: string | null;
  pdfSourceUrl: string | null;
  previewObjectPath: string | null;
  previewContentType: string | null;
  previewStatus: "pending" | "ok" | "failed" | null;
  previewError: string | null;
  updatedAt: string;
};

export type FunnelsResearchBoardFacets = {
  types: string[];
  awarenessStages: string[];
};

export type FunnelsResearchBoardResponse = {
  items: FunnelsResearchBoardItem[];
  page: number;
  pageSize: number;
  total: number;
  facets: FunnelsResearchBoardFacets;
  lastSyncedAt: string | null;
  lastSyncOk: boolean | null;
  lastSyncError: string | null;
};

export type FunnelsResearchBoardQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: string[];
  awarenessStage?: string[];
};

function buildFunnelsResearchBoardQueryString(q: FunnelsResearchBoardQuery = {}): string {
  const sp = new URLSearchParams();
  if (q.page && q.page > 1) sp.set("page", String(q.page));
  if (q.pageSize) sp.set("pageSize", String(q.pageSize));
  if (q.search && q.search.trim()) sp.set("search", q.search.trim());
  for (const t of q.type || []) sp.append("type", t);
  for (const a of q.awarenessStage || []) sp.append("awarenessStage", a);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// hint: Logic changed on both sides. Requires understanding intent of each change.
export const api = {
  fetchApi,
  fetchAuthed,

  getMe: () => fetchApi("/me"),
  getPlatinumClubResources: (): Promise<PlatinumClubResourcesResponse> =>
    fetchApi("/platinum-club/resources"),
  adminListPlatinumClubResources: (): Promise<PlatinumClubAdminResponse> =>
    fetchApi("/platinum-club/admin/resources"),
  adminCreatePlatinumClubResource: (
    data: PlatinumClubResourceInput,
  ): Promise<{ id: number }> =>
    fetchApi("/platinum-club/admin/resources", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  adminUpdatePlatinumClubResource: (
    id: number,
    data: Partial<PlatinumClubResourceInput>,
  ): Promise<{ ok: true }> =>
    fetchApi(`/platinum-club/admin/resources/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  adminDeletePlatinumClubResource: (id: number): Promise<{ ok: true }> =>
    fetchApi(`/platinum-club/admin/resources/${id}`, { method: "DELETE" }),
  adminReorderPlatinumClubResources: (
    section: string,
    orderedIds: number[],
  ): Promise<{ ok: true }> =>
    fetchApi("/platinum-club/admin/resources/reorder", {
      method: "PATCH",
      body: JSON.stringify({ section, orderedIds }),
    }),
  adminCreatePlatinumClubBuild: (
    label: string,
  ): Promise<{ id: number; slug: string }> =>
    fetchApi("/platinum-club/admin/builds", {
      method: "POST",
      body: JSON.stringify({ label }),
    }),
  adminUpdatePlatinumClubBuild: (
    id: number,
    data: { label?: string; isActive?: boolean },
  ): Promise<{ ok: true }> =>
    fetchApi(`/platinum-club/admin/builds/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  adminReorderPlatinumClubBuilds: (
    orderedIds: number[],
  ): Promise<{ ok: true }> =>
    fetchApi("/platinum-club/admin/builds/reorder", {
      method: "PATCH",
      body: JSON.stringify({ orderedIds }),
    }),
  adminDeletePlatinumClubBuild: (id: number): Promise<{ ok: true }> =>
    fetchApi(`/platinum-club/admin/builds/${id}`, { method: "DELETE" }),
  getAdResearchBoard: (q: AdResearchBoardQuery = {}): Promise<AdResearchBoardResponse> =>
    fetchApi(`/ad-research-board/items${buildAdResearchBoardQueryString(q)}`),
  syncAdResearchBoard: (): Promise<{ ok: boolean; result?: any; error?: string }> =>
    fetchApi("/admin/ad-research-board/sync", { method: "POST" }),
  adminRefetchAdMedia: (id: number): Promise<{ ok: boolean; error?: string }> =>
    fetchApi(`/admin/ad-research-board/items/${id}/refetch-media`, { method: "POST" }),
  adminProcessPendingMedia: (): Promise<{ ok: boolean; queued?: boolean }> =>
    fetchApi("/admin/ad-research-board/process-pending-media", { method: "POST" }),
  adminRequeueFailedAdMedia: (): Promise<{ ok: boolean; requeued?: number }> =>
    fetchApi("/admin/ad-research-board/requeue-failed", { method: "POST" }),
  adminRequeueIncompleteCarousels: (): Promise<{ ok: boolean; requeued?: number }> =>
    fetchApi("/admin/ad-research-board/requeue-incomplete-carousels", { method: "POST" }),
  adminDismissAdResearchBoardItem: (id: number): Promise<{ ok: boolean; id?: number; error?: string }> =>
    fetchApi(`/admin/ad-research-board/items/${id}/dismiss`, { method: "POST" }),
  adminUnhideAdResearchBoardItem: (id: number): Promise<{ ok: boolean; id?: number; error?: string }> =>
    fetchApi(`/admin/ad-research-board/items/${id}/unhide`, { method: "POST" }),
  adminRetryPartialCarousels: (): Promise<{ ok: boolean; requeued?: number }> =>
    fetchApi("/admin/ad-research-board/retry-partials", { method: "POST" }),
  adminAdResearchBoardPipelineCounts: (): Promise<{
    ok: boolean;
    status: { ok: number; failed: number; pending: number; downloading: number; partial: number; stuck: number };
    hidden: number;
    dismissed: number;
    partialCarousels: number;
    byUrlKind: Record<string, number>;
  }> => fetchApi("/admin/ad-research-board/pipeline-counts"),
  // Task #137 (next-stage hardening): comprehensive queue-health snapshot
  // for the admin dashboard. Polled every 10s by the dashboard panel.
  adminAdResearchBoardQueueHealth: (): Promise<{
    ok: boolean;
    workerId: string;
    status: { ok: number; failed: number; pending: number; downloading: number; partial: number; stuck: number };
    // Task #151: real-outcome metrics. See media-downloader.ts for the
    // server-side definitions; the dashboard's two-row metric strip and
    // Failure Breakdown chips read from this block.
    outcomes: {
      totalProcessed: number; usableMedia: number; successRateBp: number;
      terminalFailures: number; dismissedTotal: number; retrying: number;
      authBlocked: number; rateLimited: number; providerFailures: number;
      buckets: { auth: number; "rate-limit": number; quota: number; unavailable: number; dead: number; retryable: number };
    };
    active: { rows: number; workers: Array<{ owner: string; rows: number; oldestLeaseSecLeft: number | null }> };
    recentFailures: Array<{ rowKey: string; adLink: string; mediaError: string | null; mediaErrorClass: string | null; attempts: number; updatedAt: string; platform: "ig" | "fb" | "yt" | "other"; bucket: "auth" | "rate-limit" | "quota" | "unavailable" | "dead" | "retryable"; terminal: boolean }>;
    errorClasses: Record<string, number>;
    attemptsHistogram: Record<string, number>;
    processingMs: { count: number; avg: number | null; p50: number | null; p95: number | null; max: number | null };
    throughput: { last1h: number; last24h: number };
    // Task #165: optional auth/provider blocks used by the simplified
    // Extraction Provider Status card. Server returns these fields; the
    // type makes them optional because room30 historically did not need
    // them for the panel.
    auth?: {
      health: Array<{
        platform: "ig" | "fb";
        status: "ok" | "degraded" | "expired" | "unknown";
        lastSuccessAt: string | null; lastFailureAt: string | null;
        lastError: string | null; lastErrorClass: string | null;
        lastProbeAt: string | null; probeUrl: string | null;
      }>;
      authFailures1h: number;
      authFailures24h: number;
      authFailureRatio1h: number;
      severity: "ok" | "warning" | "critical";
    };
    providers?: {
      apifySuccess: number;
      ytdlpSuccess: number;
      escalationCount: number;
      escalationRecovered: number;
      escalationRecoveryRate: number;
    };
    // Task #194: worker liveness signal. `isStale` flips true when the
    // worker has missed >staleThresholdSec of heartbeats AND there are
    // zero active leases - i.e. the Media Worker process is dead.
    worker?: {
      lastSnapshotAt: string | null;
      ageSeconds: number | null;
      staleThresholdSec: number;
      activeLeases: number;
      isStale: boolean;
    };
    // Task #366: latest sync session summary so the queue-health
    // panel can surface source-row drop counts (rowsSkipped) right
    // next to the queue mechanics.
    sourceSync?: {
      sessionId: number;
      startedAt: string;
      completedAt: string | null;
      status: string;
      rowsFetched: number;
      rowsProcessed: number;
      rowsSkipped: number;
    } | null;
    generatedAt: string;
  }> => fetchApi("/admin/ad-research-board/queue-health"),
  // Task #401: dedicated live-health endpoint. Reads ONLY current row
  // state - never 24h aggregates or session-event history - so the
  // live badge can never be polluted by historical exhausted failures
  // or stale aggregates. Severity is a pure function of current
  // pending depth, retryable failures, and stuck-downloading rows.
  adminAdResearchBoardLiveHealth: (): Promise<{
    ok: boolean;
    severity: "healthy" | "warning" | "critical";
    pending: number;
    downloading: number;
    retryableFailures: number;
    stuckDownloading: number;
    stuckThresholdMinutes: number;
    activeSyncSession: { id: number; startedAt: string; status: string } | null;
    readAt: string;
  }> => fetchApi("/admin/ad-research-board/live-health"),
  // Task #237: admin-only "Reset Provider Mix" action. Zeroes ONLY
  // the provider-mix counter columns across queue_metrics snapshot
  // rows and the in-memory provider accumulator on the Media Worker.
  // Snapshot row count, status counts, throughput, processing latency,
  // verification benchmark, board rows, sync sessions, media files,
  // and dismissed/recovery state are all explicitly preserved. Pass
  // `dryRun: true` to preview the diff without mutating.
  // Task #237 (window-only reset): admin-only "Reset 24h analytics
  // window" action. Sets the analytics window cutoff to now (or clears
  // it with `clear: true`), which makes every rolling-window query in
  // getQueueHealth() clamp to MAX(now-24h, cutoff). Underlying queue
  // items are NEVER touched - only the rolling-window views start
  // fresh. Pass `dryRun: true` to preview without mutating.
  adminAdResearchBoardQueueHealthResetWindow: (input: {
    confirm?: "RESET_WINDOW";
    clear?: boolean;
    dryRun?: boolean;
  }): Promise<{
    ok: boolean;
    dryRun: boolean;
    actor: string;
    message: string;
    previousCutoff: string | null;
    newCutoff: string | null;
  }> =>
    fetchApi("/admin/ad-research-board/queue-health/reset-window", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  adminAdResearchBoardQueueHealthReset: (input: {
    confirm: "RESET_QUEUE_HEALTH";
    dryRun?: boolean;
  }): Promise<{
    ok: boolean;
    dryRun: boolean;
    actor: string;
    requestedAt?: string;
    acknowledgedAt?: string | null;
    workerAcknowledged?: boolean;
    message: string;
    before: {
      preserved: { adResearchBoardItems: number; dismissedItems: number; syncSessions: number; syncSessionEvents: number; adResearchBoardQueueMetricsRows: number; lastVerificationBenchmarkPresent: boolean };
      cleared: { providerMixCounterSum: number };
    };
    after: {
      preserved: { adResearchBoardItems: number; dismissedItems: number; syncSessions: number; syncSessionEvents: number; adResearchBoardQueueMetricsRows: number; lastVerificationBenchmarkPresent: boolean };
      cleared: { providerMixCounterSum: number };
    };
  }> =>
    fetchApi("/admin/ad-research-board/queue-health/reset", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  // Task #165 (parity): probe + diagnose endpoints used by the Apify
  // Session Health card inside Advanced Diagnostics.
  adminRunExtractionProbe: (): Promise<{
    ok: boolean;
    jars?: Array<unknown>;
    health?: Array<unknown>;
    error?: string;
  }> => fetchApi("/admin/extraction/probe", { method: "POST" }),
  adminDiagnoseExtraction: (
    url: string,
    platform?: "ig" | "fb" | null,
  ): Promise<{
    ok: boolean;
    error?: string;
    result?: {
      ok: boolean;
      url: string;
      platform: "ig" | "fb" | null;
      jarId: number | null;
      slideCount: number;
      errorClass: string | null;
      error: string | null;
      durationMs: number;
      stages: {
        reachability: { ok: boolean; errorClass: string | null; error: string | null; durationMs: number };
        extraction:   { ok: boolean; errorClass: string | null; error: string | null; durationMs: number };
        escalation:   { ok: boolean; errorClass: string | null; error: string | null; durationMs: number };
      };
    };
  }> =>
    fetchApi("/admin/extraction/diagnose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, platform: platform ?? null }),
    }),
  // Task #137 (scaling pass): historical trend snapshots written by the
  // downloader's recordQueueMetricsSnapshot loop. Powers the dashboard
  // sparklines for throughput, failures, and queue depth.
  adminAdResearchBoardQueueTrends: (hours = 24): Promise<{
    ok: boolean;
    windowHours: number;
    points: Array<{
      capturedAt: string;
      statusPending: number; statusDownloading: number; statusOk: number;
      statusFailed: number; statusPartial: number; stuck: number;
      activeLeases: number;
      throughput1h: number; throughput24h: number; failures1h: number;
      avgProcessingMs: number | null; p95ProcessingMs: number | null;
      // Task #151: outcome sparkline fields.
      totalRows: number; usableMedia: number; successRateBp: number;
      terminalFailures: number; dismissedTotal: number;
      authFailures24h: number; rateLimits24h: number;
      providerFailures24h: number; retryVolume24h: number;
    }>;
  }> => fetchApi(`/admin/ad-research-board/queue-trends?hours=${encodeURIComponent(String(hours))}`),
  // Task #137: user-facing self-heal endpoint hit by MediaPreview when a
  // cached video / image fails to load. Server is rate-limited and
  // idempotent so the frontend can safely retry without coordination.
  refetchAdResearchBoardItem: (
    id: number,
  ): Promise<{ ok: boolean; requeued?: boolean; reason?: string; error?: string }> =>
    fetchApi(`/ad-research-board/items/${id}/refetch`, { method: "POST" }),
  getFunnelsResearchBoard: (q: FunnelsResearchBoardQuery = {}): Promise<FunnelsResearchBoardResponse> =>
    fetchApi(`/funnels-research-board/items${buildFunnelsResearchBoardQueryString(q)}`),
  syncFunnelsResearchBoard: (): Promise<{ ok: boolean; result?: any; error?: string }> =>
    fetchApi("/admin/funnels-research-board/sync", { method: "POST" }),
  // Per-run sync session inspection. Powers the LIVE mode toggle on the
  // research board dashboards so the operational summary strip can be
  // scoped to the latest sync_session instead of the rolling 24h window.
  adminAdResearchBoardLiveSession: (): Promise<SyncSessionLiveResponse> =>
    fetchApi("/admin/ad-research-board/live-session"),
  adminFunnelsResearchBoardLiveSession: (): Promise<SyncSessionLiveResponse> =>
    fetchApi("/admin/funnels-research-board/live-session"),
  getVslTemplateLinks: (): Promise<{ links: Record<string, string | null> }> =>
    fetchApi("/vsl-template-links"),
  setVslTemplateLink: (slug: string, url: string | null): Promise<{ ok: boolean; slug: string; url: string | null }> =>
    fetchApi(`/admin/vsl-template-links/${encodeURIComponent(slug)}`, {
      method: "PUT",
      body: JSON.stringify({ url }),
    }),
  enroll: () => fetchApi("/enroll", { method: "POST" }),
  getOnboardingCallStatus,
  markOnboardingCallPromptSeen,
  getStrategyCallBookingStatus: (): Promise<{
    hasBooking: boolean;
    booking: {
      startTime: string | null;
      endTime: string | null;
      eventUri: string;
      rescheduleUrl: string | null;
      cancelUrl: string | null;
      status: string;
    } | null;
    schedulingUrl: string | null;
    isAdmin?: boolean;
    apiError?: boolean;
  }> => fetchApi("/strategy-call/booking-status"),
  getCourse: () => fetchApi("/course"),
  getLesson: (slug: string) => fetchApi(`/lessons/${slug}`),
  updateProgress: (slug: string, data: any) =>
    fetchApi(`/lessons/${slug}/progress`, { method: "POST", body: JSON.stringify(data) }),
  toggleActionTask: (slug: string, completed: boolean) =>
    fetchApi(`/lessons/${slug}/progress`, { method: "POST", body: JSON.stringify({ actionTaskCompleted: completed }) }),
  toggleActionTaskAt: (slug: string, index: number, completed: boolean) =>
    fetchApi(`/lessons/${slug}/action-tasks/toggle`, { method: "POST", body: JSON.stringify({ index, completed }) }),

  getBrainProfile: () => fetchApi("/brain"),
  saveBrainProfile: (data: any) =>
    fetchApi("/brain", { method: "PUT", body: JSON.stringify(data) }),
  generateBrain: () =>
    fetchApi("/brain/generate", { method: "POST" }),
  scrapeBrandColors: (url: string) =>
    fetchApi("/brain/scrape-colors", { method: "POST", body: JSON.stringify({ url }) }),
  getPrebuiltBrains: (): Promise<{ brains: Array<{
    id: string;
    name: string;
    tagline: string;
    shortDescription: string;
    audience: string;
    highlights: string[];
    badge: string | null;
    comingSoon: boolean;
  }> }> => fetchApi("/brain/prebuilt"),
  getPrebuiltBrain: (id: string): Promise<{ brain: {
    id: string;
    name: string;
    tagline: string;
    shortDescription: string;
    audience: string;
    highlights: string[];
    badge: string | null;
    brainData: {
      name: string;
      companyName: string;
      whoDoYouHelp: string;
      howDoYouHelpThem: string;
      keyAchievements: string;
    };
    generatedBrain: string;
  } }> => fetchApi(`/brain/prebuilt/${encodeURIComponent(id)}`),

  getExpertiseProfile: () => fetchApi("/expertise"),
  saveExpertiseProfile: (answers: Record<string, string>) =>
    fetchApi("/expertise", { method: "PUT", body: JSON.stringify({ answers }) }),
  generateExpertiseProfile: () =>
    fetchApi("/expertise/generate", { method: "POST" }),

  generateOSTool: (slug: string, answers: Record<string, string>): Promise<{ jobId: number; job: OsToolGenerationJob }> =>
    fetchApi(`/os-tools/${slug}/generate`, { method: "POST", body: JSON.stringify({ answers }) }),
  getOSToolGenerationJob: (id: number): Promise<{ job: OsToolGenerationJob }> =>
    fetchApi(`/os-tools/generation-jobs/${id}`),
  getActiveOSToolGenerationJob: (slug: string): Promise<{ job: OsToolGenerationJob | null }> =>
    fetchApi(`/os-tools/generation-jobs/active?slug=${encodeURIComponent(slug)}`),
  dismissOSToolGenerationJob: (id: number) =>
    fetchApi(`/os-tools/generation-jobs/${id}/dismiss`, { method: "POST" }),
  getOSToolSavedAsset: (slug: string): Promise<{ asset: any | null }> =>
    fetchApi(`/os-tools/${encodeURIComponent(slug)}/saved`),
  getOSToolSavedList: (slug: string): Promise<{ assets: any[]; max: number }> =>
    fetchApi(`/os-tools/${encodeURIComponent(slug)}/saved-list`),
  deleteOSToolSavedAsset: (slug: string, assetId: number) =>
    fetchApi(`/os-tools/${encodeURIComponent(slug)}/saved/${assetId}`, { method: "DELETE" }),
  getOSToolGenerationQuota: (slug: string): Promise<{
    lifetimeUsed: number;
    freeQuota: number;
    freeRemaining: number;
    creditCost: number;
    balance: number;
    unlimited?: boolean;
    isAdmin?: boolean;
    gregAiUnlimited?: boolean;
  }> =>
    fetchApi(`/os-tools/${encodeURIComponent(slug)}/quota`),

  // OS tool credit pool (separate from research credits).
  getOSToolCreditBalance: (): Promise<{ balance: number }> =>
    fetchApi(`/os-tools/credits/balance`),
  getOSToolCreditPacks: (): Promise<{ packs: { id: string; credits: number; amountCents: number; label: string; tagline: string }[] }> =>
    fetchApi(`/os-tools/credits/packs`),
  purchaseOSToolCredits: (packId: string, returnPath?: string): Promise<{ url: string; sessionId: string }> =>
    fetchApi(`/os-tools/credits/purchase`, { method: "POST", body: JSON.stringify({ packId, returnPath }) }),
  confirmOSToolCredits: (sessionId: string): Promise<{ granted: boolean; alreadyGranted?: boolean; creditsGranted: number; balance: number; packId?: string }> =>
    fetchApi(`/os-tools/credits/confirm`, { method: "POST", body: JSON.stringify({ sessionId }) }),
  getOSToolCreditPurchases: (): Promise<{ purchases: any[] }> =>
    fetchApi(`/os-tools/credits/purchases`),

  // Live workshops (monthly 2-hour live calls with Greg).
  listWorkshops: (): Promise<{ workshops: Array<{ id: number; title: string; description: string | null; startsAt: string; durationMinutes: number; meetingUrl: string; recordingUrl: string | null; createdBy: string | null; createdAt: string; updatedAt: string }> }> =>
    fetchApi(`/workshops`),
  createWorkshop: (data: { title: string; description?: string; startsAt: string; durationMinutes?: number; meetingUrl: string; recordingUrl?: string }) =>
    fetchApi(`/workshops`, { method: "POST", body: JSON.stringify(data) }),
  updateWorkshop: (id: number, data: { title?: string; description?: string; startsAt?: string; durationMinutes?: number; meetingUrl?: string; recordingUrl?: string | null }) =>
    fetchApi(`/workshops/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteWorkshop: (id: number) =>
    fetchApi(`/workshops/${id}`, { method: "DELETE" }),

  // (Workshop recording types declared above the api object - see WorkshopRecording* types.)
  // Workshop recordings (Platinum Club library of past workshop replays).
  listWorkshopRecordings: (): Promise<{ recordings: WorkshopRecordingMember[] }> =>
    fetchApi(`/workshop-recordings`),
  getWorkshopRecording: (id: number): Promise<{ recording: WorkshopRecordingMember }> =>
    fetchApi(`/workshop-recordings/${id}`),

  // Returns the raw response (does not throw on non-2xx) so callers can detect
  // 402 needs_credit and prompt the user to buy a pack instead of crashing.
  generateOSToolRaw: async (slug: string, answers: Record<string, string>) => {
    const res = await fetchAuthed(`/os-tools/${slug}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  },
  refineOSTool: (slug: string, currentContent: string, refinePrompt: string, opts?: { currentSlides?: any[]; vslStyle?: string }) =>
    fetchApi(`/os-tools/${slug}/refine`, { method: "POST", body: JSON.stringify({ currentContent, refinePrompt, currentSlides: opts?.currentSlides, vslStyle: opts?.vslStyle }), timeoutMs: 180000 }),
  generateLowTicketOfferDoc: (offerStackContent: string) =>
    fetchApi(`/os-tools/low-ticket-offer-build/offer-doc`, { method: "POST", body: JSON.stringify({ offerStackContent }), timeoutMs: 180000 }),
  saveOSTool: (slug: string, data: { content: string; title: string; category: string }) =>
    fetchApi(`/os-tools/${slug}/save`, { method: "POST", body: JSON.stringify(data) }),
  getOSToolSaveJob: (id: number) =>
    fetchApi(`/os-tools/save-jobs/${id}`),
  getActiveOSToolSaveJob: (): Promise<{ job: OsToolSaveJob | null }> =>
    fetchApi(`/os-tools/save-jobs/active`),
  getRecentOSToolSaveJobs: (): Promise<{ jobs: OsToolSaveJob[] }> =>
    fetchApi(`/os-tools/save-jobs/recent`),
  retryOSToolSaveJob: (id: number) =>
    fetchApi(`/os-tools/save-jobs/${id}/retry`, { method: "POST" }),
  uploadProofImage: async (file: File) => {
    const formData = new FormData();
    formData.append("image", file);
    const headers: Record<string, string> = {};
    if (_getToken) {
      try {
        const token = await _getToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
      } catch {}
    }
    const res = await fetch(`${API_BASE}/upload-proof-image`, {
      method: "POST",
      credentials: "include",
      headers,
      body: formData,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Upload failed: ${res.status}`);
    }
    return res.json();
  },

  extractProofLink: (url: string) =>
    fetchApi(`/extract-proof-link`, { method: "POST", body: JSON.stringify({ url }) }),

  startResearchGeneration: (additionalContext: string) =>
    fetchApi(`/research/generate`, { method: "POST", body: JSON.stringify({ additionalContext }) }),
  getResearchJob: (jobId: number) =>
    fetchApi(`/research/jobs/${jobId}`),
  getLatestResearchJob: () =>
    fetchApi(`/research/latest`),
  getResearchEntitlement: () => fetchApi(`/research/entitlement`),
  purchaseResearchCredit: () =>
    fetchApi(`/research/purchase-credit`, { method: "POST" }),
  confirmResearchCredit: (sessionId: string) =>
    fetchApi(`/research/confirm-credit`, { method: "POST", body: JSON.stringify({ sessionId }) }),
  getResearchPurchases: () => fetchApi(`/research/purchases`),

  // Self-service account management. Backs the redesigned Settings page.
  // creditsStatus stays silent in the UI until overLimit flips true.
  me: {
    creditsStatus: () => fetchApi(`/me/credits-status`),
    updateProfile: (data: { firstName?: string; lastName?: string; email?: string }) =>
      fetchApi(`/me/profile`, { method: "PATCH", body: JSON.stringify(data) }),
    resetPassword: () => fetchApi(`/me/password-reset`, { method: "POST" }),
    dismissCreditsNotice: () =>
      fetchApi(`/me/credits-notice/dismiss`, { method: "POST" }),
    dismissFounderNotice: () =>
      fetchApi(`/me/founder-notice/dismiss`, { method: "POST" }),
  },

  // Generic helper that DOESN'T throw on non-2xx — caller inspects response
  startResearchGenerationRaw: async (additionalContext: string) => {
    const res = await fetchAuthed(`/research/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ additionalContext }),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  },

  getAssets: () => fetchApi("/assets"),
  getKpiPrefill: () => fetchApi("/os-tools/kpi-generator/prefill"),
  createAsset: (data: { category: string; title: string; content: string; lessonSlug?: string; assetType?: string }) =>
    fetchApi("/assets", { method: "POST", body: JSON.stringify(data) }),
  upsertAsset: (data: { category: string; title: string; content: string; assetType?: string }) =>
    fetchApi("/assets/upsert", { method: "POST", body: JSON.stringify(data) }),
  updateAsset: (id: number, data: { title?: string; content?: string; category?: string }) =>
    fetchApi(`/assets/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteAsset: (id: number) =>
    fetchApi(`/assets/${id}`, { method: "DELETE" }),
  refineAsset: (id: number, refinePrompt: string) =>
    fetchApi(`/assets/${id}/refine`, { method: "POST", body: JSON.stringify({ refinePrompt }) }),

  support: {
    getArticles: (search?: string, category?: string) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (category) params.set("category", category);
      return fetchApi(`/support/articles?${params.toString()}`);
    },
    getArticle: (slug: string) => fetchApi(`/support/articles/${slug}`),
    sendMessage: (message: string, chatId?: number) =>
      fetchApi("/support/chat", { method: "POST", body: JSON.stringify({ message, chatId }) }),
    getChatHistory: () => fetchApi("/support/chat/history"),
    requestRefund: () => fetchApi("/support/refund-request", { method: "POST" }),
  },

  alist: {
    getDashboard: () => fetchApi("/a-list/dashboard"),
    createCall: (data: any) => fetchApi("/a-list/calls", { method: "POST", body: JSON.stringify(data) }),
    updateCall: (callId: number, data: any) =>
      fetchApi(`/a-list/calls/${callId}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteCall: (callId: number) =>
      fetchApi(`/a-list/calls/${callId}`, { method: "DELETE" }),
    createTask: (data: any) => fetchApi("/a-list/tasks", { method: "POST", body: JSON.stringify(data) }),
    updateTask: (taskId: number, data: any) =>
      fetchApi(`/a-list/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(data) }),
    createRoadmap: (data: any) => fetchApi("/a-list/roadmap", { method: "POST", body: JSON.stringify(data) }),
    updateRoadmap: (itemId: number, data: any) =>
      fetchApi(`/a-list/roadmap/${itemId}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteRoadmap: (itemId: number) =>
      fetchApi(`/a-list/roadmap/${itemId}`, { method: "DELETE" }),
    listAdminBuildAssets: (userId: number) =>
      fetchApi(`/a-list/admin/build-assets/${userId}`),
    listAdminCalls: (userId: number) =>
      fetchApi(`/a-list/admin/calls/${userId}`),
    listAdminRoadmap: (userId: number) =>
      fetchApi(`/a-list/admin/roadmap/${userId}`),
    createBuildAsset: (data: any) =>
      fetchApi("/a-list/build-assets", { method: "POST", body: JSON.stringify(data) }),
    updateBuildAsset: (id: number, data: any) =>
      fetchApi(`/a-list/build-assets/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteBuildAsset: (id: number) =>
      fetchApi(`/a-list/build-assets/${id}`, { method: "DELETE" }),
    connectStripe: (stripeApiKey: string, accountLabel?: string) =>
      fetchApi("/a-list/connect-stripe", { method: "POST", body: JSON.stringify({ stripeApiKey, accountLabel }) }),
    disconnectStripe: () =>
      fetchApi("/a-list/disconnect-stripe", { method: "POST" }),
    adminRevenue: (userId: number) =>
      fetchApi(`/a-list/admin/revenue/${userId}`),
    setPhase: (userId: number, phase: number) =>
      fetchApi(`/a-list/admin/set-phase/${userId}`, { method: "PATCH", body: JSON.stringify({ phase }) }),
    listClientUpdates: () => fetchApi(`/a-list/client-updates`),
    listAdminClientUpdates: (userId: number) =>
      fetchApi(`/a-list/admin/client-updates/${userId}`),
    createClientUpdate: (data: { userId?: number; title?: string; body: string; kind?: string; phaseNumber?: number; parentId?: number }) =>
      fetchApi(`/a-list/client-updates`, { method: "POST", body: JSON.stringify(data) }),
    updateClientUpdate: (id: number, data: { status?: string; body?: string; title?: string }) =>
      fetchApi(`/a-list/client-updates/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteClientUpdate: (id: number) =>
      fetchApi(`/a-list/client-updates/${id}`, { method: "DELETE" }),
    seedDemo: (email?: string) =>
      fetchApi(`/a-list/admin/seed-demo`, { method: "POST", body: JSON.stringify({ email }) }),
  },

  dfyPack: {
    listHighlightCovers: (): Promise<{
      covers: Array<{
        id: number;
        title: string;
        sortOrder: number;
        contentType: string;
        fileSize: number;
        originalFilename: string | null;
        url: string;
        thumbnailUrl: string;
        createdAt: string | null;
        updatedAt: string | null;
      }>;
    }> => fetchApi("/dfy-pack/highlight-covers"),
    downloadAllUrl: () => `${API_BASE}/dfy-pack/highlight-covers/zip`,
    uploadHighlightCovers: async (files: File[], titles?: string[]) => {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      for (const t of titles || []) fd.append("titles", t);
      const headers: Record<string, string> = { "X-Portal-Key": "room30" };
      if (_getToken) {
        try {
          const token = await withTimeout(_getToken(), 8000, "auth token");
          if (token) headers["Authorization"] = `Bearer ${token}`;
        } catch {}
      }
      const res = await fetch(`${API_BASE}/admin/dfy-pack/highlight-covers`, {
        method: "POST",
        credentials: "include",
        headers,
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Upload failed (${res.status})`);
      return data;
    },
    updateHighlightCover: (id: number, data: { title?: string; sortOrder?: number }) =>
      fetchApi(`/admin/dfy-pack/highlight-covers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteHighlightCover: (id: number) =>
      fetchApi(`/admin/dfy-pack/highlight-covers/${id}`, { method: "DELETE" }),
  },

  // T257: Background Reel Music library.
  backgroundMusic: {
    list: (
      // T396: cursor is now an opaque base64 string (encoded
      // {seed,offset}) so the server can keep shuffle ordering stable
      // across pages within one visit.
      params: { q?: string; cursor?: string; limit?: number } = {},
    ): Promise<{
      tracks: Array<{
        id: number;
        title: string;
        trackCode: string | null;
        originalFilename: string;
        durationSeconds: number | null;
        fileSize: number | null;
        mimeType: string;
        sortOrder: number;
        isActive: boolean;
        previewUrl: string;
        downloadUrl: string;
      }>;
      nextCursor: string | null;
      isAdmin: boolean;
    }> => {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.cursor) qs.set("cursor", params.cursor);
      if (params.limit) qs.set("limit", String(params.limit));
      const tail = qs.toString();
      return fetchApi(`/dfy/background-music${tail ? `?${tail}` : ""}`);
    },
    previewSrc: (id: number) => `${API_BASE}/dfy/background-music/${id}/preview`,
    downloadHref: (id: number) => `${API_BASE}/dfy/background-music/${id}/download`,
    admin: {
      refresh: (): Promise<{ job: BackgroundMusicJob }> =>
        fetchApi("/admin/dfy/background-music/refresh", { method: "POST" }),
      getJob: (id: string): Promise<{ job: BackgroundMusicJob }> =>
        fetchApi(`/admin/dfy/background-music/jobs/${encodeURIComponent(id)}`),
      activeJob: (): Promise<{ job: BackgroundMusicJob | null }> =>
        fetchApi(`/admin/dfy/background-music/active-job`),
      update: (
        id: number,
        data: { title?: string; isActive?: boolean; sortOrder?: number },
      ) =>
        fetchApi(`/admin/dfy/background-music/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),
    },
  },

  leaderboard: {
    getData: (period: string = "month") => fetchApi(`/leaderboard?period=${period}`),
    getMyProfile: () => fetchApi("/leaderboard/my-profile"),
    updateProfile: (data: { tagName: string; niche?: string; avatarUrl?: string; isPublic?: boolean }) =>
      fetchApi("/leaderboard/profile", { method: "POST", body: JSON.stringify(data) }),
    connectStripe: (stripeApiKey: string) =>
      fetchApi("/leaderboard/connect-stripe", { method: "POST", body: JSON.stringify({ stripeApiKey }) }),
    disconnectStripe: () =>
      fetchApi("/leaderboard/disconnect-stripe", { method: "POST" }),
    syncMyRevenue: () =>
      fetchApi("/leaderboard/sync-my-revenue", { method: "POST" }),
  },

  getPageNotes: (slug: string): Promise<{ pageSlug: string; pageTitle: string; notes: string | null; updatedAt: string | null }> =>
    fetchApi(`/page-notes/${encodeURIComponent(slug)}`),

  admin: {
    updatePageNotes: (slug: string, notes: string) =>
      fetchApi(`/admin/page-notes/${encodeURIComponent(slug)}`, { method: "PUT", body: JSON.stringify({ notes }) }),
    generatePageNotes: (slug: string, transcript: string, context?: string, style?: string) =>
      fetchApi(`/admin/page-notes/${encodeURIComponent(slug)}/generate-notes`, { method: "POST", body: JSON.stringify({ transcript, context, style }) }),
    editPageNotesAi: (slug: string, currentHtml: string, editPrompt: string) =>
      fetchApi(`/admin/page-notes/${encodeURIComponent(slug)}/edit-notes-ai`, { method: "POST", body: JSON.stringify({ currentHtml, editPrompt }) }),
    updateLessonTitle: (slug: string, title: string) =>
      fetchApi(`/admin/lessons/${slug}/title`, { method: "PUT", body: JSON.stringify({ title }) }),
    updateLessonNotes: (slug: string, notes: string) =>
      fetchApi(`/admin/lessons/${slug}/notes`, { method: "PUT", body: JSON.stringify({ notes }) }),
    updateLessonBrief: (slug: string, brief: string) =>
      fetchApi(`/admin/lessons/${slug}/brief`, { method: "PUT", body: JSON.stringify({ brief }) }),
    updateLessonActionTasks: (slug: string, tasks: string[]) =>
      fetchApi(`/admin/lessons/${slug}/action-tasks`, { method: "PUT", body: JSON.stringify({ tasks }) }),
    backfillBriefs: (force = false): Promise<{
      template: string;
      processed: number;
      ok: number;
      errors: number;
      skipped: number;
      report: Array<{ slug: string; status: "ok" | "skipped" | "error"; reason?: string; tasks?: number; usedFallback?: boolean }>;
    }> =>
      fetchApi(`/admin/lessons/backfill-briefs`, { method: "POST", body: JSON.stringify({ force }), timeoutMs: 240000 }),
    backfillResources: (): Promise<{
      template: string;
      template_tail_chars: number;
      total_lessons: number;
      updated: number;
      ok: number;
      appended: number;
      skipped: number;
      errors: number;
      report: Array<{ slug: string; status: "ok" | "appended" | "skipped" | "error"; reason?: string }>;
    }> =>
      fetchApi(`/admin/lessons/backfill-resources`, { method: "POST", body: JSON.stringify({}), timeoutMs: 240000 }),
    updateLessonDownloads: (slug: string, files: Array<{ url: string; name: string }> | null) =>
      fetchApi(`/admin/lessons/${slug}/downloads`, { method: "PUT", body: JSON.stringify({ files }) }),
    updateLessonWistia: (slug: string, wistiaVideoId: string | null) =>
      fetchApi(`/admin/lessons/${slug}/wistia`, { method: "PUT", body: JSON.stringify({ wistiaVideoId }) }),
    updateLessonStatus: (slug: string, status: "draft" | "coming_soon" | "published") =>
      fetchApi(`/admin/lessons/${slug}/status`, { method: "PUT", body: JSON.stringify({ status }) }),
    getLessons: (): Promise<Array<{
      id: number; slug: string; title: string; sortOrder: number;
      lessons: Array<{
        id: number; slug: string; title: string;
        status: "draft" | "coming_soon" | "published";
        wistiaVideoId: string | null; sortOrder: number; phaseId: number;
      }>;
    }>> =>
      fetchApi(`/admin/lessons`),
    generateNotes: (slug: string, transcript: string, context?: string, style?: string) =>
      fetchApi(`/admin/lessons/${slug}/generate-notes`, { method: "POST", body: JSON.stringify({ transcript, context, style }) }),
    editNotesAi: (slug: string, currentHtml: string, editPrompt: string) =>
      fetchApi(`/admin/lessons/${slug}/edit-notes-ai`, { method: "POST", body: JSON.stringify({ currentHtml, editPrompt }) }),
    generateDiagram: (description: string, diagramType?: string) =>
      fetchApi(`/admin/generate-diagram`, { method: "POST", body: JSON.stringify({ description, diagramType }) }),
    getUsers: () => fetchApi("/admin/users"),
    getAnalytics: () => fetchApi("/admin/analytics"),
    getHealthCheck: (): Promise<{
      ranAt: string;
      durationMs: number;
      hasFindings: boolean;
      audits: Array<{
        name: string;
        label: string;
        severity: "ok" | "warn" | "error";
        summary: string;
        count: number;
        details?: Record<string, unknown>;
      }>;
    }> => fetchApi("/admin/health-check", { timeoutMs: 60000 }),
    getCheckoutConversion: (
      range: "today" | "24h" | "7d" | "30d" = "7d",
      bucket?: "hour" | "day",
    ): Promise<{
      range: string;
      bucket: "hour" | "day";
      since: string;
      generatedAt: string;
      totals: { started: number; paid: number; abandoned: number; revenueCents: number; conversionPct: number };
      series: Array<{ bucket: string; started: number; paid: number; abandoned: number; revenueCents: number; conversionPct: number }>;
    }> => {
      const params = new URLSearchParams({ range });
      if (bucket) params.set("bucket", bucket);
      return fetchApi(`/admin/checkout-conversion?${params.toString()}`);
    },
    getLogs: (
      page = 1,
      limit = 50,
      filters: { email?: string; q?: string; action?: string; ip?: string; since?: string; until?: string } = {},
    ) => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filters.email) params.set("email", filters.email);
      if (filters.q) params.set("q", filters.q);
      if (filters.action) params.set("action", filters.action);
      if (filters.ip) params.set("ip", filters.ip);
      if (filters.since) params.set("since", filters.since);
      if (filters.until) params.set("until", filters.until);
      return fetchApi(`/admin/logs?${params.toString()}`);
    },
    getUserLogs: (userId: number) => fetchApi(`/admin/users/${userId}/logs`),
    createInvite: (
      email: string,
      role: "student" | "team" | "admin" = "student",
      grants: Record<string, boolean> = {},
      team?: { teamRole?: string; permissions?: string[] },
    ) =>
      fetchApi("/admin/invites", {
        method: "POST",
        body: JSON.stringify({
          email,
          role,
          grants,
          ...(role === "team" && team
            ? { teamRole: team.teamRole, permissions: team.permissions }
            : {}),
        }),
      }),
    createManualUser: (opts: {
      email: string;
      firstName?: string;
      lastName?: string;
      role: "student" | "team" | "admin";
      grants: Record<string, boolean>;
      team?: { teamRole?: string; permissions?: string[] };
    }) =>
      fetchApi("/admin/users/manual", {
        method: "POST",
        body: JSON.stringify({
          email: opts.email,
          firstName: opts.firstName || undefined,
          lastName: opts.lastName || undefined,
          role: opts.role,
          grants: opts.grants,
          ...(opts.role === "team" && opts.team
            ? { teamRole: opts.team.teamRole, permissions: opts.team.permissions }
            : {}),
        }),
      }),
    getInvites: () => fetchApi("/admin/invites"),
    updateUserRole: (
      userId: number,
      role: string,
      team?: { teamRole?: string; permissions?: string[] },
    ) =>
      fetchApi(`/admin/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({
          role,
          ...(role === "team" && team
            ? { teamRole: team.teamRole, permissions: team.permissions }
            : {}),
        }),
      }),
    setTeamPermissions: (
      userId: number,
      team: { teamRole?: string; permissions?: string[] },
    ) =>
      fetchApi(`/admin/users/${userId}/team-permissions`, {
        method: "PATCH",
        body: JSON.stringify(team),
      }),
    toggleAList: (userId: number, isAList: boolean) =>
      fetchApi(`/admin/users/${userId}/a-list`, { method: "PATCH", body: JSON.stringify({ isAList }) }),
    getUserAccess: (userId: number) => fetchApi(`/admin/users/${userId}/access`),
    updateUserAccess: (userId: number, patch: Record<string, boolean>) =>
      fetchApi(`/admin/users/${userId}/access`, { method: "PATCH", body: JSON.stringify(patch) }),
    updateInfluencerBonus: (
      userId: number,
      patch: { add?: number; set?: number },
    ): Promise<{
      userId: number;
      email: string;
      bonusInfluencerQuota: number;
      previous: number;
      delta: number;
    }> =>
      fetchApi(`/admin/users/${userId}/influencer-bonus`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    getUserProfile: (userId: number) => fetchApi(`/admin/users/${userId}/profile`),
    updateUserProfile: (
      userId: number,
      patch: { firstName?: string; lastName?: string; email?: string },
    ) =>
      fetchApi(`/admin/users/${userId}/profile`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    resetUserPassword: (userId: number) =>
      fetchApi(`/admin/users/${userId}/reset-password`, { method: "POST" }),
    resendInvite: (userId: number) =>
      fetchApi(`/admin/users/${userId}/resend-invite`, { method: "POST" }),
    deleteUser: (userId: number) =>
      fetchApi(`/admin/users/${userId}`, { method: "DELETE" }),
    // Task #710: super-admin "view as user" impersonation. URL constants
    // and response types are imported from the Orval-generated client so
    // the wire contract stays in lock-step with `lib/api-spec/openapi.yaml`.
    // We keep using `fetchApi` for transport because it already attaches
    // the Clerk bearer token + the `X-Impersonate-Session` header that the
    // generated `customFetch` does not know about.
    startImpersonation: (userId: number): Promise<AdminImpersonationStartResponse> =>
      fetchApi(
        getStartAdminImpersonationUrl(userId),
        { method: "POST" },
      ),
    stopImpersonation: (): Promise<StopAdminImpersonation200> =>
      fetchApi(
        getStopAdminImpersonationUrl(),
        { method: "POST" },
      ),
    getImpersonationStatus: (): Promise<AdminImpersonationStatusResponse> =>
      fetchApi(getGetAdminImpersonationStatusUrl()),
  },

};
