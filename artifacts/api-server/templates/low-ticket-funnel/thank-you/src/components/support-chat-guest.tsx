import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, User, Bot, Loader2 } from "lucide-react";

interface Message {
  role: string;
  content: string;
}

export function GuestSupportChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const [convId, setConvId] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const storedEmail = sessionStorage.getItem("aip_customer_email") || sessionStorage.getItem("aip_email");
      const storedName = sessionStorage.getItem("aip_customer_name") || sessionStorage.getItem("aip_name");
      if (storedEmail) setEmail(storedEmail);
      if (storedName) setName(storedName);
    } catch {}
  }, []);

  const scrollToBottom = () => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  const startChat = async () => {
    if (!email.trim() || !input.trim()) return;
    setSending(true);
    const msg = input.trim();
    setInput("");

    try {
      const res = await fetch("/api/support/guest/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined, message: msg }),
      });
      if (res.ok) {
        const data = await res.json();
        setConvId(data.conversation.id);
        setStarted(true);
        setMessages([
          { role: "user", content: msg },
          { role: "assistant", content: data.aiMessage?.content || "Thanks for reaching out!" },
        ]);
        scrollToBottom();
      }
    } catch {}
    setSending(false);
  };

  const sendMessage = async () => {
    if (!input.trim() || !convId || sending) return;
    const msg = input.trim();
    setInput("");
    setSending(true);

    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    scrollToBottom();

    try {
      const res = await fetch(`/api/support/guest/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: msg, email: email.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.aiMessage) {
          setMessages((prev) => [...prev, { role: "assistant", content: data.aiMessage.content }]);
          scrollToBottom();
        }
      }
    } catch {}
    setSending(false);
  };

  const renderText = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|\n)/g);
    return (
      <span>
        {parts.map((part, i) => {
          if (part === "\n") return <br key={i} />;
          if (part.startsWith("**") && part.endsWith("**"))
            return <strong key={i}>{part.slice(2, -2)}</strong>;
          if (part.startsWith("*") && part.endsWith("*"))
            return <em key={i}>{part.slice(1, -1)}</em>;
          return <span key={i}>{part}</span>;
        })}
      </span>
    );
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-transform hover:scale-110"
          style={{ background: "linear-gradient(135deg, #93E360, #4d8a2a)" }}
        >
          <MessageCircle className="w-6 h-6 text-white" />
        </button>
      )}

      {open && (
        <div
          className="fixed bottom-6 right-6 z-50 flex flex-col overflow-hidden shadow-2xl"
          style={{
            width: 380,
            height: 520,
            borderRadius: 16,
            border: "1px solid rgba(0,0,0,0.1)",
            background: "#fff",
          }}
        >
          <div
            className="flex items-center justify-between px-5 py-3.5 flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #051408, #0d3514)" }}
          >
            <div>
              <h3 className="text-white font-bold text-sm" style={{ fontFamily: "'Oswald', sans-serif" }}>
                Help & Support
              </h3>
              <p className="text-white/50 text-[11px]">AI-powered instant support</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {!started ? (
            <div className="flex-1 overflow-y-auto p-5">
              <div className="text-center mb-5">
                <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: "rgba(147,227,96,0.1)" }}>
                  <MessageCircle className="w-6 h-6" style={{ color: "#93E360" }} />
                </div>
                <p className="text-sm font-semibold text-gray-800 mb-1">Need help?</p>
                <p className="text-xs text-gray-400">Our AI assistant is here to help with any questions.</p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-medium text-gray-500 mb-1 block">Your Email *</label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    type="email"
                    className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 focus:outline-none focus:ring-2 focus:ring-green-300"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-gray-500 mb-1 block">Your Name (optional)</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John"
                    className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 focus:outline-none focus:ring-2 focus:ring-green-300"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-gray-500 mb-1 block">Your Message *</label>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="How can we help you?"
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 focus:outline-none focus:ring-2 focus:ring-green-300 resize-none"
                  />
                </div>
                <button
                  onClick={startChat}
                  disabled={!email.trim() || !input.trim() || sending}
                  className="w-full py-2.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
                  style={{ background: "#93E360", color: "#051408" }}
                >
                  {sending ? "Sending..." : "Start Chat"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {messages
                  .filter((m) => m.role !== "system")
                  .map((msg, i) => (
                    <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ background: msg.role === "user" ? "rgba(147,227,96,0.15)" : "#f3f4f6" }}
                      >
                        {msg.role === "user" ? (
                          <User className="w-3.5 h-3.5" style={{ color: "#4d8a2a" }} />
                        ) : (
                          <Bot className="w-3.5 h-3.5 text-gray-500" />
                        )}
                      </div>
                      <div
                        className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${msg.role === "user" ? "rounded-tr-sm" : "rounded-tl-sm"}`}
                        style={{
                          background: msg.role === "user" ? "#93E360" : "#f3f4f6",
                          color: msg.role === "user" ? "#051408" : "#1a1a2e",
                        }}
                      >
                        {renderText(msg.content)}
                      </div>
                    </div>
                  ))}

                {sending && (
                  <div className="flex gap-2.5">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 bg-gray-100">
                      <Bot className="w-3.5 h-3.5 text-gray-500" />
                    </div>
                    <div className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 bg-gray-100">
                      <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              <div className="px-4 pb-4 pt-2 flex-shrink-0">
                <div className="flex items-center gap-2 rounded-xl" style={{ background: "#f3f4f6", padding: "4px 4px 4px 14px" }}>
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                    placeholder="Type your message..."
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
                    disabled={sending}
                    autoFocus
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!input.trim() || sending}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30"
                    style={{ background: "#93E360", color: "#051408" }}
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
