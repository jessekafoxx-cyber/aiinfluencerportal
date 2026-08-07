import { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageCircle,
  Phone,
  Send,
  Bot,
  Loader2,
  ArrowLeft,
  Clock,
  Lock,
} from "lucide-react";
import { getAuthHeaders } from "@/lib/api";
import { safeJson } from "../lib/safe-json";
import { GregAiVoiceCall } from "@/components/greg-ai-voice-call";
import gregAiFaceImg from "@assets/Untitled_design_(4)_1777366853063.png";

const API_BASE = import.meta.env.VITE_API_URL || "";

const PLATINUM_USAGE_PATH = "/portal/greg-ai/platinum/usage";
const PLATINUM_VOICE_TOKEN_PATH = "/api/portal/greg-ai/platinum/voice-token";

// Task #764: how often the chat view flushes its cumulative elapsed time to
// the server. A hard tab-close loses at most this much time, not the session.
const CHAT_HEARTBEAT_INTERVAL_MS = 15000;

function newSessionKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the manual key below
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type UsageSnapshot = {
  usedSeconds: number;
  limitSeconds: number;
  remainingSeconds: number;
  canStart: boolean;
  resetsAt: string;
};

type Mode = "landing" | "chat" | "call";

type ChatMessage = {
  id: number;
  role: string;
  content: string;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/^- (.*$)/gm, '<li class="ml-4 list-disc text-white/70">$1</li>')
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}

function formatMinutes(seconds: number): string {
  const mins = Math.floor(Math.max(0, seconds) / 60);
  const secs = Math.max(0, seconds) % 60;
  if (mins === 0) return `${secs}s`;
  return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`;
}

function formatResetDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "the 1st";
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

function useApi() {
  return useCallback(async (path: string, options: RequestInit = {}) => {
    const authHeaders = await getAuthHeaders();
    return fetch(`${API_BASE}/api${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
        ...options.headers,
      },
    });
  }, []);
}

