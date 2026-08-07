import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Mic, MicOff, PhoneOff, Phone, AlertCircle, Loader2 } from "lucide-react";
import { getAuthHeaders } from "@/lib/api";
import gregAiFaceImg from "@assets/Untitled_design_(4)_1777366853063.png";

const API_BASE = import.meta.env.VITE_API_URL || "";

type CallStatus = "idle" | "connecting" | "connected" | "ended" | "error";

interface GregAiVoiceCallProps {
  onBack: () => void;
  // Defaults to the upsell-gated voice-token endpoint. Platinum Club passes
  // its own gated endpoint so the call counts against the monthly allowance.
  tokenEndpoint?: string;
  // Fires once per finished call with the elapsed seconds + the call's
  // session key so callers can record usage (Platinum Club allowance). Not
  // called for 0-second sessions.
  onSessionEnd?: (seconds: number, sessionKey: string) => void;
  // Task #764: fires periodically while the call is connected with the
  // CUMULATIVE elapsed seconds + the same session key, so usage survives a
  // hard tab-close / crash. Posting cumulative time keyed by sessionKey lets
  // the server upsert one row, so heartbeats + the final flush are idempotent.
  onHeartbeat?: (seconds: number, sessionKey: string) => void;
}

// How often to flush an in-progress call's elapsed time to the server. A hard
// tab-close loses at most this much time instead of the whole call.
const HEARTBEAT_INTERVAL_MS = 15000;

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

export function GregAiVoiceCall(props: GregAiVoiceCallProps) {
  return (
    <ConversationProvider>
      <GregAiVoiceCallInner {...props} />
    </ConversationProvider>
  );
}

