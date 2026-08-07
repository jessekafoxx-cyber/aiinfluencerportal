import { useState } from "react";
import { useLocation } from "wouter";
import { PortalLayout } from "@/components/portal-layout";
import { Sparkles, ChevronRight, Loader2 } from "lucide-react";
import { submitOnboarding } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const GENDERS = ["Female", "Male", "Non-binary"];
const AGES = ["18-24", "25-34", "35-44", "45-54"];
const ETHNICITIES = ["Asian", "Black", "Hispanic", "Middle Eastern", "Mixed", "White"];
const COLORS = ["#C9A44C", "#FF4D4D", "#4D9BFF", "#22C55E", "#A855F7", "#F472B6"];

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    gender: "",
    ageRange: "",
    ethnicity: "",
    brandColorTheme: "#C9A44C",
    generatedName: "",
  });

  const update = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const canNext = () => {
    if (step === 0) return !!form.gender;
    if (step === 1) return !!form.ageRange;
    if (step === 2) return !!form.ethnicity;
    if (step === 3) return !!form.brandColorTheme;
    if (step === 4) return form.generatedName.trim().length > 1;
    return false;
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await submitOnboarding(form);
      toast({ title: "Build started", description: "Your influencer is being created." });
      setLocation("/your-build");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Could not start build", description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const ChoiceGrid = ({
    options,
    value,
    onPick,
  }: {
    options: string[];
    value: string;
    onPick: (v: string) => void;
  }) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onPick(o)}
          className={`px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${
            value === o
              ? "border-[#C9A44C] bg-[#C9A44C]/10 text-[#C9A44C]"
              : "border-white/[0.08] text-white/70 hover:border-white/20 hover:text-white"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );

  const steps = [
    { title: "Gender", node: <ChoiceGrid options={GENDERS} value={form.gender} onPick={(v) => update("gender", v)} /> },
    { title: "Age range", node: <ChoiceGrid options={AGES} value={form.ageRange} onPick={(v) => update("ageRange", v)} /> },
    { title: "Ethnicity", node: <ChoiceGrid options={ETHNICITIES} value={form.ethnicity} onPick={(v) => update("ethnicity", v)} /> },
    {
      title: "Brand color",
      node: (
        <div className="flex flex-wrap gap-3">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => update("brandColorTheme", c)}
              style={{ background: c }}
              className={`w-12 h-12 rounded-full border-2 ${
                form.brandColorTheme === c ? "border-white" : "border-transparent"
              }`}
            />
          ))}
        </div>
      ),
    },
    {
      title: "Influencer name",
      node: (
        <input
          autoFocus
          value={form.generatedName}
          onChange={(e) => update("generatedName", e.target.value)}
          placeholder="e.g. Sienna Vale"
          className="w-full px-4 py-3 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white placeholder-white/30 focus:outline-none focus:border-[#C9A44C]"
        />
      ),
    },
  ];

  const cur = steps[step]!;

  return (
    <PortalLayout>
      <div className="max-w-2xl mx-auto px-6 py-16">
        <div className="flex items-center gap-3 mb-10">
          <Sparkles className="w-6 h-6" style={{ color: "#C9A44C" }} />
          <h1 className="text-2xl font-semibold text-white">Create your AI influencer</h1>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-8">
          <div className="text-xs uppercase tracking-wider text-white/40 mb-2">
            Step {step + 1} of {steps.length}
          </div>
          <h2 className="text-xl text-white mb-6">{cur.title}</h2>
          {cur.node}

          <div className="flex justify-between mt-8">
            <button
              onClick={() => (step === 0 ? setLocation("/your-influencers") : setStep((s) => s - 1))}
              className="px-4 py-2 text-sm text-white/60 hover:text-white"
            >
              {step === 0 ? "Cancel" : "Back"}
            </button>
            {step < steps.length - 1 ? (
              <button
                disabled={!canNext()}
                onClick={() => setStep((s) => s + 1)}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#C9A44C] text-black text-sm font-semibold hover:bg-[#d4b260] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                disabled={!canNext() || submitting}
                onClick={submit}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#C9A44C] text-black text-sm font-semibold hover:bg-[#d4b260] disabled:opacity-40"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Start build
              </button>
            )}
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
