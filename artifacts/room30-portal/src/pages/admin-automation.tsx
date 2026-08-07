import { PortalLayout } from "@/components/portal-layout";
import { useLocation } from "wouter";
import { Shield } from "lucide-react";

const SECTIONS = [
  { path: "/admin/automation/jobs", label: "Jobs" },
  { path: "/admin/automation/stuck", label: "Stuck jobs" },
  { path: "/admin/automation/audit-log", label: "Audit log" },
  { path: "/admin/automation/provider-configs", label: "Provider configs" },
  { path: "/admin/automation/provider-costs", label: "Provider costs" },
  { path: "/admin/automation/provider-errors", label: "Provider errors" },
  { path: "/admin/automation/transactions", label: "Transactions" },
  { path: "/admin/automation/wallets", label: "Wallets" },
  { path: "/admin/automation/workflow-stats", label: "Workflow stats" },
];

export default function AdminAutomation() {
  const [, setLocation] = useLocation();
  return (
    <PortalLayout>
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="flex items-center gap-3 mb-8">
          <Shield className="w-6 h-6" style={{ color: "#C9A44C" }} />
          <h1 className="text-2xl font-semibold text-white">Automation admin</h1>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SECTIONS.map((s) => (
            <button
              key={s.path}
              onClick={() => setLocation(s.path)}
              className="text-left rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 hover:border-[#C9A44C]/40 hover:bg-white/[0.04]"
            >
              <div className="text-white font-medium">{s.label}</div>
              <div className="text-xs text-white/40 mt-1">{s.path}</div>
            </button>
          ))}
        </div>
      </div>
    </PortalLayout>
  );
}

function makeAdminPage(title: string, endpoint: string) {
  return function Page() {
    const [, setLocation] = useLocation();
    return (
      <PortalLayout>
        <div className="max-w-5xl mx-auto px-6 py-12">
          <button
            onClick={() => setLocation("/admin/automation")}
            className="text-sm text-white/60 hover:text-white mb-6"
          >
            ← Admin home
          </button>
          <h1 className="text-2xl font-semibold text-white mb-6">{title}</h1>
          <AdminListView endpoint={endpoint} />
        </div>
      </PortalLayout>
    );
  };
}

import { useQuery } from "@tanstack/react-query";

function AdminListView({ endpoint }: { endpoint: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", endpoint],
    queryFn: async () => {
      const res = await fetch(endpoint, { credentials: "include" });
      return res.ok ? res.json() : null;
    },
  });
  if (isLoading) return <div className="text-white/40">Loading…</div>;
  if (!data) return <div className="text-white/40">No data.</div>;
  return (
    <pre className="text-xs text-white/70 bg-black/40 rounded-lg p-4 overflow-x-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export const AdminAutomationJobs = makeAdminPage("Jobs", "/api/admin/automation/jobs");
export const AdminAutomationStuck = makeAdminPage("Stuck jobs", "/api/admin/automation/jobs/stuck");
export const AdminAutomationAudit = makeAdminPage("Audit log", "/api/admin/automation/audit-log");
export const AdminAutomationProviderConfigs = makeAdminPage("Provider configs", "/api/admin/automation/provider-configs");
export const AdminAutomationProviderCosts = makeAdminPage("Provider costs", "/api/admin/automation/provider-costs");
export const AdminAutomationProviderErrors = makeAdminPage("Provider errors", "/api/admin/automation/provider-errors");
export const AdminAutomationTransactions = makeAdminPage("Transactions", "/api/admin/automation/transactions");
export const AdminAutomationWallets = makeAdminPage("Wallets", "/api/admin/automation/wallets");
export const AdminAutomationWorkflowStats = makeAdminPage("Workflow stats", "/api/admin/automation/workflow-stats");