function UsageMeter({ usage }: { usage: UsageSnapshot }) {
  const pct = Math.min(
    100,
    Math.round((usage.usedSeconds / Math.max(1, usage.limitSeconds)) * 100),
  );
  const exhausted = usage.remainingSeconds <= 0;
  return (
    <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-5 md:p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-full flex items-center justify-center bg-[#C9A44C]/15 border border-[#C9A44C]/30">
            <Clock className="w-4 h-4 text-[#C9A44C]" />
          </span>
          <h3
            className="text-white font-bold uppercase tracking-[0.04em] text-[14px]"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Monthly Greg AI Time
          </h3>
        </div>
        <span className="text-[13px] font-bold text-[#C9A44C] tabular-nums">
          {formatMinutes(usage.remainingSeconds)} left
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${exhausted ? "bg-red-500/80" : "bg-[#C9A44C]"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-2.5">
        <span className="text-[12px] text-white/45 tabular-nums">
          {formatMinutes(usage.usedSeconds)} of {formatMinutes(usage.limitSeconds)} used
        </span>
        <span className="text-[12px] text-white/45">
          Resets {formatResetDate(usage.resetsAt)}
        </span>
      </div>
    </div>
  );
}

export function PlatinumGregAi() {
  const fetchWithAuth = useApi();
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("landing");

  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const refreshUsage = useCallback(async () => {
    try {
      const res = await fetchWithAuth(PLATINUM_USAGE_PATH);
      const data = (await safeJson(res)) as UsageSnapshot | null;
      if (data && typeof data.remainingSeconds === "number") setUsage(data);
    } catch {
      // Leave the last-known snapshot in place on a transient failure.
    } finally {
      setUsageLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    refreshUsage();
  }, [refreshUsage]);

  // Record elapsed seconds against the monthly allowance, then refresh the
  // meter. Kept in a ref so the chat-time effect can call the latest version
  // without re-running on every render.
  //
  // Task #764: `sessionKey` makes the write idempotent. The client posts the
  // CUMULATIVE elapsed seconds for an in-progress session every ~15s (plus
  // once on leave), all keyed by the same sessionKey, so the server upserts a
  // single row. A hard tab-close / crash then loses at most one heartbeat
  // interval instead of the whole session.
  const recordUsage = useCallback(
    async (channel: "voice" | "chat", seconds: number, sessionKey?: string) => {
      const rounded = Math.round(seconds);
      if (rounded <= 0) return;
      try {
        const res = await fetchWithAuth(PLATINUM_USAGE_PATH, {
          method: "POST",
          body: JSON.stringify({
            channel,
            durationSeconds: rounded,
            ...(sessionKey ? { sessionKey } : {}),
          }),
        });
        const data = (await safeJson(res)) as UsageSnapshot | null;
        if (data && typeof data.remainingSeconds === "number") setUsage(data);
      } catch {
        refreshUsage();
      }
    },
    [fetchWithAuth, refreshUsage],
  );
  const recordUsageRef = useRef(recordUsage);
  useEffect(() => {
    recordUsageRef.current = recordUsage;
  }, [recordUsage]);

  // Count wall-clock time spent in the chat view against the allowance. While
  // the chat is open we post cumulative time every ~15s (heartbeat) keyed by a
  // per-visit session key; the cleanup posts a final cumulative value when the
  // user leaves (back, mode switch, or unmount). Because every post is the
  // cumulative total keyed by the same sessionKey, the server upserts one row,
  // so a closed tab loses at most one interval instead of the whole session.
  useEffect(() => {
    if (mode !== "chat") return;
    const startedAt = Date.now();
    const sessionKey = newSessionKey();
    const flush = () => {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      recordUsageRef.current("chat", secs, sessionKey);
    };
    const interval = window.setInterval(flush, CHAT_HEARTBEAT_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      flush();
    };
  }, [mode]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  const exhausted = !!usage && usage.remainingSeconds <= 0;

  const startChat = useCallback(async () => {
    if (exhausted) return;
    setChatError(null);
    try {
      const res = await fetchWithAuth("/portal/greg-ai/conversations", {
        method: "POST",
      });
      const conv = await safeJson(res);
      if (!conv || typeof conv.id !== "number") return;
      setConversationId(conv.id);
      setMessages([]);
      setMode("chat");
    } catch {
      setChatError("Could not start the chat. Please try again.");
    }
  }, [exhausted, fetchWithAuth]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming || !conversationId) return;
    const userMessage = input.trim();
    setInput("");
    setChatError(null);
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), role: "user", content: userMessage },
    ]);
    setIsStreaming(true);
    setStreamContent("");

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(
        `${API_BASE}/api/portal/greg-ai/platinum/conversations/${conversationId}/messages`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ message: userMessage }),
        },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 403) {
          setChatError(
            data?.error ||
              "You've used your 2 hours of Greg AI this month. It resets on the 1st.",
          );
          refreshUsage();
        } else {
          setChatError("Sorry, something went wrong. Please try again.");
        }
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";
      let receivedDone = false;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullContent += data.content;
                setStreamContent(fullContent);
              }
              if (data.done) {
                receivedDone = true;
                setMessages((prev) => [
                  ...prev,
                  { id: Date.now() + 1, role: "assistant", content: fullContent },
                ]);
                setStreamContent("");
                setIsStreaming(false);
              }
              if (data.error) {
                receivedDone = true;
                setChatError(data.error);
                setIsStreaming(false);
              }
            } catch {
              // Ignore malformed SSE fragments.
            }
          }
        }
      }

      if (!receivedDone && fullContent) {
        setMessages((prev) => [
          ...prev,
          { id: Date.now() + 1, role: "assistant", content: fullContent },
        ]);
        setStreamContent("");
        setIsStreaming(false);
      } else if (!receivedDone) {
        setIsStreaming(false);
      }
    } catch {
      setChatError("Connection error. Please try again.");
      setIsStreaming(false);
    }
  }, [input, isStreaming, conversationId, refreshUsage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (usageLoading) {
    return (
      <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
        <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
      </div>
    );
  }

  if (mode === "call") {
    return (
      <div className="space-y-6">
        {usage && <UsageMeter usage={usage} />}
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl overflow-hidden">
          <GregAiVoiceCall
            onBack={() => setMode("landing")}
            tokenEndpoint={PLATINUM_VOICE_TOKEN_PATH}
            onSessionEnd={(secs, key) => recordUsage("voice", secs, key)}
            onHeartbeat={(secs, key) => recordUsage("voice", secs, key)}
          />
        </div>
      </div>
    );
  }

  if (mode === "chat") {
    return (
      <div className="space-y-6">
        {usage && <UsageMeter usage={usage} />}
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl overflow-hidden flex flex-col h-[560px]">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-white/[0.06]">
            <button
              onClick={() => setMode("landing")}
              className="text-white/55 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="w-7 h-7 rounded-full bg-[#C9A44C] flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3
                className="text-[14px] font-bold text-white"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                GREG AI
              </h3>
              <p className="text-[11px] text-green-400">Online</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-6">
            {messages.length === 0 && !isStreaming && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-14 h-14 rounded-full bg-[#C9A44C]/10 flex items-center justify-center mb-4">
                  <Bot className="w-7 h-7 text-[#C9A44C]" />
                </div>
                <h3
                  className="text-[17px] font-bold text-white mb-2"
                  style={{ fontFamily: "var(--app-font-display)" }}
                >
                  ASK ME ANYTHING
                </h3>
                <p className="text-[13px] text-white/55 max-w-sm leading-relaxed">
                  Trained on Greg&rsquo;s entire knowledge base. Break down your offer, fix your funnel, or sharpen your copy.
                </p>
              </div>
            )}
            {messages.map((msg) => {
              const isUser = msg.role === "user";
              return (
                <div
                  key={msg.id}
                  className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}
                >
                  <div className="max-w-[85%]">
                    {!isUser && (
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="w-6 h-6 rounded-full bg-[#C9A44C] flex items-center justify-center">
                          <Bot className="w-3.5 h-3.5 text-white" />
                        </div>
                        <span className="text-[12px] text-white/65 font-medium uppercase tracking-wider">
                          Greg AI
                        </span>
                      </div>
                    )}
                    <div
                      className={`rounded-2xl px-4 py-3 text-[14px] leading-relaxed ${
                        isUser
                          ? "bg-[#C9A44C] text-white rounded-br-md"
                          : "bg-[#1a1a1a] border border-white/[0.06] text-white/80 rounded-bl-md"
                      }`}
                    >
                      {isUser ? (
                        <p>{msg.content}</p>
                      ) : (
                        <div
                          dangerouslySetInnerHTML={{
                            __html: formatMarkdown(msg.content),
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {isStreaming && (
              <div className="flex justify-start mb-4">
                <div className="max-w-[85%]">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-6 h-6 rounded-full bg-[#C9A44C] flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5 text-white" />
                    </div>
                    <span className="text-[12px] text-white/65 font-medium uppercase tracking-wider">
                      Greg AI
                    </span>
                  </div>
                  <div className="rounded-2xl rounded-bl-md px-4 py-3 text-[14px] leading-relaxed bg-[#1a1a1a] border border-white/[0.06] text-white/80">
                    {streamContent ? (
                      <div
                        dangerouslySetInnerHTML={{
                          __html: formatMarkdown(streamContent),
                        }}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          <span className="w-2 h-2 bg-[#C9A44C] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-2 h-2 bg-[#C9A44C] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-2 h-2 bg-[#C9A44C] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                        <span className="text-white/55 text-[13px]">Thinking...</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {chatError && (
            <div className="px-5 pb-2">
              <p className="text-[12.5px] text-red-300/90">{chatError}</p>
            </div>
          )}

          <div className="px-5 py-4 border-t border-white/[0.06]">
            <div className="flex items-end gap-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Greg AI a question..."
                rows={1}
                className="flex-1 resize-none bg-[#151515] border border-white/[0.08] rounded-xl px-4 py-3 text-[14px] text-white placeholder:text-white/35 focus:outline-none focus:border-[#C9A44C]/40 max-h-32"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isStreaming}
                className="flex items-center justify-center w-11 h-11 bg-[#C9A44C] hover:bg-[#B8902F] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl transition-colors shrink-0"
              >
                {isStreaming ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Landing
  return (
    <div className="space-y-6">
      {usage && <UsageMeter usage={usage} />}

      <div
        className="rounded-2xl p-7 md:p-10 text-center"
        style={{
          background:
            "linear-gradient(180deg, rgba(201,164,76,0.08) 0%, rgba(201,164,76,0.02) 100%)",
          border: "1px solid rgba(201,164,76,0.30)",
          boxShadow: "0 0 40px rgba(201,164,76,0.10)",
        }}
      >
        <div className="relative w-32 h-32 md:w-36 md:h-36 mx-auto mb-5">
          <div
            className="w-full h-full rounded-full overflow-hidden border-2 border-[#C9A44C]/40"
            style={{
              background:
                "radial-gradient(circle at 30% 30%, rgba(201,164,76,0.18), rgba(10,10,10,0.95) 70%)",
              boxShadow: "0 12px 40px rgba(201,164,76,0.18)",
            }}
          >
            <img
              src={gregAiFaceImg}
              alt="Greg AI"
              className="w-full h-full object-cover object-top"
              draggable={false}
            />
          </div>
          {!exhausted && (
            <div className="absolute bottom-1 right-1 w-5 h-5 bg-green-500 rounded-full border-2 border-[#0a0a0a]" />
          )}
        </div>

        <h2
          className="text-white font-bold uppercase leading-[1.1] mb-2"
          style={{ fontSize: "clamp(22px, 3vw, 30px)", fontFamily: "var(--app-font-display)" }}
        >
          Greg AI
        </h2>
        <p className="text-[13.5px] md:text-[14.5px] text-white/65 leading-[1.6] max-w-[520px] mx-auto mb-7">
          Talk to Greg in his own voice or chat any time. Trained on the way he coaches 1-on-1 - it breaks down your offer and tells you exactly what to fix next. Platinum members get 2 hours every month.
        </p>

        {exhausted ? (
          <div className="max-w-[460px] mx-auto px-5 py-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-3 text-left">
            <Lock className="w-4 h-4 text-red-300 mt-0.5 shrink-0" />
            <p className="text-[13px] text-red-200/90 leading-relaxed">
              You&rsquo;ve used your 2 hours of Greg AI this month. Your time resets on{" "}
              {usage ? formatResetDate(usage.resetsAt) : "the 1st"}.
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={startChat}
              className="flex items-center gap-2.5 bg-[#C9A44C] hover:bg-[#B8902F] text-white font-bold text-[14px] uppercase tracking-wider px-7 py-3.5 rounded-xl transition-colors"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              <MessageCircle className="w-5 h-5" />
              Chat
            </button>
            <button
              onClick={() => setMode("call")}
              className="flex items-center gap-2.5 bg-white/[0.06] hover:bg-white/[0.1] text-white font-bold text-[14px] uppercase tracking-wider px-7 py-3.5 rounded-xl transition-colors border border-white/[0.08]"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              <Phone className="w-5 h-5" />
              Call
            </button>
          </div>
        )}

        {chatError && !exhausted && (
          <p className="text-[12.5px] text-red-300/90 mt-4">{chatError}</p>
        )}
      </div>
    </div>
  );
}
