// Single-tenant portal: only the Room30 portal exists in this repo. The
// Apex/course-portal frontend was removed (Task #491) along with all
// `portal_key='main'` data. We keep the function so existing call sites
// continue to compile, but it now unconditionally returns "room30".
//
// The `X-Portal-Key` header is no longer read; callers can keep sending
// it but its value is ignored.
export function getPortalKey(_req?: { headers?: Record<string, any> } | undefined): string {
  return "room30";
}
