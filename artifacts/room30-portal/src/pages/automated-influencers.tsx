import { useState } from "react";
import { PortalLayout } from "@/components/portal-layout";
import { Sparkles } from "lucide-react";
import {
  useListAutomationWorkflows,
  useListAutomationSchedules,
  type AutomationWorkflow,
  type AutomationSchedule,
} from "@workspace/api-client-react";

const TABS = ["Overview", "Automation", "Knowledge", "Scripts", "Settings"];

export default function AutomatedInfluencers() {
  const [tab, setTab] = useState(0);
  const { data: workflows } = useListAutomationWorkflows();
  const { data: schedules } = useListAutomationSchedules();
  const wfs: AutomationWorkflow[] = workflows?.workflows ?? [];
  const scheds: AutomationSchedule[] = schedules?.schedules ?? [];

  return (
    <PortalLayout>
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="flex items-center gap-3 mb-8">
          <Sparkles className="w-6 h-6" style={{ color: "#C9A44C" }} />
          <h1 className="text-2xl font-semibold text-white">Automated AI</h1>
        </div>
        <div className="flex gap-2 border-b border-white/[0.08] mb-8 overflow-x-auto">
          {TABS.map((t, i) => (
            <button
              key={t}
              onClick={() => setTab(i)}
              className={`px-4 py-2 text-sm border-b-2 ${
                tab === i
                  ? "border-[#C9A44C] text-[#C9A44C]"
                  : "border-transparent text-white/50 hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-8">
          {tab === 0 && (
            <div className="text-white/70">
              <h2 className="text-white text-lg mb-2">Pipeline overview</h2>
              <p className="text-sm">
                The automated pipeline runs four sequential steps: generate-script
                (Claude) → render-video (HeyGen) → add-captions (Creatomate, optional)
                → post-video (Blotato, optional). Credits are reserved before each run.
              </p>
              <div className="mt-4 text-xs text-white/40">
                {wfs.length} workflow(s) loaded · {scheds.length} schedule(s)
              </div>
            </div>
          )}
          {tab === 1 && (
            <div className="text-white/60 text-sm">
              Automation controls (Setup · Schedule · Library · Jobs · Recent · Buy
              Credits) — coming soon.
            </div>
          )}
          {tab === 2 && (
            <div className="text-white/60 text-sm">Knowledge base — coming soon.</div>
          )}
          {tab === 3 && (
            <div className="text-white/60 text-sm">Saved scripts — coming soon.</div>
          )}
          {tab === 4 && (
            <div className="text-white/60 text-sm">Settings — coming soon.</div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}