function GregAiVoiceCallInner({
  onBack,
  tokenEndpoint = "/api/portal/greg-ai/voice-token",
  onSessionEnd,
  onHeartbeat,
}: GregAiVoiceCallProps) {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [callSeconds, setCallSeconds] = useState(0);
  const timerRef = useRef<number | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const connectStartedRef = useRef(false);
  const callSecondsRef = useRef(0);
  // Per-call session key. Heartbeats + the final flush all post the CUMULATIVE
  // elapsed time keyed by this, so the server upserts a single row (idempotent
  // and safe to repeat).
  const sessionKeyRef = useRef<string>("");
  const onSessionEndRef = useRef(onSessionEnd);
  const onHeartbeatRef = useRef(onHeartbeat);
  useEffect(() => {
    onSessionEndRef.current = onSessionEnd;
  }, [onSessionEnd]);
  useEffect(() => {
    onHeartbeatRef.current = onHeartbeat;
  }, [onHeartbeat]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  // Report a finished call's elapsed seconds exactly once, then reset so a
  // later disconnect/error/unmount can't double-count the same session.
  const flushUsage = useCallback(() => {
    stopHeartbeat();
    const secs = callSecondsRef.current;
    const key = sessionKeyRef.current;
    if (secs > 0 && key) {
      callSecondsRef.current = 0;
      onSessionEndRef.current?.(secs, key);
    }
  }, [stopHeartbeat]);

  const conversation = useConversation({
    onConnect: () => {
      setStatus("connected");
      setError(null);
      setCallSeconds(0);
      callSecondsRef.current = 0;
      sessionKeyRef.current = newSessionKey();
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = window.setInterval(
        () =>
          setCallSeconds((s) => {
            const next = s + 1;
            callSecondsRef.current = next;
            return next;
          }),
        1000,
      );
      // Task #764: periodically flush cumulative call time so a hard tab-close
      // / crash still counts against the allowance.
      stopHeartbeat();
      heartbeatRef.current = window.setInterval(() => {
        const secs = callSecondsRef.current;
        const key = sessionKeyRef.current;
        if (secs > 0 && key) onHeartbeatRef.current?.(secs, key);
      }, HEARTBEAT_INTERVAL_MS);
    },
    onDisconnect: () => {
      setStatus((prev) => (prev === "error" ? prev : "ended"));
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      connectStartedRef.current = false;
      flushUsage();
    },
    onError: (err: unknown) => {
      const message =
        typeof err === "string" ? err :
        err instanceof Error ? err.message :
        "Call error";
      setError(message);
      setStatus("error");
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      connectStartedRef.current = false;
      flushUsage();
    },
  });

  const { isSpeaking, isMuted, setMuted } = conversation;

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopHeartbeat();
  }, [stopHeartbeat]);

  useEffect(() => {
    return () => {
      cleanup();
      try { conversation.endSession(); } catch {}
      flushUsage();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCall = useCallback(async () => {
    if (connectStartedRef.current) return;
    connectStartedRef.current = true;
    setError(null);
    setStatus("connecting");

    try {
      // Mic permission first so the failure mode is clear. Immediately stop
      // the probe tracks so the SDK can manage its own capture stream and we
      // don't leak an active microphone after the permission grant.
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t) => t.stop());
      } catch {
        connectStartedRef.current = false;
        setStatus("error");
        setError("Microphone access was blocked. Allow mic access in your browser to start the call.");
        return;
      }

      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}${tokenEndpoint}`, {
        credentials: "include",
        headers: { "Content-Type": "application/json", ...headers },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        connectStartedRef.current = false;
        setStatus("error");
        if (res.status === 503 && data?.code === "ELEVENLABS_NOT_CONFIGURED") {
          setError("Greg AI voice agent is not configured yet. Greg needs to add his ElevenLabs agent ID before calls work.");
        } else {
          setError(data?.error || "Could not start the call. Please try again.");
        }
        return;
      }

      const { signedUrl, dynamicVariables } = (await res.json()) as {
        signedUrl: string;
        dynamicVariables?: Record<string, string | number | boolean>;
      };
      try {
        // SDK signature returns void, but await covers any internal Promise.
        await Promise.resolve(
          conversation.startSession({
            signedUrl,
            ...(dynamicVariables ? { dynamicVariables } : {}),
          }),
        );
      } catch (sessionErr: unknown) {
        connectStartedRef.current = false;
        setStatus("error");
        setError(sessionErr instanceof Error ? sessionErr.message : "Could not open the voice line.");
      }
    } catch (err: unknown) {
      connectStartedRef.current = false;
      const message = err instanceof Error ? err.message : "Could not start the call";
      setStatus("error");
      setError(message);
    }
  }, [conversation]);

  const endCall = useCallback(() => {
    cleanup();
    try { conversation.endSession(); } catch {}
    connectStartedRef.current = false;
    setStatus("ended");
  }, [conversation, cleanup]);

  const toggleMute = useCallback(() => {
    try { setMuted(!isMuted); } catch {}
  }, [isMuted, setMuted]);

  const formattedTime = `${String(Math.floor(callSeconds / 60)).padStart(2, "0")}:${String(callSeconds % 60).padStart(2, "0")}`;

  const statusLabel =
    status === "idle" ? "Ready to call" :
    status === "connecting" ? "Connecting..." :
    status === "connected" ? (isSpeaking ? "Greg is speaking" : "Listening") :
    status === "ended" ? "Call ended" :
    "Call error";

  const statusColor =
    status === "connected" ? "text-green-400" :
    status === "connecting" ? "text-[#C9A44C]" :
    status === "error" ? "text-red-400" :
    "text-white/55";

  return (
    <div className="min-h-[calc(100vh-64px)] flex flex-col items-center justify-center px-6">
      <div className="text-center max-w-md w-full">
        <div className="relative mx-auto mb-6" style={{ width: 144, height: 144 }}>
          <div
            className={`w-36 h-36 rounded-full overflow-hidden border-2 transition-all ${
              status === "connected" && isSpeaking
                ? "border-[#C9A44C]"
                : "border-[#C9A44C]/40"
            }`}
            style={{
              background: 'radial-gradient(circle at 30% 30%, rgba(201,164,76,0.18), rgba(10,10,10,0.95) 70%)',
              boxShadow: status === "connected" && isSpeaking
                ? '0 0 0 8px rgba(201,164,76,0.18), 0 12px 40px rgba(201,164,76,0.35)'
                : '0 12px 40px rgba(201,164,76,0.18)',
            }}
          >
            <img src={gregAiFaceImg} alt="Greg AI" className="w-full h-full object-cover object-top" draggable={false} />
          </div>
          {status === "connected" && (
            <span className="absolute bottom-1 right-1 w-5 h-5 bg-green-500 rounded-full border-2 border-[#0a0a0a]" />
          )}
        </div>

        <h2 className="text-[24px] font-bold text-white mb-1" style={{ fontFamily: "var(--app-font-display)" }}>
          GREG AI VOICE CALL
        </h2>
        <p className={`text-[13px] font-medium uppercase tracking-[0.18em] mb-1 ${statusColor}`}>
          {statusLabel}
        </p>
        {status === "connected" && (
          <p className="text-[12px] text-white/45 tabular-nums mb-6">{formattedTime}</p>
        )}
        {status !== "connected" && <div className="mb-6" />}

        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-left flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-[13px] text-red-200/90 leading-relaxed">{error}</p>
          </div>
        )}

        {(status === "idle" || status === "ended" || status === "error") && (
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={onBack}
              className="flex items-center gap-2 bg-white/[0.06] hover:bg-white/[0.1] text-white text-[13px] font-bold uppercase tracking-wider px-5 py-3 rounded-xl transition-colors border border-white/[0.08]"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              <PhoneOff className="w-4 h-4" />
              Back
            </button>
            <button
              onClick={startCall}
              className="flex items-center gap-2 bg-[#C9A44C] hover:bg-[#B8902F] text-white text-[13px] font-bold uppercase tracking-wider px-6 py-3 rounded-xl transition-colors"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              <Phone className="w-4 h-4" />
              {status === "ended" || status === "error" ? "Call Again" : "Start Call"}
            </button>
          </div>
        )}

        {status === "connecting" && (
          <div className="flex items-center justify-center gap-2 text-white/65 text-[13px]">
            <Loader2 className="w-4 h-4 animate-spin text-[#C9A44C]" />
            Setting up the line...
          </div>
        )}

        {status === "connected" && (
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={toggleMute}
              className={`flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider px-5 py-3 rounded-xl transition-colors border ${
                isMuted
                  ? "bg-red-500/15 hover:bg-red-500/25 text-red-200 border-red-500/30"
                  : "bg-white/[0.06] hover:bg-white/[0.1] text-white border-white/[0.08]"
              }`}
              style={{ fontFamily: "var(--app-font-display)" }}
              aria-pressed={isMuted}
            >
              {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              {isMuted ? "Unmute" : "Mute"}
            </button>
            <button
              onClick={endCall}
              className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white text-[13px] font-bold uppercase tracking-wider px-6 py-3 rounded-xl transition-colors"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              <PhoneOff className="w-4 h-4" />
              End Call
            </button>
          </div>
        )}

        <p className="text-[12px] text-white/45 mt-8 max-w-sm mx-auto leading-relaxed">
          Real-time voice conversation in Greg's voice. Speak naturally — Greg AI will listen, answer, and ask follow-up questions to give you the right answer.
        </p>
      </div>
    </div>
  );
}
