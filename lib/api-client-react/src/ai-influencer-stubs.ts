/**
 * Stub hooks/helpers for the AI Influencer feature.
 *
 * These wrap the AI Influencer backend endpoints with a minimal
 * react-query interface so the imported portal pages compile and
 * mount. They are intentionally thin and intended to be replaced
 * with proper Orval-generated hooks once the OpenAPI spec entries
 * are authored.
 */
import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseQueryResult,
  type UseMutationResult,
  type QueryKey,
} from "@tanstack/react-query";

const BASE = "";

type QueryOpts<TData> = {
  query?: Omit<
    Partial<UseQueryOptions<TData, Error, TData, QueryKey>>,
    "queryKey" | "queryFn"
  >;
};

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${input}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---- Onboarding -----------------------------------------------------

export interface OnboardingProfileSummary {
  id: number;
  status: string;
  buildProgress: number;
  generatedName: string;
}

export interface OnboardingStatus {
  status: "not_started" | "pending" | "rendering" | "complete" | "failed";
  progress: number;
  log: string[];
  avatarUrl: string | null;
  influencerId: number | null;
  profile: OnboardingProfileSummary | null;
}

export interface OnboardingMe {
  profile: OnboardingProfileSummary | null;
}

export const getGetOnboardingStatusQueryKey = (): QueryKey => [
  "onboarding",
  "status",
];

export function useGetOnboardingStatus(
  options?: QueryOpts<OnboardingStatus>,
): UseQueryResult<OnboardingStatus, Error> {
  return useQuery<OnboardingStatus, Error, OnboardingStatus, QueryKey>({
    queryKey: getGetOnboardingStatusQueryKey(),
    queryFn: () => jsonFetch<OnboardingStatus>("/api/onboarding/status"),
    ...options?.query,
  });
}

export function useGetMyOnboarding(
  options?: QueryOpts<OnboardingMe>,
): UseQueryResult<OnboardingMe, Error> {
  return useQuery<OnboardingMe, Error, OnboardingMe, QueryKey>({
    queryKey: ["onboarding", "me"],
    queryFn: () => jsonFetch<OnboardingMe>("/api/onboarding/me"),
    ...options?.query,
  });
}

export interface SubmitOnboardingBody {
  gender: string;
  ageRange: string;
  ethnicity: string;
  brandColorTheme: string;
  generatedName: string;
}

export interface SubmitOnboardingResponse {
  profile: OnboardingProfileSummary;
  jobId: string | null;
}

