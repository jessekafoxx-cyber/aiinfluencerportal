import { useState, useRef } from "react";
import { Users, Sparkles, Loader2, AlertCircle, CheckCircle2, Upload, X, Copy, Check } from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { fetchApi } from "@/lib/api";

export default function AvatarPromptGenerator() {
  const [files, setFiles] = useState<File[]>([]);
  const [direction, setDirection] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (newFiles: FileList | null) => {
    if (!newFiles) return;
    const arr = Array.from(newFiles).filter(f => f.type.startsWith("image/"));
    setFiles(prev => {
      const combined = [...prev, ...arr];
      return combined.slice(0, 3);
    });
  };

  const removeFile = (i: number) => setFiles(prev => prev.filter((_, j) => j !== i));

  const generate = async () => {
    if (files.length === 0) {
      setError("Upload at least 1 reference image.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      files.forEach((f, i) => formData.append(`image${i}`, f));
      if (direction.trim()) formData.append("direction", direction.trim());

      const res = await fetch("/api/portal/avatar-prompt-generator", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");

      // Result can be in data.prompt (string) or data.avatarPrompt (object → JSON string)
      const prompt = data.prompt ?? data.avatarPrompt
        ? typeof data.avatarPrompt === "string"
          ? data.avatarPrompt
          : JSON.stringify(data.avatarPrompt, null, 2)
        : null;

      if (!prompt) throw new Error("No prompt returned — please try again.");
      setResult(prompt);
    } catch (e: any) {
      setError(e?.message || "Failed to generate avatar prompt.");
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#8b5cf6]/15 flex items-center justify-center flex-shrink-0">
            <Users className="w-5 h-5 text-[#8b5cf6]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Avatar Prompt Generator</h1>
            <p className="text-white/40 text-[12px] mt-0.5">Upload 1–3 reference images → hyper-detailed JSON prompt for any AI image generator</p>
          </div>
        </div>

        {/* Upload */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 mb-4">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-3">Reference Images (1–3)</h2>

          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-white/[0.1] rounded-xl p-8 text-center cursor-pointer hover:border-[#8b5cf6]/40 hover:bg-[#8b5cf6]/[0.03] transition-all mb-4"
          >
            <Upload className="w-6 h-6 text-white/30 mx-auto mb-2" />
            <p className="text-[13px] text-white/40">Click to upload images (JPG, PNG, WEBP)</p>
            <p className="text-[11px] text-white/20 mt-1">Up to 3 images — each inspected separately for consistency</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => addFiles(e.target.files)}
            />
          </div>

          {files.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-4">
              {files.map((f, i) => (
                <div key={i} className="relative group">
                  <img
                    src={URL.createObjectURL(f)}
                    alt={f.name}
                    className="w-20 h-20 object-cover rounded-lg border border-white/[0.08]"
                  />
                  <button
                    onClick={() => removeFile(i)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-1.5">
              Direction / Notes <span className="text-white/20 normal-case tracking-normal">(optional)</span>
            </label>
            <textarea
              rows={2}
              value={direction}
              onChange={e => setDirection(e.target.value)}
              placeholder="e.g. Professional look, confident posture, suitable for finance/business content, no visible logos"
              className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/25 focus:outline-none focus:border-[#8b5cf6]/40 resize-none"
            />
          </div>

          <button
            onClick={generate}
            disabled={loading || files.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)", color: "#fff" }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? "Generating Prompt…" : "Generate Avatar Prompt"}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        {loading && (
          <div className="mb-6 p-4 rounded-xl bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 text-[#8b5cf6] text-[13px] flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            Analysing your reference images and crafting the prompt…
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="rounded-xl border border-[#8b5cf6]/20 bg-white/[0.02] overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-[13px] font-semibold text-white">Avatar Prompt Ready</span>
              </div>
              <button
                onClick={copy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
                style={{ background: copied ? "#10b981" + "20" : "#8b5cf6" + "20", color: copied ? "#10b981" : "#8b5cf6" }}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied!" : "Copy Prompt"}
              </button>
            </div>
            <div className="p-6">
              <p className="text-[11px] text-white/30 mb-2 font-medium uppercase tracking-wide">Paste this directly into Higgsfield, MidJourney, Ideogram or DALL-E 3</p>
              <pre className="text-[12px] text-white/70 leading-relaxed whitespace-pre-wrap font-mono bg-white/[0.03] rounded-lg p-4 border border-white/[0.06] overflow-auto max-h-[60vh]">
                {result}
              </pre>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
