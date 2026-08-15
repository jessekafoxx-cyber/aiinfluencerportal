import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";

/**
 * AlanaChatWidget - floating support chat bubble backed by the in-house
 * AI support bot (POST /api/support-bot/chat). Replaces Intercom.
 *
 * The session id is persisted in localStorage so the conversation
 * survives page reloads; the transcript is mirrored there too since the
 * API is stateless from the client's point of view.
 */

const SESSION_KEY = "alana_session_id";
const MESSAGES_KEY = "alana_messages";
const MAX_CACHED_MESSAGES = 50;

type ChatMessage = { role: "user" | "assistant"; content: string };

function loadCachedMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    );
  } catch {
    return [];
  }
}

function saveCachedMessages(messages: ChatMessage[]): void {
  try {
    localStorage.setItem(
      MESSAGES_KEY,
      JSON.stringify(messages.slice(-MAX_CACHED_MESSAGES)),
    );
  } catch {
    // Storage full or blocked - non-fatal.
  }
}

export function AlanaChatWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    typeof window === "undefined" ? [] : loadCachedMessages(),
  );
  const [sending, setSending] = useState(false);
  const [needsEmail, setNeedsEmail] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);
  const [escalateEmail, setEscalateEmail] = useState("");
  const [escalateSending, setEscalateSending] = useState(false);
  const escalateOfferedRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ behavior: "auto" });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending, showEscalate]);

  const sendEscalation = async () => {
    const email = escalateEmail.trim();
    if (!email || email.indexOf("@") < 1 || escalateSending) return;
    setEscalateSending(true);
    try {
      const res = await fetch("/api/support-bot/escalate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: localStorage.getItem(SESSION_KEY) || undefined,
          email,
        }),
      });
      const data = await res.json().catch(() => null);
      const ok = res.ok && data && data.success !== false;
      const withReply: ChatMessage[] = [
        ...messages,
        {
          role: "assistant",
          content: ok
            ? "Done - I've sent this conversation over to the team. Someone will reply to " +
              email +
              " directly, usually within a few hours."
            : "I couldn't send that just now, sorry. Please try again in a moment.",
        },
      ];
      setMessages(withReply);
      saveCachedMessages(withReply);
      if (ok) setShowEscalate(false);
    } catch {
      const withReply: ChatMessage[] = [
        ...messages,
        {
          role: "assistant",
          content:
            "I couldn't send that just now, sorry. Please try again in a moment.",
        },
      ];
      setMessages(withReply);
      saveCachedMessages(withReply);
    } finally {
      setEscalateSending(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    saveCachedMessages(next);
    setSending(true);
    try {
      const res = await fetch("/api/support-bot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          session_id: localStorage.getItem(SESSION_KEY) || undefined,
          page_url:
            typeof window !== "undefined" ? window.location.href : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && typeof data.response === "string") {
        if (typeof data.session_id === "string") {
          localStorage.setItem(SESSION_KEY, data.session_id);
        }
        const withReply: ChatMessage[] = [
          ...next,
          { role: "assistant", content: data.response },
        ];
        setMessages(withReply);
        saveCachedMessages(withReply);
        setNeedsEmail(data.needs_email === true);
        if (data.escalate === true && !escalateOfferedRef.current) {
          escalateOfferedRef.current = true;
          setShowEscalate(true);
        }
      } else if (res.status === 429) {
        const withReply: ChatMessage[] = [
          ...next,
          {
            role: "assistant",
            content:
              "You're sending messages a little fast - give it a minute and try again.",
          },
        ];
        setMessages(withReply);
        saveCachedMessages(withReply);
      } else {
        const withReply: ChatMessage[] = [
          ...next,
          {
            role: "assistant",
            content:
              "Something went wrong on my end, sorry. Try again in a moment and I'll pick this back up.",
          },
        ];
        setMessages(withReply);
        saveCachedMessages(withReply);
      }
    } catch {
      const withReply: ChatMessage[] = [
        ...next,
        {
          role: "assistant",
          content:
            "I couldn't reach the server just now, sorry. Check your connection and try again in a moment.",
        },
      ];
      setMessages(withReply);
      saveCachedMessages(withReply);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-[9999]" data-testid="alana-chat-widget">
      {open && (
        <div
          className="mb-3 w-[min(92vw,380px)] rounded-2xl overflow-hidden flex flex-col shadow-2xl"
          style={{
            height: "min(70vh, 560px)",
            background: "#0c0c0c",
            border: "1px solid rgba(201,164,76,0.25)",
          }}
        >
          <div
            className="flex items-center justify-between px-4 py-3 flex-shrink-0"
            style={{
              background:
                "linear-gradient(180deg, rgba(201,164,76,0.16) 0%, rgba(201,164,76,0.05) 100%)",
              borderBottom: "1px solid rgba(201,164,76,0.2)",
            }}
          >
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-full flex items-center justify-center bg-[#C9A44C]/20 border border-[#C9A44C]/35">
                <MessageCircle className="w-4 h-4 text-[#C9A44C]" />
              </span>
              <div>
                <p
                  className="text-[14px] font-bold uppercase tracking-wide text-white leading-tight"
                  style={{ fontFamily: "var(--app-font-display)" }}
                >
                  AI Influencer Portfolio Support
                </p>
                <p className="text-[11px] text-white/55 leading-tight">
                  Alana - here 24/7
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white/55 hover:text-white hover:bg-white/[0.06] transition-colors"
              data-testid="alana-chat-close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center px-4 py-8">
                <div className="w-12 h-12 rounded-full bg-[#C9A44C]/10 border border-[#C9A44C]/25 flex items-center justify-center mx-auto mb-3">
                  <MessageCircle className="w-5 h-5 text-[#C9A44C]" />
                </div>
                <p className="text-[14px] font-semibold text-white mb-1">
                  Hey, I'm Alana :)
                </p>
                <p className="text-[12.5px] text-white/60 leading-relaxed">
                  Ask me anything about your purchase, the portal, billing or
                  general advice - I'll sort it right here in the chat.
                </p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                    msg.role === "user"
                      ? "bg-[#C9A44C] text-black"
                      : "bg-white/[0.07] text-white/90"
                  }`}
                >
                  <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words">
                    {msg.content}
                  </p>
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div
                  className="bg-white/[0.07] rounded-2xl px-3.5 py-3 flex items-center gap-1"
                  aria-label="Alana is typing"
                >
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="w-1.5 h-1.5 rounded-full bg-[#C9A44C]/90 animate-bounce"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}
            {showEscalate && (
              <div className="flex justify-start">
                <div
                  className="w-full max-w-[90%] rounded-2xl px-3.5 py-3 bg-white/[0.07]"
                  data-testid="alana-escalate-form"
                >
                  <p className="text-[12.5px] text-white/75 leading-relaxed mb-2">
                    Want the team to pick this up? Drop your email and I'll
                    send this conversation over to a human.
                  </p>
                  <div className="flex gap-1.5">
                    <input
                      type="email"
                      value={escalateEmail}
                      onChange={(e) => setEscalateEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void sendEscalation();
                        }
                      }}
                      placeholder="you@email.com"
                      className="flex-1 min-w-0 bg-white/[0.05] border border-white/[0.12] rounded-lg px-3 py-2 text-[12.5px] text-white placeholder-white/30 focus:border-[#C9A44C]/45 focus:outline-none"
                      data-testid="alana-escalate-email"
                    />
                    <button
                      onClick={() => void sendEscalation()}
                      disabled={
                        escalateSending ||
                        escalateEmail.trim().indexOf("@") < 1
                      }
                      className="rounded-lg bg-[#C9A44C] hover:bg-[#B8902F] text-black text-[12.5px] font-semibold px-3.5 py-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                      data-testid="alana-escalate-send"
                    >
                      {escalateSending ? "..." : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div
            className="p-3 flex-shrink-0"
            style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={
                  needsEmail
                    ? "Type your checkout email..."
                    : "Type your message..."
                }
                rows={1}
                className="flex-1 bg-white/[0.05] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-[13.5px] text-white placeholder-white/30 focus:border-[#C9A44C]/45 focus:outline-none resize-none"
                style={{ minHeight: "42px", maxHeight: "110px" }}
                data-testid="alana-chat-input"
              />
              <button
                onClick={() => void send()}
                disabled={!input.trim() || sending}
                aria-label="Send message"
                className="w-10 h-10 rounded-xl bg-[#C9A44C] hover:bg-[#B8902F] text-black flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                data-testid="alana-chat-send"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close support chat" : "Open support chat"}
          className="w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-transform hover:scale-105"
          style={{
            background: "linear-gradient(135deg, #D7B45C 0%, #C9A44C 55%, #A9853B 100%)",
            border: "1px solid rgba(255,255,255,0.15)",
          }}
          data-testid="alana-chat-toggle"
        >
          {open ? (
            <X className="w-6 h-6 text-black" />
          ) : (
            <MessageCircle className="w-6 h-6 text-black" />
          )}
        </button>
      </div>
    </div>
  );
}
