import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { api } from "@/lib/api";
import { RichTextEditor, RichTextViewer } from "@/components/rich-text-editor";
import {
  FileText,
  Pencil,
  Save,
  X,
  Check,
  Maximize2,
  Minimize2,
  Sparkles,
  Sun,
  Moon,
  Loader2,
  Eye,
  BookOpen,
} from "lucide-react";

type Props = {
  pageSlug: string;
  fallbackTitle?: string;
};

export function PageNotesPanel({ pageSlug, fallbackTitle }: Props) {
  const queryClient = useQueryClient();
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesContent, setNotesContent] = useState("");
  const [notesSaved, setNotesSaved] = useState(false);
  const [notesFullscreen, setNotesFullscreen] = useState(false);
  const [notesTheme, setNotesTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem("notesTheme") as "dark" | "light") || "dark";
  });
  const toggleNotesTheme = () => {
    setNotesTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      try { localStorage.setItem("notesTheme", next); } catch {}
      return next;
    });
  };

  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [transcriptInput, setTranscriptInput] = useState("");
  const [contextInput, setContextInput] = useState("");
  const [generatedPreview, setGeneratedPreview] = useState("");
  const [noteStyle, setNoteStyle] = useState<"structured" | "general">("structured");
  const [aiEditPrompt, setAiEditPrompt] = useState("");

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const isAdmin = (me?.user as any)?.role === "admin";

  const { data: pageNotesData } = useQuery({
    queryKey: ["page-notes", pageSlug],
    queryFn: () => api.getPageNotes(pageSlug),
  });

  const notes = pageNotesData?.notes || "";
  const pageTitle = pageNotesData?.pageTitle || fallbackTitle || pageSlug;

  const saveNotesMutation = useMutation({
    mutationFn: (val: string) => api.admin.updatePageNotes(pageSlug, val),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["page-notes", pageSlug] });
      setEditingNotes(false);
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 3000);
    },
  });

  const generateNotesMutation = useMutation({
    mutationFn: ({ transcript, context, style }: { transcript: string; context?: string; style: "structured" | "general" }) =>
      api.admin.generatePageNotes(pageSlug, transcript, context, style),
    onSuccess: (data: any) => setGeneratedPreview(data.html),
  });

  const editNotesAiMutation = useMutation({
    mutationFn: ({ currentHtml, editPrompt }: { currentHtml: string; editPrompt: string }) =>
      api.admin.editPageNotesAi(pageSlug, currentHtml, editPrompt),
    onSuccess: (data: any) => {
      setGeneratedPreview(data.html);
      setAiEditPrompt("");
    },
  });

  const startEditing = useCallback(() => {
    setNotesContent(notes || "");
    setEditingNotes(true);
  }, [notes]);

  return (
    <>
      <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl overflow-hidden mb-6">
        <div className="flex border-b border-white/[0.06]">
          <div className="px-5 py-3.5 text-[12px] font-bold uppercase tracking-wider text-white relative inline-flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-[#C9A44C]" />
            Lesson Notes
            <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#C9A44C]" />
          </div>
        </div>

        <div className="px-7 py-7">
          {notesFullscreen ? (
            <div className="fixed inset-0 z-50 bg-black/95 overflow-y-auto">
              <div
                className={`min-h-screen ${notesTheme === "dark" ? "notes-fullscreen-dark" : "notes-fullscreen-light"}`}
              >
                <div className="max-w-4xl mx-auto px-8 py-12">
                  <div className="flex items-center justify-between mb-8 sticky top-4 z-10 backdrop-blur-md notes-fullscreen-header rounded-xl px-4 py-3">
                    <h2 className="text-[16px] font-bold uppercase tracking-wider notes-fullscreen-title" style={{ fontFamily: "var(--app-font-display)" }}>
                      {pageTitle}
                    </h2>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={toggleNotesTheme}
                        className="notes-fullscreen-btn flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all"
                      >
                        {notesTheme === "dark" ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
                        {notesTheme === "dark" ? "Light" : "Dark"}
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => { setNotesFullscreen(false); startEditing(); }}
                          className="notes-fullscreen-btn notes-fullscreen-btn-accent flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all"
                        >
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                      )}
                      <button
                        onClick={() => setNotesFullscreen(false)}
                        className="notes-fullscreen-btn flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all"
                      >
                        <Minimize2 className="w-3 h-3" />
                        Exit
                      </button>
                    </div>
                  </div>
                  <RichTextViewer content={notes} />
                </div>
              </div>
            </div>
          ) : (
            <>
              {isAdmin && !editingNotes && (
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <h4 className="text-[13px] text-white/50 font-bold uppercase tracking-wider">
                    Lesson Notes
                  </h4>
                  <div className="flex items-center gap-2 flex-wrap">
                    {notesSaved && (
                      <span className="text-[11px] text-green-400 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Saved
                      </span>
                    )}
                    {notes && (
                      <button
                        onClick={() => setNotesFullscreen(true)}
                        className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-white/[0.06] text-white/65 hover:text-white/70 hover:bg-white/[0.08] transition-all"
                      >
                        <Maximize2 className="w-3 h-3" />
                        Full Screen
                      </button>
                    )}
                    <button
                      onClick={() => setShowGenerateModal(true)}
                      className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-[#C9A44C]/10 text-[#C9A44C] hover:bg-[#C9A44C]/20 border border-[#C9A44C]/20 transition-all"
                    >
                      <Sparkles className="w-3 h-3" />
                      Generate with AI
                    </button>
                    <button
                      onClick={startEditing}
                      className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-white/[0.06] text-white/65 hover:text-[#C9A44C] hover:bg-[#C9A44C]/10 transition-all"
                    >
                      <Pencil className="w-3 h-3" />
                      {notes ? "Edit Notes" : "Write Notes"}
                    </button>
                  </div>
                </div>
              )}

              {!isAdmin && !editingNotes && notes && (
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-[13px] text-white/50 font-bold uppercase tracking-wider">
                    Lesson Notes
                  </h4>
                  <button
                    onClick={() => setNotesFullscreen(true)}
                    className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-white/[0.06] text-white/65 hover:text-white/70 hover:bg-white/[0.08] transition-all"
                  >
                    <Maximize2 className="w-3 h-3" />
                    Full Screen
                  </button>
                </div>
              )}

              {editingNotes && isAdmin ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[13px] text-white/50 font-bold uppercase tracking-wider">
                      Editing Notes
                    </h4>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditingNotes(false)}
                        className="flex items-center gap-1.5 text-[12px] text-white/65 hover:text-white/70 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors"
                      >
                        <X className="w-3 h-3" /> Cancel
                      </button>
                      <button
                        onClick={() => saveNotesMutation.mutate(notesContent)}
                        disabled={saveNotesMutation.isPending}
                        className="flex items-center gap-1.5 bg-[#C9A44C] hover:bg-[#B8902F] text-white text-[12px] font-bold uppercase tracking-wider px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Save className="w-3 h-3" />
                        {saveNotesMutation.isPending ? "Saving..." : "Save Notes"}
                      </button>
                    </div>
                  </div>
                  <RichTextEditor
                    content={notesContent}
                    onChange={setNotesContent}
                    editable={true}
                    placeholder="Write your lesson notes here. Use emoji headings like 🔴 WHAT: / 🟠 WHY: / 🟢 HOW: - add callout blocks with blockquotes, images, links, and more."
                  />
                </div>
              ) : notes ? (
                <>
                  <RichTextViewer content={notes} />
                  {isAdmin && (
                    <div className="mt-4 pt-4 border-t border-white/[0.06]">
                      <div className="flex flex-col gap-2">
                        <textarea
                          value={aiEditPrompt}
                          onChange={(e) => setAiEditPrompt(e.target.value)}
                          onKeyDown={async (e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && aiEditPrompt.trim() && !editNotesAiMutation.isPending && !saveNotesMutation.isPending) {
                              e.preventDefault();
                              const promptText = aiEditPrompt;
                              try {
                                const data: any = await editNotesAiMutation.mutateAsync({ currentHtml: notes, editPrompt: promptText });
                                if (data?.html) saveNotesMutation.mutate(data.html);
                              } catch (err) {
                                console.error("AI edit failed:", err);
                              }
                            }
                          }}
                          placeholder="Ask AI to edit these notes... e.g. 'Shorten the intro' or paste a long set of edit instructions. Press Cmd/Ctrl+Enter to send."
                          rows={6}
                          className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-xl px-4 py-3 text-[13px] text-white/90 placeholder-white/20 focus:border-[#C9A44C]/40 focus:outline-none font-sans resize-y min-h-[140px] leading-relaxed"
                        />
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[11px] text-white/35">
                            {aiEditPrompt.length.toLocaleString()} characters
                            {editNotesAiMutation.isError && (
                              <span className="ml-3 text-amber-400">
                                {(editNotesAiMutation.error as any)?.message || "Failed to edit. Try again."}
                              </span>
                            )}
                            {saveNotesMutation.isError && !editNotesAiMutation.isError && (
                              <span className="ml-3 text-amber-400">
                                Saved failed: {(saveNotesMutation.error as any)?.message || "Try again."}
                              </span>
                            )}
                          </span>
                          <button
                            onClick={async () => {
                              if (!aiEditPrompt.trim() || editNotesAiMutation.isPending || saveNotesMutation.isPending) return;
                              const promptText = aiEditPrompt;
                              try {
                                const data: any = await editNotesAiMutation.mutateAsync({ currentHtml: notes, editPrompt: promptText });
                                if (data?.html) saveNotesMutation.mutate(data.html);
                              } catch (err) {
                                console.error("AI edit failed:", err);
                              }
                            }}
                            disabled={!aiEditPrompt.trim() || editNotesAiMutation.isPending || saveNotesMutation.isPending}
                            className="flex items-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-white text-[12px] font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 border border-white/[0.08]"
                          >
                            {editNotesAiMutation.isPending || saveNotesMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Sparkles className="w-4 h-4" />
                            )}
                            {editNotesAiMutation.isPending ? "Editing..." : saveNotesMutation.isPending ? "Saving..." : "AI Edit"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-6">
                  <BookOpen className="w-8 h-8 text-white/15 mx-auto mb-3" />
                  <p className="text-[14px] text-white/55 italic">No notes added yet for this lesson.</p>
                  {isAdmin && (
                    <button
                      onClick={startEditing}
                      className="mt-3 text-[12px] text-[#C9A44C]/60 hover:text-[#C9A44C] transition-colors"
                    >
                      Click to add notes
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* AI Notes Generator Modal */}
      {showGenerateModal && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#141414] border border-white/[0.08] rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4">
            <div className="sticky top-0 bg-[#141414] border-b border-white/[0.06] px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#C9A44C]" />
                <h3 className="text-[15px] font-bold uppercase text-white" style={{ fontFamily: "var(--app-font-display)" }}>
                  AI Notes Generator
                </h3>
              </div>
              <button
                onClick={() => { setShowGenerateModal(false); setGeneratedPreview(""); setTranscriptInput(""); setContextInput(""); setNoteStyle("structured"); setAiEditPrompt(""); }}
                className="text-white/65 hover:text-white/70 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {!generatedPreview ? (
                <>
                  <div>
                    <label className="block text-[12px] text-white/50 font-bold uppercase tracking-wider mb-2">
                      Transcript / Lesson Content *
                    </label>
                    <textarea
                      value={transcriptInput}
                      onChange={(e) => setTranscriptInput(e.target.value)}
                      rows={12}
                      placeholder="Paste your lesson transcript, script, or raw content here..."
                      className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-xl px-4 py-3 text-[14px] text-white/90 placeholder-white/20 focus:border-[#C9A44C]/40 focus:outline-none resize-y font-sans"
                    />
                    <p className="text-[11px] text-white/50 mt-1">
                      {transcriptInput.length.toLocaleString()} / 100,000 characters
                    </p>
                  </div>

                  <div>
                    <label className="block text-[12px] text-white/50 font-bold uppercase tracking-wider mb-2">
                      Additional Context (optional)
                    </label>
                    <textarea
                      value={contextInput}
                      onChange={(e) => setContextInput(e.target.value)}
                      rows={3}
                      placeholder="E.g. 'Focus on the IG hijack angle' or 'This is a deep-dive on warm-audience targeting'"
                      className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-xl px-4 py-3 text-[14px] text-white/90 placeholder-white/20 focus:border-[#C9A44C]/40 focus:outline-none resize-y font-sans"
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] text-white/50 font-bold uppercase tracking-wider mb-2">
                      Note Style
                    </label>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setNoteStyle("structured")}
                        className={`flex-1 px-4 py-3 rounded-xl border text-left transition-all ${
                          noteStyle === "structured"
                            ? "border-[#C9A44C] bg-[#C9A44C]/10"
                            : "border-white/[0.08] bg-[#0a0a0a] hover:border-white/20"
                        }`}
                      >
                        <div className="text-[13px] font-bold text-white/90">🔴 What, Why & How</div>
                        <div className="text-[11px] text-white/65 mt-0.5">Structured teaching format with action tasks</div>
                      </button>
                      <button
                        onClick={() => setNoteStyle("general")}
                        className={`flex-1 px-4 py-3 rounded-xl border text-left transition-all ${
                          noteStyle === "general"
                            ? "border-[#C9A44C] bg-[#C9A44C]/10"
                            : "border-white/[0.08] bg-[#0a0a0a] hover:border-white/20"
                        }`}
                      >
                        <div className="text-[13px] font-bold text-white/90">📝 General Summary</div>
                        <div className="text-[11px] text-white/65 mt-0.5">Overview, key points & takeaways</div>
                      </button>
                    </div>
                  </div>

                  {generateNotesMutation.isError && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-[13px] text-amber-400">
                      {(generateNotesMutation.error as any)?.message || "Failed to generate notes. Please try again."}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      onClick={() => { setShowGenerateModal(false); setTranscriptInput(""); setContextInput(""); setNoteStyle("structured"); }}
                      className="text-[12px] text-white/65 hover:text-white/70 px-4 py-2 rounded-lg hover:bg-white/[0.04] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => generateNotesMutation.mutate({ transcript: transcriptInput, context: contextInput || undefined, style: noteStyle })}
                      disabled={!transcriptInput.trim() || generateNotesMutation.isPending}
                      className="flex items-center gap-2 bg-[#C9A44C] hover:bg-[#B8902F] text-white text-[12px] font-bold uppercase tracking-wider px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {generateNotesMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          Generate Notes
                        </>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <Eye className="w-4 h-4 text-[#C9A44C]" />
                    <h4 className="text-[12px] text-white/50 font-bold uppercase tracking-wider">
                      Preview Generated Notes
                    </h4>
                  </div>

                  <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-xl p-6 max-h-[40vh] overflow-y-auto">
                    <RichTextViewer content={generatedPreview} />
                  </div>

                  <div className="mt-3">
                    <label className="block text-[12px] text-white/50 font-bold uppercase tracking-wider mb-2">
                      <Sparkles className="w-3 h-3 inline mr-1" />
                      AI Edit - Tell AI what to change
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={aiEditPrompt}
                        onChange={(e) => setAiEditPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && aiEditPrompt.trim() && !editNotesAiMutation.isPending) {
                            editNotesAiMutation.mutate({ currentHtml: generatedPreview, editPrompt: aiEditPrompt });
                          }
                        }}
                        placeholder="E.g. 'Make the intro shorter' or 'Add more detail to the HOW section'"
                        className="flex-1 bg-[#0a0a0a] border border-white/[0.08] rounded-xl px-4 py-2.5 text-[13px] text-white/90 placeholder-white/20 focus:border-[#C9A44C]/40 focus:outline-none font-sans"
                      />
                      <button
                        onClick={() => editNotesAiMutation.mutate({ currentHtml: generatedPreview, editPrompt: aiEditPrompt })}
                        disabled={!aiEditPrompt.trim() || editNotesAiMutation.isPending}
                        className="flex items-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-white text-[12px] font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 border border-white/[0.08]"
                      >
                        {editNotesAiMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4" />
                        )}
                        {editNotesAiMutation.isPending ? "Editing..." : "Apply"}
                      </button>
                    </div>
                    {editNotesAiMutation.isError && (
                      <p className="mt-2 text-[12px] text-amber-400">
                        {(editNotesAiMutation.error as any)?.message || "Failed to edit. Try again."}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/[0.06]">
                    <button
                      onClick={() => { setGeneratedPreview(""); setAiEditPrompt(""); }}
                      className="text-[12px] text-white/65 hover:text-white/70 px-4 py-2 rounded-lg hover:bg-white/[0.04] transition-colors"
                    >
                      Regenerate
                    </button>
                    <button
                      onClick={() => {
                        saveNotesMutation.mutate(generatedPreview, {
                          onSuccess: () => {
                            setShowGenerateModal(false);
                            setGeneratedPreview("");
                            setTranscriptInput("");
                            setContextInput("");
                            setNoteStyle("structured");
                            setAiEditPrompt("");
                          },
                        });
                      }}
                      disabled={saveNotesMutation.isPending}
                      className="flex items-center gap-2 bg-[#C9A44C] hover:bg-[#B8902F] text-white text-[12px] font-bold uppercase tracking-wider px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saveNotesMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          Use These Notes
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
