import { useState } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, Sparkles, Loader2 } from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { getAuthHeaders } from "@/lib/api";

const GOLD = "#C9A44C";

const GENDER_OPTIONS = ["Female", "Male", "Non-binary"];
const AGE_RANGE_OPTIONS = [
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55+",
];

export default function BuyInfluencer() {
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [ageRange, setAgeRange] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onCreate() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErr("Give your influencer a name first.");
      return;
    }
    if (!gender) {
      setErr("Pick a gender.");
      return;
    }
    if (!ageRange) {
      setErr("Pick an age range.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      // requireAuth needs the Clerk Bearer token; cookies alone return 401.
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/influencers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          name: trimmedName,
          gender,
          ageRange,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed (${res.status})`);
      }
      const data = await res.json();
      const id = data?.influencer?.id;
      if (!id) throw new Error("Missing id");
      setLocation(`/influencer/${id}`);
    } catch (e: any) {
      setErr(e?.message || "Could not create influencer");
      setBusy(false);
    }
  }

  return (
    <PortalLayout>
      <div className="max-w-2xl mx-auto px-6 py-12">
        <button
          onClick={() => setLocation("/your-influencers")}
          className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white mb-6"
        >
          <ChevronLeft className="w-4 h-4" /> Back to influencers
        </button>

        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-8">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5" style={{ color: GOLD }} />
            <h1 className="text-2xl font-semibold text-white">
              Add a new influencer
            </h1>
          </div>
          <p className="text-white/55 text-sm mb-8">
            Just the basics - name, gender, and the age range you are targeting. You can upload reference images and generate avatars from the influencer page once it is created.
          </p>

          <div className="space-y-5">
            <div>
              <label className="block text-xs uppercase tracking-wider text-white/50 mb-2">
                Influencer name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ava Reyes"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-white placeholder:text-white/30 focus:border-[#C9A44C]/50 focus:outline-none"
                disabled={busy}
                maxLength={120}
              />
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-white/50 mb-2">
                Gender
              </label>
              <div className="flex flex-wrap gap-2">
                {GENDER_OPTIONS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGender(g)}
                    disabled={busy}
                    className={`px-4 py-2.5 rounded-lg border text-[13px] font-medium transition-colors ${
                      gender === g
                        ? "border-[#C9A44C]/60 bg-[#C9A44C]/10 text-white"
                        : "border-white/10 bg-black/40 text-white/70 hover:border-white/20 hover:text-white"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-white/50 mb-2">
                Age range we are targeting
              </label>
              <div className="flex flex-wrap gap-2">
                {AGE_RANGE_OPTIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setAgeRange(r)}
                    disabled={busy}
                    className={`px-4 py-2.5 rounded-lg border text-[13px] font-medium transition-colors ${
                      ageRange === r
                        ? "border-[#C9A44C]/60 bg-[#C9A44C]/10 text-white"
                        : "border-white/10 bg-black/40 text-white/70 hover:border-white/20 hover:text-white"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {err && (
              <div className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3">
                {err}
              </div>
            )}

            <button
              onClick={onCreate}
              disabled={busy || !name.trim() || !gender || !ageRange}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg font-bold uppercase tracking-wider text-[13px] text-black disabled:opacity-50"
              style={{ background: GOLD }}
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Create influencer
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
