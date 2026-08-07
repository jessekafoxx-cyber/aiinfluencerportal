import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState, useRef, useEffect } from "react";
import {
  Search,
  BookOpen,
  CreditCard,
  HelpCircle,
  Wrench,
  ArrowLeft,
  Send,
  MessageCircle,
  Loader2,
  FileText,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { RichTextViewer } from "@/components/rich-text-editor";

const CATEGORIES = [
  { key: "all", label: "All Articles", icon: BookOpen },
  { key: "getting-started", label: "Getting Started", icon: Sparkles },
  { key: "troubleshooting", label: "Troubleshooting", icon: Wrench },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "course-help", label: "Course Help", icon: FileText },
  { key: "general", label: "General", icon: HelpCircle },
];

type ViewState = "home" | "article" | "chat";

export default function Support() {
  const [view, setView] = useState<ViewState>("home");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [selectedArticleSlug, setSelectedArticleSlug] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<
    { role: string; content: string; timestamp?: string }[]
  >([]);
  const [chatId, setChatId] = useState<number | undefined>();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const { data: articlesData } = useQuery({
    queryKey: ["support-articles", searchQuery, activeCategory],
    queryFn: () =>
      api.support.getArticles(searchQuery || undefined, activeCategory !== "all" ? activeCategory : undefined),
  });

  const { data: articleDetail } = useQuery({
    queryKey: ["support-article", selectedArticleSlug],
    queryFn: () => api.support.getArticle(selectedArticleSlug),
    enabled: !!selectedArticleSlug && view === "article",
  });

  const { data: chatHistory } = useQuery({
    queryKey: ["support-chat-history"],
    queryFn: () => api.support.getChatHistory(),
  });

  useEffect(() => {
    if (chatHistory?.chat && chatMessages.length === 0) {
      setChatMessages((chatHistory.chat.messages as any[]) || []);
      setChatId(chatHistory.chat.id);
    }
  }, [chatHistory]);

  const sendMessageMutation = useMutation({
    mutationFn: ({ message, chatId }: { message: string; chatId?: number }) =>
      api.support.sendMessage(message, chatId),
    onSuccess: (data: any) => {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.response, timestamp: new Date().toISOString() },
      ]);
      setChatId(data.chatId);
    },
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleSendMessage = () => {
    const msg = chatInput.trim();
    if (!msg || sendMessageMutation.isPending) return;
    setChatMessages((prev) => [
      ...prev,
      { role: "user", content: msg, timestamp: new Date().toISOString() },
    ]);
    setChatInput("");
    sendMessageMutation.mutate({ message: msg, chatId });
  };

  const openArticle = (slug: string) => {
    setSelectedArticleSlug(slug);
    setView("article");
  };

  const openChat = () => {
    setView("chat");
    setTimeout(() => chatInputRef.current?.focus(), 100);
  };

  const articles = articlesData?.articles || [];

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        {view === "home" && (
          <>
            <div className="mb-8">
              <h1
                className="text-[28px] md:text-[36px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                Support
              </h1>
              <p className="text-[14px] text-white/65 mt-2">
                Search our knowledge base or chat with our AI support assistant.
              </p>
            </div>

            <div
              className="mb-6 rounded-xl px-4 py-3 flex items-start gap-3"
              style={{
                background:
                  "linear-gradient(180deg, rgba(201,164,76,0.10) 0%, rgba(201,164,76,0.03) 100%)",
                border: "1px solid rgba(201,164,76,0.28)",
              }}
            >
              <span className="mt-0.5 w-7 h-7 rounded-full flex items-center justify-center bg-[#C9A44C]/15 border border-[#C9A44C]/30 flex-shrink-0">
                <MessageCircle className="w-3.5 h-3.5 text-[#C9A44C]" />
              </span>
              <p className="text-[13px] text-white/80 leading-[1.55]">
                Use the chat bubble in the bottom-right corner to speak to the team, and we will get back to you there.
              </p>
            </div>

            <div className="relative mb-6">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/55" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for help articles..."
                className="w-full bg-[#0f0f0f] border border-white/[0.08] rounded-xl pl-12 pr-4 py-3.5 text-[14px] text-white placeholder-white/25 focus:border-[#C9A44C]/40 focus:outline-none transition-colors"
              />
            </div>

            <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1 scrollbar-hide">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => setActiveCategory(cat.key)}
                  className={`flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wider px-3 py-2 rounded-lg whitespace-nowrap transition-all ${
                    activeCategory === cat.key
                      ? "bg-[#C9A44C]/15 text-[#C9A44C] border border-[#C9A44C]/20"
                      : "bg-[#0f0f0f] text-white/65 border border-white/[0.06] hover:text-white/60 hover:border-white/[0.1]"
                  }`}
                >
                  <cat.icon className="w-3.5 h-3.5" />
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="space-y-2 mb-8">
              {articles.length === 0 ? (
                <div className="text-center py-10">
                  <BookOpen className="w-10 h-10 text-white/10 mx-auto mb-3" />
                  <p className="text-[14px] text-white/55">
                    {searchQuery ? "No articles found for your search." : "No articles available."}
                  </p>
                </div>
              ) : (
                articles.map((article: any) => (
                  <button
                    key={article.id}
                    onClick={() => openArticle(article.slug)}
                    className="w-full text-left bg-[#0f0f0f] border border-white/[0.06] rounded-xl px-5 py-4 hover:border-white/[0.12] hover:bg-[#111] transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-[15px] font-semibold text-white group-hover:text-[#C9A44C] transition-colors truncate">
                          {article.title}
                        </h3>
                        {article.summary && (
                          <p className="text-[13px] text-white/60 mt-1 truncate">{article.summary}</p>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-white/45 group-hover:text-white/65 flex-shrink-0 ml-3 transition-colors" />
                    </div>
                  </button>
                ))
              )}
            </div>

            <div
              onClick={openChat}
              className="bg-gradient-to-r from-[#C9A44C]/10 to-[#C9A44C]/5 border border-[#C9A44C]/20 rounded-xl p-6 cursor-pointer hover:border-[#C9A44C]/30 transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-[#C9A44C]/20 flex items-center justify-center flex-shrink-0">
                  <MessageCircle className="w-6 h-6 text-[#C9A44C]" />
                </div>
                <div className="flex-1">
                  <h3
                    className="text-[16px] font-bold text-white group-hover:text-[#C9A44C] transition-colors"
                    style={{ fontFamily: "var(--app-font-display)" }}
                  >
                    CHAT WITH SUPPORT
                  </h3>
                  <p className="text-[13px] text-white/65 mt-0.5">
                    Get instant answers from our AI assistant. Available 24/7.
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-white/45 group-hover:text-[#C9A44C] transition-colors" />
              </div>
            </div>
          </>
        )}

        {view === "article" && articleDetail?.article && (
          <>
            <button
              onClick={() => setView("home")}
              className="flex items-center gap-2 text-[13px] text-white/65 hover:text-white/70 transition-colors mb-6"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Support
            </button>

            <div className="mb-2">
              <span className="text-[11px] text-[#C9A44C] font-bold uppercase tracking-[0.15em]">
                {CATEGORIES.find((c) => c.key === articleDetail.article.category)?.label ||
                  articleDetail.article.category}
              </span>
            </div>

            <h1
              className="text-[24px] md:text-[32px] font-bold uppercase tracking-[0.01em] text-white leading-tight mb-8"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              {articleDetail.article.title}
            </h1>

            <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl p-6 md:p-8">
              <RichTextViewer content={articleDetail.article.content} />
            </div>

            <div className="mt-8 text-center">
              <p className="text-[13px] text-white/55 mb-3">Didn't find what you need?</p>
              <button
                onClick={openChat}
                className="inline-flex items-center gap-2 bg-[#C9A44C] hover:bg-[#B8902F] text-white text-[12px] font-bold uppercase tracking-wider px-6 py-3 rounded-xl transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                Chat with Support
              </button>
            </div>
          </>
        )}

        {view === "chat" && (
          <>
            <button
              onClick={() => setView("home")}
              className="flex items-center gap-2 text-[13px] text-white/65 hover:text-white/70 transition-colors mb-6"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Support
            </button>

            <div className="mb-6">
              <h1
                className="text-[24px] md:text-[28px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                Chat with Support
              </h1>
              <p className="text-[13px] text-white/65 mt-1">
                Ask anything — our AI assistant has access to our full knowledge base and your account info.
              </p>
            </div>

            <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl overflow-hidden flex flex-col" style={{ height: "calc(100vh - 280px)", minHeight: "400px" }}>
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {chatMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center px-6">
                    <div className="w-16 h-16 rounded-full bg-[#C9A44C]/10 flex items-center justify-center mb-4">
                      <Sparkles className="w-8 h-8 text-[#C9A44C]" />
                    </div>
                    <h3 className="text-[16px] font-bold text-white mb-2">Hi! How can I help?</h3>
                    <p className="text-[13px] text-white/60 max-w-sm">
                      I can answer questions about the course, your account, billing, refunds, and more.
                    </p>
                    <div className="flex flex-wrap gap-2 mt-5 justify-center">
                      {[
                        "How do I get started?",
                        "I need a refund",
                        "Video won't play",
                        "How do I track progress?",
                      ].map((q) => (
                        <button
                          key={q}
                          onClick={() => {
                            setChatInput(q);
                            setTimeout(() => {
                              setChatMessages((prev) => [
                                ...prev,
                                { role: "user", content: q, timestamp: new Date().toISOString() },
                              ]);
                              setChatInput("");
                              sendMessageMutation.mutate({ message: q, chatId });
                            }, 50);
                          }}
                          className="text-[12px] text-white/50 bg-white/[0.04] border border-white/[0.08] px-3 py-2 rounded-lg hover:bg-white/[0.08] hover:text-white/70 transition-all"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                        msg.role === "user"
                          ? "bg-[#C9A44C] text-white"
                          : "bg-white/[0.06] text-white/90"
                      }`}
                    >
                      <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))}

                {sendMessageMutation.isPending && (
                  <div className="flex justify-start">
                    <div className="bg-white/[0.06] rounded-2xl px-4 py-3 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 text-[#C9A44C] animate-spin" />
                      <span className="text-[13px] text-white/65">Thinking...</span>
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              <div className="border-t border-white/[0.06] p-4">
                <div className="flex items-end gap-3">
                  <textarea
                    ref={chatInputRef}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder="Type your message..."
                    rows={1}
                    className="flex-1 bg-[#0f0f0f] border border-white/[0.08] rounded-xl px-4 py-3 text-[14px] text-white placeholder-white/25 focus:border-[#C9A44C]/40 focus:outline-none resize-none"
                    style={{ minHeight: "44px", maxHeight: "120px" }}
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!chatInput.trim() || sendMessageMutation.isPending}
                    className="w-11 h-11 rounded-xl bg-[#C9A44C] hover:bg-[#B8902F] text-white flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </PortalLayout>
  );
}
