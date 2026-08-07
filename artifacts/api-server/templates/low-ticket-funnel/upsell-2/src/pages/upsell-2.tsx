import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { chargeUpsell } from '@/lib/upsell';

function WistiaVideo({ mediaId }: { mediaId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!document.querySelector('script[src="https://fast.wistia.com/player.js"]')) {
      const playerScript = document.createElement('script');
      playerScript.src = 'https://fast.wistia.com/player.js';
      playerScript.async = true;
      document.head.appendChild(playerScript);
    }
    if (!document.querySelector(`script[src="https://fast.wistia.com/embed/${mediaId}.js"]`)) {
      const embedScript = document.createElement('script');
      embedScript.src = `https://fast.wistia.com/embed/${mediaId}.js`;
      embedScript.async = true;
      embedScript.type = 'module';
      document.head.appendChild(embedScript);
    }
  }, [mediaId]);

  return (
    <div ref={containerRef}>
      <style>{`wistia-player[media-id='${mediaId}']:not(:defined) { background: center / contain no-repeat url('https://fast.wistia.com/embed/medias/${mediaId}/swatch'); display: block; filter: blur(5px); padding-top:56.25%; }`}</style>
      <div dangerouslySetInnerHTML={{ __html: `<wistia-player media-id="${mediaId}" aspect="1.7777777777777777"></wistia-player>` }} />
    </div>
  );
}

function SlideshowCarousel({ images }: { images: string[] }) {
  const [current, setCurrent] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCurrent(prev => (prev + 1) % images.length);
    }, 2500);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [images.length]);

  return (
    <div className="relative w-full h-full">
      {images.map((src, i) => (
        <img
          key={i}
          src={src}
          alt={`Slide ${i + 1}`}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
          style={{ opacity: i === current ? 1 : 0 }}
        />
      ))}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
        {images.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className="w-2 h-2 rounded-full transition-all"
            style={{ background: i === current ? '#93E360' : 'rgba(255,255,255,0.4)' }}
          />
        ))}
      </div>
    </div>
  );
}

const FRAMER = 'https://framerusercontent.com/images';