export async function submitOnboarding(
  body: SubmitOnboardingBody,
): Promise<SubmitOnboardingResponse> {
  return jsonFetch<SubmitOnboardingResponse>("/api/onboarding", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ---- Project / funnel -----------------------------------------------

export interface MyProject {
  project: { id: number; name: string } | null;
}
export interface MyFunnel {
  funnel: { id: number; name: string } | null;
}

export function useGetMyProject(
  options?: QueryOpts<MyProject>,
): UseQueryResult<MyProject, Error> {
  return useQuery<MyProject, Error, MyProject, QueryKey>({
    queryKey: ["project", "me"],
    queryFn: () => jsonFetch<MyProject>("/api/project/me"),
    ...options?.query,
  });
}

export function useGetMyFunnel(
  options?: QueryOpts<MyFunnel>,
): UseQueryResult<MyFunnel, Error> {
  return useQuery<MyFunnel, Error, MyFunnel, QueryKey>({
    queryKey: ["funnel", "me"],
    queryFn: () => jsonFetch<MyFunnel>("/api/funnel/me"),
    ...options?.query,
  });
}

// ---- Influencers ----------------------------------------------------

export interface InfluencerListItem {
  id: number;
  name: string;
  niche: string | null;
  avatarUrl: string | null;
  status: string;
  anglesCount: number;
  settingsCount: number;
}
export interface InfluencersListResponse {
  influencers: InfluencerListItem[];
}
export interface CreateInfluencerBody {
  name: string;
  niche?: string | null;
  avatarUrl?: string | null;
}
export interface CreateInfluencerResponse {
  influencer: InfluencerListItem;
}

export function useGetMyInfluencers(
  options?: QueryOpts<InfluencersListResponse>,
): UseQueryResult<InfluencersListResponse, Error> {
  return useQuery<
    InfluencersListResponse,
    Error,
    InfluencersListResponse,
    QueryKey
  >({
    queryKey: ["influencers", "me"],
    queryFn: () => jsonFetch<InfluencersListResponse>("/api/influencers"),
    ...options?.query,
  });
}

export function useCreateMyInfluencer(): UseMutationResult<
  CreateInfluencerResponse,
  Error,
  CreateInfluencerBody
> {
  return useMutation<CreateInfluencerResponse, Error, CreateInfluencerBody>({
    mutationFn: (body) =>
      jsonFetch<CreateInfluencerResponse>("/api/influencers", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });
}

// ---- Automation: jobs / credits / schedules / workflows -------------

export interface AutomationJobDetail {
  id: string;
  status: string;
  workflowSlug: string;
  createdAt: string;
  updatedAt: string;
  result?: unknown;
  error?: string | null;
}

export const getGetAutomationJobQueryKey = (id: string): QueryKey => [
  "automation",
  "jobs",
  id,
];

export const getGetAutomationJobQueryOptions = (id: string) => ({
  queryKey: getGetAutomationJobQueryKey(id),
  queryFn: () => jsonFetch<AutomationJobDetail>(`/api/automation/jobs/${id}`),
});

export const getGetAutomationCreditBalanceQueryKey = (): QueryKey => [
  "automation",
  "credits",
  "balance",
];

export interface AutomationWorkflow {
  slug: string;
  title: string;
}
export interface AutomationWorkflowsResponse {
  workflows: AutomationWorkflow[];
}
export interface AutomationSchedule {
  id: string;
  workflowSlug: string;
  cron: string;
}
export interface AutomationSchedulesResponse {
  schedules: AutomationSchedule[];
}

export function useListAutomationWorkflows(
  options?: QueryOpts<AutomationWorkflowsResponse>,
): UseQueryResult<AutomationWorkflowsResponse, Error> {
  return useQuery<
    AutomationWorkflowsResponse,
    Error,
    AutomationWorkflowsResponse,
    QueryKey
  >({
    queryKey: ["automation", "workflows"],
    queryFn: () =>
      jsonFetch<AutomationWorkflowsResponse>("/api/automation/workflows"),
    ...options?.query,
  });
}

export function useListAutomationSchedules(
  options?: QueryOpts<AutomationSchedulesResponse>,
): UseQueryResult<AutomationSchedulesResponse, Error> {
  return useQuery<
    AutomationSchedulesResponse,
    Error,
    AutomationSchedulesResponse,
    QueryKey
  >({
    queryKey: ["automation", "schedules"],
    queryFn: () =>
      jsonFetch<AutomationSchedulesResponse>("/api/automation/schedules"),
    ...options?.query,
  });
}

// ---- Admin ----------------------------------------------------------

export interface AdminAuditLogEntry {
  id: number;
  actor: string;
  action: string;
  createdAt: string;
}
export interface AdminProviderCost {
  id: number;
  provider: string;
  amount: number;
  createdAt: string;
}
export interface AdminProviderError {
  id: number;
  provider: string;
  message: string;
  createdAt: string;
}
export interface AdminWorkflowStat {
  workflowSlug: string;
  successCount: number;
  failureCount: number;
}

export function useAdminListAuditLog(
  options?: QueryOpts<{ entries: AdminAuditLogEntry[] }>,
): UseQueryResult<{ entries: AdminAuditLogEntry[] }, Error> {
  return useQuery<
    { entries: AdminAuditLogEntry[] },
    Error,
    { entries: AdminAuditLogEntry[] },
    QueryKey
  >({
    queryKey: ["admin", "automation", "audit-log"],
    queryFn: () =>
      jsonFetch<{ entries: AdminAuditLogEntry[] }>(
        "/api/admin/automation/audit-log",
      ),
    ...options?.query,
  });
}

export function useAdminListProviderCosts(
  options?: QueryOpts<{ costs: AdminProviderCost[] }>,
): UseQueryResult<{ costs: AdminProviderCost[] }, Error> {
  return useQuery<
    { costs: AdminProviderCost[] },
    Error,
    { costs: AdminProviderCost[] },
    QueryKey
  >({
    queryKey: ["admin", "automation", "provider-costs"],
    queryFn: () =>
      jsonFetch<{ costs: AdminProviderCost[] }>(
        "/api/admin/automation/provider-costs",
      ),
    ...options?.query,
  });
}

export function useAdminListProviderErrors(
  options?: QueryOpts<{ errors: AdminProviderError[] }>,
): UseQueryResult<{ errors: AdminProviderError[] }, Error> {
  return useQuery<
    { errors: AdminProviderError[] },
    Error,
    { errors: AdminProviderError[] },
    QueryKey
  >({
    queryKey: ["admin", "automation", "provider-errors"],
    queryFn: () =>
      jsonFetch<{ errors: AdminProviderError[] }>(
        "/api/admin/automation/provider-errors",
      ),
    ...options?.query,
  });
}

export function useAdminListWorkflowStats(
  options?: QueryOpts<{ stats: AdminWorkflowStat[] }>,
): UseQueryResult<{ stats: AdminWorkflowStat[] }, Error> {
  return useQuery<
    { stats: AdminWorkflowStat[] },
    Error,
    { stats: AdminWorkflowStat[] },
    QueryKey
  >({
    queryKey: ["admin", "automation", "workflow-stats"],
    queryFn: () =>
      jsonFetch<{ stats: AdminWorkflowStat[] }>(
        "/api/admin/automation/workflow-stats",
      ),
    ...options?.query,
  });
}
