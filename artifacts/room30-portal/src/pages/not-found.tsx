import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="text-center">
        <p className="text-[80px] font-bold text-[#C9A44C]/20" style={{ fontFamily: "var(--app-font-display)" }}>
          404
        </p>
        <h1
          className="text-[24px] font-bold uppercase text-white mb-2"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          Page Not Found
        </h1>
        <p className="text-[14px] text-white/65 mb-8">The page you're looking for doesn't exist.</p>
        <button
          onClick={() => setLocation("/")}
          className="bg-[#C9A44C] hover:bg-[#B8902F] text-white text-[13px] font-bold uppercase tracking-wider px-6 py-3 rounded-lg transition-colors"
        >
          Go Home
        </button>
      </div>
    </div>
  );
}