function ProLogo({ width = 152 }: { width?: number }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo-pro.png`}
      alt="AI Influencer Portfolio Pro"
      style={{ width, height: 'auto' }}
    />
  );
}

const COUNTRY_FLAGS_U2: Record<string, string> = {
  US: "\u{1F1FA}\u{1F1F8}", GB: "\u{1F1EC}\u{1F1E7}", AU: "\u{1F1E6}\u{1F1FA}", CA: "\u{1F1E8}\u{1F1E6}", NZ: "\u{1F1F3}\u{1F1FF}",
  AE: "\u{1F1E6}\u{1F1EA}", DE: "\u{1F1E9}\u{1F1EA}", NL: "\u{1F1F3}\u{1F1F1}", SE: "\u{1F1F8}\u{1F1EA}", CH: "\u{1F1E8}\u{1F1ED}",
  IE: "\u{1F1EE}\u{1F1EA}", NO: "\u{1F1F3}\u{1F1F4}", SG: "\u{1F1F8}\u{1F1EC}", DK: "\u{1F1E9}\u{1F1F0}", BE: "\u{1F1E7}\u{1F1EA}",
  FR: "\u{1F1EB}\u{1F1F7}", ES: "\u{1F1EA}\u{1F1F8}", IT: "\u{1F1EE}\u{1F1F9}", JP: "\u{1F1EF}\u{1F1F5}", KR: "\u{1F1F0}\u{1F1F7}",
  IN: "\u{1F1EE}\u{1F1F3}", BR: "\u{1F1E7}\u{1F1F7}", MX: "\u{1F1F2}\u{1F1FD}", ZA: "\u{1F1FF}\u{1F1E6}", PH: "\u{1F1F5}\u{1F1ED}",
  MY: "\u{1F1F2}\u{1F1FE}", TH: "\u{1F1F9}\u{1F1ED}", ID: "\u{1F1EE}\u{1F1E9}",
};

function fmtRevU2(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function getMilestoneU2(rev: number): { label: string; color: string } {
  if (rev >= 1000000) return { label: "MILLION DOLLAR CLUB", color: "#eab308" };
  if (rev >= 100000) return { label: "SIX-FIGURE CLUB", color: "#a855f7" };
  if (rev >= 10000) return { label: "MOMENTUM BUILDER", color: "#d97706" };
  if (rev >= 1000) return { label: "STARTER CLUB", color: "#16a34a" };
  return { label: "RISING", color: "#9ca3af" };
}

export default function Upsell2() {
  const [, setLocation] = useLocation();
  const [processing, setProcessing] = useState(false);
  const [chargeError, setChargeError] = useState('');
  const [lbData, setLbData] = useState<{ entries: any[]; totalMembers: number } | null>(null);

  useEffect(() => {
    const API_BASE = `${import.meta.env.BASE_URL}api`;
    fetch(`${API_BASE}/leaderboard?limit=15`)
      .then(r => r.json())
      .then(data => { if (data.entries) setLbData(data); })
      .catch(() => {});
  }, []);

  const handleUpgrade = async () => {
    setProcessing(true);
    setChargeError('');
    const result = await chargeUpsell('upsell-2');
    setProcessing(false);
    if (result.success) {
      setLocation('/upsell-3');
    } else {
      setChargeError(result.error || 'Payment failed. Please try again.');
    }
  };
  const handleSkip = () => setLocation('/upsell-3');

  return (
    <div className="min-h-screen" style={{ background: '#051408' }}>

      {/* ============ HERO BANNER ============ */}
      <section
        className="relative overflow-hidden"
        style={{
          background: 'linear-gradient(170deg, #051408 0%, #0a2810 40%, #0d3514 70%, #0a2810 100%)',
        }}
      >
        <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(ellipse at 30% 50%, rgba(147,227,96,0.15) 0%, transparent 70%), radial-gradient(ellipse at 70% 80%, rgba(147,227,96,0.1) 0%, transparent 60%)' }} />

        {/* Nav Bar */}
        <div className="relative z-10 w-full px-4 md:px-8 py-3">
          <div
            className="upsell-nav w-full max-w-[1200px] mx-auto px-6 md:px-8 py-3.5 flex flex-col sm:flex-row items-center sm:justify-between gap-2 sm:gap-0"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.14)',
            }}
          >
            <ProLogo width={160} />
            <p className="text-white/70 text-sm sm:text-base font-semibold text-center">
              🔥 One More Thing Before You Go
            </p>
            <img
              src={`${import.meta.env.BASE_URL}step-2-of-3.png`}
              alt="Step 2 of 3"
              className="h-10 md:h-12 sm:order-last"
            />
          </div>
        </div>

        {/* Hero Content */}
        <div className="relative z-10 max-w-[900px] mx-auto px-4 pt-8 md:pt-12 pb-0 text-center">
          <p className="text-white/60 mb-1" style={{ fontSize: 'clamp(16px, 2.5vw, 20px)', lineHeight: 1.7 }}>
            Your AI influencer is built. Your content engine is live.
          </p>
          <p className="text-white/60 mb-8" style={{ fontSize: 'clamp(16px, 2.5vw, 20px)', lineHeight: 1.7 }}>
            But what if you had a full month of content ready to post... in 72 hours?
          </p>

          <h1
            className="text-white font-extrabold leading-[1.15] mb-8 uppercase max-w-[800px] mx-auto"
            style={{ fontSize: 'clamp(28px, 4.5vw, 48px)', fontFamily: 'var(--app-font-display)' }}
          >
            WE'LL CREATE <span style={{ color: '#93E360' }}>A MONTH'S WORTH OF DONE-FOR-YOU CONTENT</span> FOR YOUR AI INFLUENCER - DELIVERED IN 72 HOURS
          </h1>

          {/* Benefit Pills */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-10 max-w-[900px] mx-auto">
            {[
              { emoji: '🎙️', text: '10 Podcast Content Clips' },
              { emoji: '📱', text: '10 TikTok Slide Shows' },
              { emoji: '🎬', text: '10 Hook + Demo Reels' },
            ].map((pill, i) => (
              <span
                key={i}
                className="inline-flex items-center justify-center gap-2 px-4 md:px-5 py-2.5 rounded-full font-semibold text-white md:whitespace-nowrap"
                style={{
                  fontSize: 'clamp(14px, 1.5vw, 17px)',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              >
                {pill.emoji} {pill.text}
              </span>
            ))}
          </div>

          {/* Wistia Video Embed */}
          <div className="w-full max-w-[860px] mx-auto rounded-2xl overflow-hidden">
            <WistiaVideo mediaId="dsrrozav2c" />
          </div>
        </div>

        {/* Two-Column CTA Below Video */}
        <div className="relative z-10 max-w-[1000px] mx-auto px-4 md:px-8 py-12 md:py-16" style={{ background: '#0d3514' }}>
          <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12">

            {/* Left Column - Content Preview */}
            <div className="w-full md:w-[45%] relative flex items-center justify-center">
              <div className="grid grid-cols-3 gap-3 w-full max-w-[340px]">
                {[
                  { label: '10 Podcast Clips', emoji: '🎙️' },
                  { label: '10 TikTok Slides', emoji: '📱' },
                  { label: '10 Hook + Demo Reels', emoji: '🎬' },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl overflow-hidden flex flex-col items-center justify-center p-4 text-center"
                    style={{
                      aspectRatio: '3/4',
                      background: 'linear-gradient(135deg, #0d1f17 0%, #1a3a25 100%)',
                      border: '1px solid rgba(147,227,96,0.2)',
                    }}
                  >
                    <span className="text-3xl mb-2">{item.emoji}</span>
                    <p className="text-white font-bold text-xs leading-tight">{item.label}</p>
                    <p className="text-white/50 text-[10px] mt-1">Done-For-You</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column - Offer Text + CTA */}
            <div className="w-full md:w-[55%] text-center">
              <h3
                className="text-white font-extrabold leading-[1.15] mb-4"
                style={{ fontSize: 'clamp(24px, 3.2vw, 36px)', fontFamily: 'var(--app-font-display)' }}
              >
                🔥 One-Time Offer - This Price<br />Disappears When You Leave
              </h3>
              <p className="text-white/70 mb-1" style={{ fontSize: 'clamp(14px, 1.8vw, 17px)' }}>
                Freelancers charge $2,000+ for this. Agencies? $5,000 minimum.
              </p>
              <p className="text-white font-bold mb-6" style={{ fontSize: 'clamp(14px, 1.8vw, 17px)' }}>
                Today only: <span className="font-black" style={{ color: '#93E360' }}>$297 once</span>. A full month of content delivered to your portal in 72 hours.
              </p>

              {chargeError && (
                <div className="mb-4 p-3 rounded-lg text-sm text-red-200 text-center" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  {chargeError}
                </div>
              )}

              <button
                onClick={handleUpgrade}
                disabled={processing}
                className="mx-auto py-4 md:py-5 px-8 md:px-12 rounded-full font-black text-center cursor-pointer hover:scale-[1.02] transition-all duration-200 block mb-4 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  fontSize: 'clamp(16px, 2.2vw, 22px)',
                  fontFamily: 'var(--app-font-display)',
                  background: '#93E360',
                  color: '#051408',
                  boxShadow: '0 0 30px -5px rgba(147,227,96,0.4)',
                }}
              >
                {processing ? 'Processing...' : 'Yes - Give Me A Month of Done-For-You Content ($297)'}
              </button>

              <p className="text-white/50 text-xs md:text-sm">
                🛡️ 30-Day Money Back Guarantee - Zero risk
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* ============ WHAT YOU GET SECTION ============ */}
      <section className="w-full" style={{ background: '#ffffff' }}>
        <div className="max-w-[960px] mx-auto px-4 py-16 md:py-20">

          <div className="text-center mb-12">
            <h2
              className="leading-[1.3]"
              style={{ fontSize: 'clamp(28px, 4vw, 46px)', fontFamily: 'var(--app-font-display)', color: '#1a1a2e' }}
            >
              Here's Exactly What
            </h2>
            <div className="flex items-center justify-center gap-3 mt-2" style={{ fontSize: 'clamp(28px, 4vw, 46px)', fontFamily: 'var(--app-font-display)', color: '#1a1a2e' }}>
              <span
                className="inline-block px-5 py-1.5 rounded-lg"
                style={{ background: '#93E360', color: '#051408' }}
              >
                We Build
              </span>
              <span>For You</span>
            </div>
          </div>

          {/* 3 Content Type Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-6 mb-8 max-w-[900px] mx-auto">

            {/* Podcast Content Clips - Video */}
            <div className="flex flex-col items-center text-center">
              <div
                className="w-full rounded-xl overflow-hidden mb-6 relative"
                style={{
                  aspectRatio: '9/16',
                  maxHeight: '420px',
                  border: '2px solid rgba(147,227,96,0.2)',
                }}
              >
                <video
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover"
                  src={`${import.meta.env.BASE_URL}podcast-example.mp4`}
                />
              </div>
              <h3 className="font-black text-xl mb-1" style={{ fontFamily: 'var(--app-font-display)', color: '#1a1a2e' }}>10 Podcast Content Clips</h3>
              <p className="italic mb-2" style={{ fontFamily: 'var(--app-font-script, Caveat, cursive)', fontSize: '18px', color: '#2d6a1e' }}>example above</p>
              <p className="text-sm leading-relaxed" style={{ color: '#6b7280' }}>Professionally produced podcast-style clips featuring your AI influencer. Each clip is scripted, rendered, captioned, and ready to post.</p>
            </div>

            {/* TikTok Slide Shows - Carousel */}
            <div className="flex flex-col items-center text-center">
              <div
                className="w-full rounded-xl overflow-hidden mb-6 relative"
                style={{
                  aspectRatio: '9/16',
                  maxHeight: '420px',
                  border: '2px solid rgba(147,227,96,0.2)',
                }}
              >
                <SlideshowCarousel
                  images={[
                    `${import.meta.env.BASE_URL}slideshow-1.jpg`,
                    `${import.meta.env.BASE_URL}slideshow-2.jpg`,
                    `${import.meta.env.BASE_URL}slideshow-3.jpg`,
                    `${import.meta.env.BASE_URL}slideshow-4.jpg`,
                  ]}
                />
              </div>
              <h3 className="font-black text-xl mb-1" style={{ fontFamily: 'var(--app-font-display)', color: '#1a1a2e' }}>10 TikTok Slide Shows</h3>
              <p className="italic mb-2" style={{ fontFamily: 'var(--app-font-script, Caveat, cursive)', fontSize: '18px', color: '#2d6a1e' }}>example above</p>
              <p className="text-sm leading-relaxed" style={{ color: '#6b7280' }}>Scroll-stopping slideshow content designed for TikTok, Reels, and Shorts. Viral hooks, engaging visuals, and strong calls-to-action built in.</p>
            </div>

            {/* Hook + Demo Reels - Video */}
            <div className="flex flex-col items-center text-center">
              <div
                className="w-full rounded-xl overflow-hidden mb-6 relative"
                style={{
                  aspectRatio: '9/16',
                  maxHeight: '420px',
                  border: '2px solid rgba(147,227,96,0.2)',
                }}
              >
                <video
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover"
                  src={`${import.meta.env.BASE_URL}hook-demo-example.mp4`}
                />
              </div>
              <h3 className="font-black text-xl mb-1" style={{ fontFamily: 'var(--app-font-display)', color: '#1a1a2e' }}>10 Hook + Demo Reels</h3>
              <p className="italic mb-2" style={{ fontFamily: 'var(--app-font-script, Caveat, cursive)', fontSize: '18px', color: '#2d6a1e' }}>example above</p>
              <p className="text-sm leading-relaxed" style={{ color: '#6b7280' }}>Attention-grabbing hook and demo reels designed to stop the scroll. Each reel combines a viral hook with a compelling product demonstration.</p>
            </div>

          </div>

        </div>
      </section>

      {/* ============ LIVE LEADERBOARD SECTION ============ */}
      <section className="w-full" style={{ background: '#051408' }}>
        <div className="max-w-[960px] mx-auto px-4 py-16 md:py-24">

          <h2
            className="text-center text-white font-extrabold leading-[1.2] mb-4"
            style={{ fontSize: 'clamp(26px, 4vw, 44px)', fontFamily: 'var(--app-font-display)' }}
          >
            The Top Performers All Started With{' '}
            <span style={{ color: '#93E360' }}>Done-For-You Content</span>
          </h2>
          <p
            className="text-center text-white/60 mb-12 md:mb-16 max-w-[700px] mx-auto"
            style={{ fontSize: 'clamp(15px, 2vw, 18px)' }}
          >
            They didn't spend weeks learning. They launched with professional content from day one and started generating revenue immediately.
          </p>

          <div className="rounded-xl overflow-hidden" style={{ background: '#111613', border: '1px solid rgba(147,227,96,0.1)' }}>
            <div className="p-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(147,227,96,0.08)' }}>
              <div className="flex items-center gap-2">
                <span className="text-lg">🏆</span>
                <span className="font-bold text-white text-sm uppercase tracking-wider">Community Leaderboard</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(147,227,96,0.15)', color: '#93E360' }}>
                  {lbData ? lbData.totalMembers.toLocaleString() : '2,900+'} members
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#93E360' }} />
                <span className="text-xs font-bold" style={{ color: '#93E360' }}>LIVE</span>
              </div>
            </div>

            {(() => {
              const previewEntries = lbData ? lbData.entries.slice(0, 15) : [];
              const rankIcons = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
              const remainingCount = lbData ? Math.max(0, lbData.totalMembers - 15) : 0;
              return (
                <div>
                  {previewEntries.map((u: any) => {
                    const ms = getMilestoneU2(u.totalRevenue);
                    return (
                      <div key={u.rank} className="grid grid-cols-[30px_1fr_70px] md:grid-cols-[50px_1fr_80px_100px_140px] gap-0 px-3 md:px-4 py-2 md:py-2.5 items-center" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <div className="font-bold text-sm" style={{ color: u.rank <= 3 ? ['#eab308','#94a3b8','#cd7f32'][u.rank-1] : 'rgba(255,255,255,0.4)' }}>
                          {u.rank <= 3 ? rankIcons[u.rank-1] : u.rank}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center text-xs md:text-sm shrink-0" style={{ background: u.avatarColor }}>
                            {u.avatarEmoji}
                          </div>
                          <span className="text-xs md:text-sm font-semibold text-white truncate">{u.tagName}</span>
                        </div>
                        <div className="hidden md:block text-center text-base">{COUNTRY_FLAGS_U2[u.countryCode] || '\u{1F3F3}\u{FE0F}'}</div>
                        <div className="text-right font-bold text-xs md:text-sm" style={{ color: '#93E360' }}>{fmtRevU2(u.totalRevenue)}</div>
                        <div className="hidden md:block text-right">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: `${ms.color}20`, color: ms.color }}>
                            {ms.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {previewEntries.length === 0 && (
                    <div className="p-6 text-center">
                      <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Loading leaderboard...</span>
                    </div>
                  )}
                  {remainingCount > 0 && (
                    <div className="p-3 text-center" style={{ borderTop: '1px solid rgba(147,227,96,0.08)', background: 'rgba(147,227,96,0.03)' }}>
                      <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>+ {remainingCount.toLocaleString()} more members tracking their revenue</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

        </div>
      </section>

      {/* ============ HOW IT WORKS - 3 STEPS ============ */}
      <section className="w-full" style={{ background: '#f5f5f5' }}>
        <div className="max-w-[1000px] mx-auto px-6 py-16 md:py-24">

          <h2
            className="text-center leading-[1.15] mb-14 md:mb-16 italic"
            style={{ fontSize: 'clamp(32px, 5vw, 56px)', fontFamily: 'var(--app-font-display)', color: '#1a1a2e' }}
          >
            How It Works -<br className="hidden md:block" /> 3 Simple Steps
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
            {[
              {
                step: '1',
                title: 'You Purchase',
                description: 'Click the button below and your order is placed. That is literally all you need to do. We handle everything from here.',
                emoji: '💳',
              },
              {
                step: '2',
                title: 'We Create Everything',
                description: 'Our team gets to work immediately - creating 10 podcast clips, 10 TikTok slideshows, and 10 hook + demo reels tailored to your AI influencer and niche.',
                emoji: '🛠️',
              },
              {
                step: '3',
                title: 'Delivered in 72 Hours',
                description: 'Within 72 hours, all 30 pieces of content are uploaded directly to your portal. Download them, schedule them, and start posting immediately.',
                emoji: '🚀',
              },
            ].map((item, i) => (
              <div
                key={i}
                className="rounded-2xl overflow-hidden bg-white text-center p-8"
                style={{ border: '1px solid #e5e7eb' }}
              >
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
                  style={{ background: 'linear-gradient(135deg, #93E360, #5cb832)', fontSize: '28px' }}
                >
                  {item.emoji}
                </div>
                <div
                  className="inline-block px-4 py-1 rounded-full font-black text-sm mb-3"
                  style={{ background: 'rgba(147,227,96,0.15)', color: '#2d6a1e' }}
                >
                  STEP {item.step}
                </div>
                <h3
                  className="font-extrabold leading-tight mb-3"
                  style={{ fontSize: 'clamp(18px, 2.5vw, 24px)', fontFamily: 'var(--app-font-display)', color: '#1a1a2e' }}
                >
                  {item.title}
                </h3>
                <p className="text-sm md:text-[15px] leading-relaxed" style={{ color: '#6b7280' }}>
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ WHAT'S INCLUDED DEEP DIVE ============ */}
      <section
        className="w-full overflow-hidden"
        style={{
          background: 'linear-gradient(170deg, #0a2810 0%, #0d3514 50%, #0a2810 100%)',
        }}
      >
        <div className="max-w-[1000px] mx-auto px-4 py-16 md:py-24">

          <h2
            className="text-center text-white font-extrabold leading-[1.15] mb-4"
            style={{ fontSize: 'clamp(28px, 4vw, 46px)', fontFamily: 'var(--app-font-display)' }}
          >
            A Full Month of Content.<br className="hidden md:block" /> Zero Work From You.
          </h2>
          <p
            className="text-center text-white/60 mb-12 md:mb-16 max-w-[700px] mx-auto"
            style={{ fontSize: 'clamp(15px, 2vw, 18px)' }}
          >
            Every single piece is professionally created, branded to your niche, and ready to post the moment it hits your portal.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {[
              {
                emoji: '🎙️',
                title: '10 Podcast Content Clips',
                items: [
                  'AI influencer presents engaging topics',
                  'Professional captions and overlays',
                  'Optimized for TikTok, Reels, and Shorts',
                  'Multiple talking points per clip',
                  'Branded to your niche and style',
                ],
              },
              {
                emoji: '📱',
                title: '10 TikTok Slide Shows',
                items: [
                  'Viral hook on every first slide',
                  'Scroll-stopping visual design',
                  'Strong call-to-action on final slide',
                  'Trending formats and layouts',
                  'Ready for TikTok, Instagram, and Pinterest',
                ],
              },
              {
                emoji: '🎬',
                title: '10 Hook + Demo Reels',
                items: [
                  'Attention-grabbing viral hooks',
                  'Compelling product demonstrations',
                  'Optimized for Reels, Shorts, and TikTok',
                  'Strong calls-to-action built in',
                  'Branded to your niche and style',
                ],
              },
            ].map((card, i) => (
              <div
                key={i}
                className="rounded-2xl overflow-hidden p-6 md:p-8"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(147,227,96,0.15)',
                }}
              >
                <span className="text-4xl block mb-4">{card.emoji}</span>
                <h3
                  className="text-white font-extrabold mb-5"
                  style={{ fontSize: 'clamp(18px, 2.5vw, 22px)', fontFamily: 'var(--app-font-display)' }}
                >
                  {card.title}
                </h3>
                <div className="space-y-3">
                  {card.items.map((item, j) => (
                    <div key={j} className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center mt-0.5" style={{ background: '#93E360' }}>
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="#051408" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      </div>
                      <span className="text-white/80 text-sm leading-relaxed">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* ============ WHY DONE-FOR-YOU SECTION ============ */}
      <section className="w-full" style={{ background: '#ffffff' }}>
        <div className="max-w-[800px] mx-auto px-4 py-16 md:py-24 text-center">

          <h2
            className="leading-[1.15] mb-6"
            style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontFamily: 'var(--app-font-display)', color: '#1a1a2e' }}
          >
            Why Done-For-You?
          </h2>
          <p className="text-lg mb-12 max-w-[650px] mx-auto" style={{ color: '#6b7280', lineHeight: 1.7 }}>
            Most people buy the tools but never use them. They get busy, get overwhelmed, or just don't know where to start. This eliminates that problem completely.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
            {[
              { emoji: '⏰', title: 'Save 40+ Hours', desc: 'Creating a month of quality content takes weeks. We do it in 72 hours.' },
              { emoji: '🎯', title: 'Launch Immediately', desc: 'Stop planning and start posting. Your content is ready the moment you get access.' },
              { emoji: '💎', title: 'Professional Quality', desc: 'Every piece is created by our team who produces content for 7 and 8-figure creators.' },
              { emoji: '📈', title: 'Proven Formats', desc: 'We use the exact formats and styles that are driving results for top performers right now.' },
            ].map((item, i) => (
              <div
                key={i}
                className="rounded-xl p-6"
                style={{ background: '#f8f8f8', border: '1px solid #e5e7eb' }}
              >
                <span className="text-3xl block mb-3">{item.emoji}</span>
                <h3 className="font-black text-lg mb-2" style={{ fontFamily: 'var(--app-font-display)', color: '#1a1a2e' }}>{item.title}</h3>
                <p className="text-sm" style={{ color: '#6b7280', lineHeight: 1.6 }}>{item.desc}</p>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* ============ FINAL CTA / PRICING SECTION ============ */}
      <section className="w-full" style={{ background: '#f8f8f8' }}>
        <div className="max-w-[780px] mx-auto px-4 py-16 md:py-24 text-center">

          <p
            className="italic mb-2"
            style={{ fontSize: 'clamp(22px, 3vw, 32px)', fontFamily: 'var(--app-font-script, Caveat, cursive)', color: '#93E360' }}
          >
            Everything you get today with
          </p>

          <h2
            className="font-black mb-10 md:mb-14"
            style={{ fontSize: 'clamp(32px, 5vw, 56px)', fontFamily: 'var(--app-font-display)', color: '#1a1a2e' }}
          >
            Done-For-You Content Package
          </h2>

          {/* Content Preview */}
          <div className="relative max-w-[640px] mx-auto mb-14 md:mb-18">
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: '10 Podcast Clips', emoji: '🎙️', bg: 'linear-gradient(135deg, #0d1f17, #1a3a25)' },
                { label: '10 TikTok Slides', emoji: '📱', bg: 'linear-gradient(135deg, #111613, #1a2e1e)' },
                { label: '10 Hook + Demo Reels', emoji: '🎬', bg: 'linear-gradient(135deg, #0d3514, #051408)' },
              ].map((item, i) => (
                <div
                  key={i}
                  className="rounded-xl overflow-hidden flex flex-col items-center justify-center p-6 text-center shadow-lg"
                  style={{
                    aspectRatio: '3/4',
                    background: item.bg,
                    border: '1px solid rgba(147,227,96,0.25)',
                  }}
                >
                  <span className="text-4xl mb-3">{item.emoji}</span>
                  <p className="text-white font-bold text-sm leading-tight">{item.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Feature Checklist Card */}
          <div className="max-w-[560px] mx-auto mb-12 rounded-2xl overflow-hidden shadow-lg" style={{ border: '2px solid rgba(147,227,96,0.3)' }}>
            <div className="px-6 py-4 flex items-center gap-2" style={{ background: '#93E360' }}>
              <span className="text-lg">🎁</span>
              <p className="font-bold text-base" style={{ color: '#051408', fontFamily: 'var(--app-font-display)' }}>
                Everything you're getting today:
              </p>
            </div>
            <div className="px-6 py-6 space-y-4 text-left" style={{ background: '#ffffff' }}>
              {[
                '10 Podcast Content Clips (Scripted, Rendered & Captioned)',
                '10 TikTok Slide Shows (Viral Hooks & CTAs Built In)',
                '10 Hook + Demo Reels (Viral Hooks & Product Demos)',
                'All Content Branded to Your Niche',
                'Delivered Directly to Your Portal',
                '72-Hour Turnaround - Guaranteed',
                'Ready to Post Immediately',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center" style={{ background: '#93E360' }}>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="#051408" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </div>
                  <span className="text-sm md:text-base font-medium" style={{ color: '#1a1a2e' }}>{item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Pricing */}
          <div className="mb-10">
            <p
              className="italic mb-3"
              style={{ fontSize: 'clamp(20px, 3vw, 28px)', fontFamily: 'var(--app-font-script, Caveat, cursive)', color: '#555' }}
            >
              Freelancers charge $2,000+ for this
            </p>
            <p className="relative inline-block mb-2">
              <span
                className="line-through decoration-red-500 decoration-[3px]"
                style={{ fontSize: 'clamp(36px, 5vw, 56px)', fontFamily: 'var(--app-font-display)', color: '#999' }}
              >
                $2,000
              </span>
              <span className="ml-1" style={{ fontSize: 'clamp(16px, 2vw, 22px)', color: '#888' }}>
                (freelancer rate)
              </span>
            </p>
            <p
              className="font-black leading-tight"
              style={{ fontSize: 'clamp(22px, 3.5vw, 36px)', fontFamily: 'var(--app-font-display)', color: '#1a1a2e' }}
            >
              Today only: <span style={{ color: '#93E360' }}>$297</span>
            </p>
            <p
              className="font-black"
              style={{ fontSize: 'clamp(20px, 3vw, 32px)', fontFamily: 'var(--app-font-display)', color: '#1a1a2e' }}
            >
              (a full month of content, delivered in 72 hours)
            </p>
          </div>

          {/* CTA Button */}
          <button
            onClick={handleUpgrade}
            disabled={processing}
            className="mx-auto py-4 md:py-5 px-8 md:px-12 rounded-full font-black text-center cursor-pointer hover:scale-[1.02] transition-all duration-200 block mb-8 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              fontSize: 'clamp(16px, 2.2vw, 22px)',
              fontFamily: 'var(--app-font-display)',
              background: '#93E360',
              color: '#051408',
              boxShadow: '0 0 30px -5px rgba(147,227,96,0.4)',
            }}
          >
            {processing ? 'Processing...' : 'Yes - Give Me A Month of Done-For-You Content ($297)'}
          </button>

          <p className="text-sm md:text-base mb-4" style={{ color: '#555' }}>
            Try Risk Free for 30 days with our 100% money back guarantee
          </p>
          <p className="text-sm mb-10" style={{ color: '#888' }}>
            *Instant order confirmation. Content delivered to your portal within 72 hours.
          </p>

          {/* Decline Link */}
          <button
            onClick={handleSkip}
            className="w-full max-w-[560px] mx-auto py-4 rounded-full text-center cursor-pointer hover:bg-gray-200 transition-all block"
            style={{
              fontSize: 'clamp(14px, 1.8vw, 16px)',
              background: '#e8e8e8',
              border: '1px solid #ddd',
              color: '#666',
            }}
          >
            ❌ No thanks - I'll create all the content myself.
          </button>

        </div>
      </section>

      {/* ============ FAQ SECTION ============ */}
      <section className="w-full" style={{ background: '#f8f8f8' }}>
        <div className="max-w-[780px] mx-auto px-4 py-16 md:py-24">

          <div className="text-center mb-12 md:mb-16">
            <h2
              className="font-extrabold leading-tight italic"
              style={{ fontSize: 'clamp(30px, 4.5vw, 48px)', fontFamily: 'var(--app-font-display)', color: '#1a1a2e' }}
            >
              Frequently Asked
            </h2>
            <span
              className="inline-block px-8 py-2 rounded-full font-extrabold mt-2"
              style={{
                fontSize: 'clamp(26px, 4vw, 42px)',
                fontFamily: 'var(--app-font-display)',
                background: '#93E360',
                color: '#051408',
              }}
            >
              Questions
            </span>
          </div>

          <FaqAccordion />

        </div>
      </section>

      {/* ============ FINAL CTA SECTION ============ */}
      <section className="py-16 md:py-24 px-4 md:px-8 lg:px-12" style={{ background: 'linear-gradient(180deg, #051408 0%, #112d14 100%)' }}>
        <div className="max-w-[900px] mx-auto text-center">
          <p className="inline-flex items-center gap-2 text-white/90 font-semibold mb-4" style={{ fontSize: '17px' }}>
            🔥 Special Upgrade for Portfolio Members
          </p>

          <h2 className="font-black text-white mb-10 uppercase text-center max-w-[900px] mx-auto" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(22px, 3.5vw, 40px)' }}>
            A MONTH'S WORTH OF DONE-FOR-YOU CONTENT - DELIVERED IN 72 HOURS
          </h2>

          <div className="grid grid-cols-3 gap-4 max-w-[480px] mx-auto mb-10">
            {[
              { emoji: '🎙️', label: '10 Podcast Clips' },
              { emoji: '📱', label: '10 TikTok Slides' },
              { emoji: '🎬', label: '10 Hook + Demo Reels' },
            ].map((item, i) => (
              <div
                key={i}
                className="rounded-xl p-4 text-center"
                style={{ background: 'rgba(147,227,96,0.08)', border: '1px solid rgba(147,227,96,0.2)' }}
              >
                <span className="text-2xl block mb-2">{item.emoji}</span>
                <p className="text-white font-bold text-xs">{item.label}</p>
              </div>
            ))}
          </div>

          <p className="text-white/80 font-bold mb-6" style={{ fontSize: '18px' }}>Here's everything you get with the Done-For-You Content Package:</p>

          <div className="flex flex-col items-center gap-3 mb-8 max-w-[580px] mx-auto">
            {[
              '10 Podcast Content Clips (Scripted & Captioned)',
              '10 TikTok Slide Shows (Viral Hooks Built In)',
              '10 Hook + Demo Reels (Viral Hooks & Product Demos)',
              'All Content Branded to Your Niche',
              'Delivered to Your Portal in 72 Hours',
              'Ready to Post Immediately',
              '30-Day Money Back Guarantee',
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <span style={{ color: '#93E360', fontSize: '16px' }}>✅</span>
                <span className="text-white/90 font-semibold text-sm md:text-base">{item}</span>
              </div>
            ))}
          </div>

          <button
            onClick={handleUpgrade}
            disabled={processing}
            className="mx-auto py-4 md:py-5 px-8 md:px-12 rounded-full font-black text-center cursor-pointer hover:scale-[1.02] transition-all duration-200 block mb-4 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              fontSize: 'clamp(16px, 2.2vw, 22px)',
              fontFamily: 'var(--app-font-display)',
              background: '#93E360',
              color: '#051408',
              boxShadow: '0 0 30px -5px rgba(147,227,96,0.4)',
            }}
          >
            {processing ? 'Processing...' : 'Yes - Give Me A Month of Done-For-You Content ($297)'}
          </button>

          <p className="flex items-center justify-center gap-2 text-white/50 mb-6" style={{ fontSize: '15px' }}>
            Risk Free 30 Day, 100% Money Back Guarantee
          </p>

          <div className="flex justify-center mb-12">
            <div className="flex -space-x-3">
              {['avatar-f1.jpg','avatar-m1.jpg','avatar-f3.jpg','avatar-m4.jpg','avatar-f5.jpg','avatar-m2.jpg','avatar-f4.jpg','avatar-m3.jpg'].map((src, i) => (
                <img
                  key={i}
                  src={`${import.meta.env.BASE_URL}${src}`}
                  alt=""
                  className="w-11 h-11 rounded-full object-cover border-2"
                  style={{ borderColor: '#112d14' }}
                />
              ))}
            </div>
          </div>

          <button
            onClick={handleSkip}
            className="w-full max-w-[640px] mx-auto block py-4 px-8 rounded-full text-white/60 font-medium transition-all hover:text-white/80"
            style={{ fontSize: '16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            ❌ No thanks - I'll create all the content myself
          </button>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="py-8 px-4 text-center" style={{ background: '#000000' }}>
        <div className="max-w-[600px] mx-auto">
          <div className="flex justify-center mb-4">
            <ProLogo width={140} />
          </div>
          <p className="text-white/40 text-xs mb-4">
            AI Influencer Portfolios is the all-in-one platform for building, scaling, and automating AI influencer businesses.
          </p>
          <p className="text-white/30 text-xs mb-4">
            AI Influencer Portfolios is a product by Cooke Media.
          </p>
          <div className="flex justify-center gap-4 text-white/40 text-xs">
            <span className="hover:text-white/60 cursor-pointer">Terms</span>
            <span className="hover:text-white/60 cursor-pointer">Privacy Policy</span>
            <span className="hover:text-white/60 cursor-pointer">Support</span>
          </div>
        </div>
      </footer>

    </div>
  );
}

function FaqAccordion() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const faqs = [
    {
      q: 'What exactly do I get with this package?',
      a: 'You get a full month of done-for-you content: 10 podcast content clips, 10 TikTok slide shows, and 10 hook + demo reels. Every piece is professionally created, branded to your niche, and delivered directly to your portal within 72 hours.',
    },
    {
      q: 'How is the content customized to me?',
      a: 'We use your AI influencer profile, your niche, and your content pillars to create content that matches your brand. Every piece is tailored to your specific market and audience - not generic templates.',
    },
    {
      q: 'What happens after I purchase?',
      a: 'Your order is confirmed instantly. Our team begins creating your month of content immediately. Within 72 hours, everything is uploaded directly to your portal - ready for you to download, schedule, and start posting.',
    },
    {
      q: 'What if I am not happy with the content?',
      a: 'You are covered by our 30-day money back guarantee. If you are not satisfied with the quality of the content we deliver, we will refund your full $297 - no questions asked.',
    },
  ];

  return (
    <div className="divide-y" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
      {faqs.map((faq, i) => {
        const isOpen = openIdx === i;
        return (
          <div key={i} style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
            <button
              onClick={() => setOpenIdx(isOpen ? null : i)}
              className="w-full flex items-center justify-between py-6 md:py-7 text-left cursor-pointer group"
            >
              <span
                className="font-bold pr-4"
                style={{ fontSize: 'clamp(16px, 2.2vw, 22px)', fontFamily: 'var(--app-font-display)', color: '#1a1a2e' }}
              >
                {faq.q}
              </span>
              <span
                className="flex-shrink-0 text-2xl md:text-3xl font-light transition-transform duration-300"
                style={{ transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)', color: '#999' }}
              >
                +
              </span>
            </button>
            <div
              className="overflow-hidden transition-all duration-300"
              style={{ maxHeight: isOpen ? '200px' : '0', opacity: isOpen ? 1 : 0 }}
            >
              <p className="text-sm md:text-base leading-relaxed pb-6 pr-12" style={{ color: '#555' }}>
                {faq.a}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
