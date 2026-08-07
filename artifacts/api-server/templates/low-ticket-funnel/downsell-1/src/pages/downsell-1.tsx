import { useLocation } from 'wouter';
import { useEffect, useRef, useState } from 'react';
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

const PIPELINE_STEPS = [
  { emoji: '🗓️', label: 'Schedule', desc: 'Set it and forget it - your pipeline runs daily on autopilot' },
  { emoji: '🧠', label: 'AI Script', desc: 'Claude AI writes viral scripts from your content pillars' },
  { emoji: '🎬', label: 'AI Video', desc: 'HeyGen renders your AI influencer speaking the script' },
  { emoji: '✨', label: 'Captions', desc: 'Creatomate adds captions, branding, and effects' },
  { emoji: '📲', label: 'Auto-Post', desc: 'Blotato publishes to all your social accounts instantly' },
];

function AnimatedTimeline() {
  const [activeStep, setActiveStep] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const hasAnimatedRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const startAnimation = () => {
      if (hasAnimatedRef.current) return;
      hasAnimatedRef.current = true;
      PIPELINE_STEPS.forEach((_, i) => {
        const id = window.setTimeout(() => setActiveStep(i), i * 600 + 200);
        timersRef.current.push(id);
      });
    };

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setActiveStep(PIPELINE_STEPS.length - 1);
      hasAnimatedRef.current = true;
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) startAnimation(); },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      timersRef.current.forEach(id => clearTimeout(id));
      timersRef.current = [];
    };
  }, []);

  return (
    <div ref={ref} className="max-w-[750px] mx-auto mt-10 mb-4 px-4">
      <style>{`
        @keyframes timelinePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(147,227,96,0.4); }
          50% { box-shadow: 0 0 0 12px rgba(147,227,96,0); }
        }
        @keyframes timelineSlideUp {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes timelineFillDown {
          from { height: 0; }
          to { height: 100%; }
        }
        .timeline-step-active { animation: timelineSlideUp 0.5s ease-out forwards; }
        .timeline-dot-active { animation: timelinePulse 1.5s ease-in-out infinite; }
        .timeline-line-fill { animation: timelineFillDown 0.4s ease-out forwards; }
      `}</style>

      <div className="relative">
        {PIPELINE_STEPS.map((step, i) => {
          const isActive = i <= activeStep;
          const isCurrentStep = i === activeStep;
          return (
            <div key={i} className="flex gap-5 relative" style={{ minHeight: i < PIPELINE_STEPS.length - 1 ? '100px' : 'auto' }}>
              <div className="flex flex-col items-center relative" style={{ width: '44px', flexShrink: 0 }}>
                <div
                  className={`w-11 h-11 rounded-full flex items-center justify-center text-xl relative z-10 transition-all duration-300 ${isCurrentStep ? 'timeline-dot-active' : ''}`}
                  style={{
                    background: isActive ? 'linear-gradient(135deg, #93E360, #5cb832)' : '#e5e7eb',
                    transform: isActive ? 'scale(1)' : 'scale(0.85)',
                    opacity: isActive ? 1 : 0.4,
                  }}
                >
                  {step.emoji}
                </div>
                {i < PIPELINE_STEPS.length - 1 && (
                  <div className="w-0.5 flex-1 mt-1 relative" style={{ background: '#e5e7eb' }}>
                    {isActive && i < activeStep && (
                      <div className="absolute top-0 left-0 w-full timeline-line-fill" style={{ background: 'linear-gradient(180deg, #93E360, #5cb832)' }} />
                    )}
                  </div>
                )}
              </div>
              <div
                className={`pt-2 pb-4 flex-1 ${isActive ? 'timeline-step-active' : ''}`}
                style={{ opacity: isActive ? 1 : 0.25, transition: 'opacity 0.3s ease' }}
              >
                <p className="font-black text-base mb-0.5" style={{ color: '#1a1a2e', fontFamily: 'var(--app-font-display)' }}>
                  {step.label}
                </p>
                <p className="text-sm" style={{ color: '#6b7280', lineHeight: 1.5 }}>{step.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const FRAMER = 'https://framerusercontent.com/images';
const AI_INF = Array.from({ length: 15 }, (_, i) => `${import.meta.env.BASE_URL}ai-inf-${i + 1}.png`);

function ProLogo({ width = 152 }: { width?: number }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo-pro.png`}
      alt="AI Influencer Portfolio Pro"
      style={{ width, height: 'auto' }}
    />
  );
}

function ScrollingRow({ images, direction = 'left', speed = 30 }: { images: string[]; direction?: 'left' | 'right'; speed?: number }) {
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let raf: number;
    let pos = 0;
    const totalWidth = track.scrollWidth / 3;
    const step = (direction === 'left' ? -1 : 1) * (speed / 60);

    function animate() {
      pos += step;
      if (direction === 'left' && Math.abs(pos) >= totalWidth) pos = 0;
      if (direction === 'right' && pos >= totalWidth) pos = 0;
      track!.style.transform = `translateX(${pos}px)`;
      raf = requestAnimationFrame(animate);
    }
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [direction, speed]);

  const tripled = [...images, ...images, ...images];

  return (
    <div className="overflow-hidden w-full">
      <div ref={trackRef} className="flex gap-4 will-change-transform" style={{ width: 'max-content' }}>
        {tripled.map((src, i) => (
          <img key={i} src={src} alt="" className="h-[140px] md:h-[180px] rounded-xl object-cover flex-shrink-0" style={{ aspectRatio: '16/9' }} />
        ))}
      </div>
    </div>
  );
}

export default function Downsell1() {
  const [, setLocation] = useLocation();

  const carouselRow1 = AI_INF.slice(0, 5);
  const carouselRow2 = AI_INF.slice(5, 10);

  const templateGrid = AI_INF.slice(0, 9);

  const [processing, setProcessing] = useState(false);
  const [chargeError, setChargeError] = useState('');

  const handleUpgrade = async () => {
    setProcessing(true);
    setChargeError('');
    const result = await chargeUpsell('downsell-1');
    setProcessing(false);
    if (result.success) {
      setLocation('/upsell-2');
    } else {
      setChargeError(result.error || 'Payment failed. Please try again.');
    }
  };
  const handleSkip = () => setLocation('/upsell-2');

  return (
    <div className="min-h-screen" style={{ background: '#ffffff' }}>

      {/* ============ HERO SECTION (nav + hero as one seamless block) ============ */}
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
            <img
              src={`${import.meta.env.BASE_URL}step-2-of-3.png`}
              alt="Step 2 of 3"
              className="h-10 md:h-12 sm:order-last"
            />
            <p className="text-white/70 text-sm sm:text-base font-semibold text-center">
              ⚠️ WAIT! If you're on the fence about whether to upgrade...
            </p>
          </div>
        </div>
        <div className="relative z-10 max-w-[900px] mx-auto px-4 pt-10 md:pt-14 pb-0 text-center">
          {/* Badge */}
          <div className="flex justify-center mb-6">
            <span
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full font-semibold tracking-wider uppercase"
              style={{ fontSize: '14.4px', background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              ⚠️ WAIT! IF YOU'RE ON THE FENCE ABOUT WHETHER TO UPGRADE...
            </span>
          </div>

          {/* Main headline */}
          <h1
            className="text-white font-extrabold leading-[1.15] mb-5 uppercase"
            style={{ fontSize: 'clamp(32px, 4.5vw, 56px)', fontFamily: 'var(--app-font-display)' }}
          >
            HOW ABOUT AN EXTRA <span style={{ color: '#93E360' }}>$100 OFF</span>?{' '}
            GET THE PRO PACK FOR JUST{' '}
            <span style={{ textDecoration: 'line-through', color: 'rgba(255,255,255,0.4)' }}>$197</span>{' '}
            <span style={{ color: '#93E360' }}>$97</span>
          </h1>

          {/* Subtext */}
          <p className="text-white/80 font-semibold mb-2 uppercase tracking-wider" style={{ fontSize: 'clamp(14px, 2.5vw, 18px)' }}>
            Students who purchase this can get launched within 2 hours.
          </p>
          <p className="text-white/50 mb-8" style={{ fontSize: 'clamp(14px, 2.5vw, 16px)' }}>
            This price will never be displayed on any other page...
          </p>

          {/* Product Mockup */}
          <div className="mb-10">
            <img
              src={`${import.meta.env.BASE_URL}pro-mockup-main.png`}
              alt="AI Influencer Portfolio Pro - Automated Content Engine"
              className="w-full max-w-[860px] mx-auto h-auto"
            />
          </div>

          {/* Wistia Video Embed */}
          <div className="w-full max-w-[860px] mx-auto rounded-2xl overflow-hidden mb-0">
            <WistiaVideo mediaId="oy5201i5tg" />
          </div>
        </div>

        {/* Green gradient band with CTA */}
        <div
          className="relative w-full overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, transparent 0%, rgba(147,227,96,0.08) 30%, rgba(147,227,96,0.15) 60%, rgba(61,155,79,0.25) 100%)',
          }}
        >
          <div className="max-w-[800px] mx-auto px-4 pt-10 pb-10 text-center relative z-10">
            {/* Price */}
            <p className="text-white font-bold mb-2" style={{ fontSize: 'clamp(17px, 4vw, 22px)' }}>
              🔥 Lifetime access - one single payment of just $97
            </p>
            <p className="mb-3" style={{ fontSize: 'clamp(16px, 3.5vw, 21px)', color: 'rgba(255,255,255,0.4)' }}>
              <span style={{ textDecoration: 'line-through', fontStyle: 'italic' }}>Was $197</span>{' '}
              <span className="font-bold" style={{ color: '#93E360' }}>Save $100 today</span>
            </p>
            <p className="mb-7" style={{ fontSize: '16px', color: 'rgba(147,227,96,0.8)' }}>
              Start generating content immediately after upgrade
            </p>

            {chargeError && (
              <div className="mb-4 mx-auto max-w-[680px] p-3 rounded-lg text-sm text-red-200 text-center" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
                {chargeError}
              </div>
            )}

            {/* CTA Button */}
            <button
              onClick={handleUpgrade}
              disabled={processing}
              className="w-full max-w-[680px] mx-auto block py-5 px-6 md:px-8 rounded-full font-extrabold md:whitespace-nowrap transition-all hover:scale-[1.03] hover:shadow-2xl disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                fontSize: 'clamp(18px, 4.5vw, 26px)',
                background: '#93E360',
                color: '#051408',
                boxShadow: '0 4px 24px rgba(147,227,96,0.3)',
              }}
            >
              {processing ? 'Processing...' : 'YES! I WANT TO UPGRADE FOR JUST $97'}
            </button>

            {/* Guarantee */}
            <p className="flex items-center justify-center gap-1.5 mt-5" style={{ fontSize: '16px', color: 'rgba(255,255,255,0.5)' }}>
              <span className="text-green-400">✅</span>
              Risk Free 30 Day, 100% Money Back Guarantee
            </p>
          </div>
        </div>
      </section>

      {/* ============ UPGRADE TO PRO SECTION ============ */}
      <section className="py-16 md:py-24 px-4" style={{ background: '#ffffff' }}>
        <div className="max-w-[960px] mx-auto text-center">
          {/* "Upgrade to Pro" with line decoration */}
          <div className="flex items-center justify-center gap-4 mb-5">
            <div className="h-px w-16 md:w-24" style={{ background: 'linear-gradient(90deg, transparent, #d1d5db)' }} />
            <p className="text-gray-800 whitespace-nowrap" style={{ fontSize: 'clamp(22px, 3vw, 30px)', fontWeight: 400 }}>
              Upgrade{' '}
              <em style={{ fontStyle: 'italic', textDecoration: 'underline', textUnderlineOffset: '4px', textDecorationColor: '#d1d5db' }}>to</em>{' '}
              Pro 💪
            </p>
            <div className="h-px w-16 md:w-24" style={{ background: 'linear-gradient(270deg, transparent, #d1d5db)' }} />
          </div>

          {/* Main heading */}
          <h2
            className="text-gray-900 mb-14"
            style={{ fontSize: 'clamp(32px, 5.5vw, 56px)', fontWeight: 800, lineHeight: 1.15 }}
          >
            Stop{' '}
            <em
              className="relative inline-block"
              style={{ fontStyle: 'italic', fontWeight: 400 }}
            >
              <span className="absolute inset-0 rounded-sm" style={{ background: 'rgba(239,68,68,0.08)', transform: 'scaleX(1.15) scaleY(0.85)', transformOrigin: 'center' }} />
              <span className="relative">Creating</span>
            </em>{' '}
            Content Manually!
          </h2>

          {/* Standard vs Pro Comparison - overlapping card layout */}
          <div className="relative flex flex-col md:flex-row items-stretch justify-center gap-0 max-w-[860px] mx-auto mb-12">
            {/* Standard Card */}
            <div
              className="w-full md:w-[44%] rounded-2xl text-center z-[1]"
              style={{ background: '#ffffff', border: '1px solid #e5e7eb' }}
            >
              <div className="py-5 px-8" style={{ borderBottom: '1px solid #e5e7eb' }}>
                <p className="font-bold text-gray-800" style={{ fontSize: '18px' }}>Standard</p>
              </div>
              <div className="py-5 px-8" style={{ borderBottom: '1px solid #f3f4f6' }}>
                <p className="text-gray-600" style={{ fontSize: '16px' }}>Manual content creation</p>
              </div>
              <div className="py-5 px-8" style={{ borderBottom: '1px solid #f3f4f6' }}>
                <p className="text-gray-600" style={{ fontSize: '16px' }}>1 AI influencer</p>
              </div>
              <div className="py-5 px-8">
                <p className="text-gray-600" style={{ fontSize: '16px' }}>Monthly subscription</p>
              </div>
            </div>

            {/* VS Badge - centered between cards */}
            <div className="vs-badge-wrapper flex justify-center z-[3] my-[-18px] md:my-0">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center font-bold shadow-lg"
                style={{
                  fontSize: '16px',
                  background: 'linear-gradient(135deg, #93E360, #5cb832)',
                  color: '#051408',
                  boxShadow: '0 4px 12px rgba(147,227,96,0.4)',
                }}
              >
                vs
              </div>
            </div>

            {/* Pro Card */}
            <div
              className="w-full md:w-[56%] rounded-2xl text-center z-[2] md:-ml-2"
              style={{
                background: 'linear-gradient(135deg, #93E360, #5cb832, #3d8b37)',
                boxShadow: '0 8px 32px rgba(147,227,96,0.3)',
              }}
            >
              <div className="py-5 px-8" style={{ borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
                <p className="font-bold text-white" style={{ fontSize: '18px' }}>🔥 Pro (Lifetime Access)</p>
              </div>
              <div className="py-5 px-8" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <p className="text-white font-semibold" style={{ fontSize: '16px' }}>🤖 24/7 Automated AI Content Engine</p>
              </div>
              <div className="py-5 px-8" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <p className="text-white font-semibold" style={{ fontSize: '16px' }}>🗓️ 3-100+ Posts Per Day (Auto-Scheduled)</p>
              </div>
              <div className="py-5 px-8" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <p className="text-white font-semibold" style={{ fontSize: '16px' }}>🥇 Unlimited AI Influencers</p>
              </div>
              <div className="py-5 px-8" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <p className="text-white font-semibold" style={{ fontSize: '16px' }}>🏆 Podcast Clips + Multi-Format Videos</p>
              </div>
              <div className="py-5 px-8">
                <p className="text-white font-semibold" style={{ fontSize: '16px' }}>😎 No Monthly Fees - Ever</p>
              </div>
            </div>
          </div>

          {/* Pointing down */}
          <div style={{ fontSize: '90px', lineHeight: 1 }}>👇</div>
        </div>
      </section>

      {/* ============ THE HARSH TRUTH SECTION ============ */}
      <section className="py-12 md:py-16 px-4" style={{ background: '#ffffff' }}>
        <div className="max-w-[800px] mx-auto text-center">
          <p className="text-gray-500 tracking-[0.25em] uppercase mb-4" style={{ fontSize: '15px' }}>The Harsh Truth:</p>

          <h2 className="font-black mb-8 uppercase" style={{ fontFamily: "var(--app-font-display)", fontSize: 'clamp(36px, 5.5vw, 56px)', color: '#c0392b', lineHeight: 1.1 }}>
            CONTENT DOESN'T<br />CREATE ITSELF
          </h2>

          <div className="max-w-[700px] mx-auto space-y-6 mb-10" style={{ fontSize: '19px', color: '#444', lineHeight: 1.7 }}>
            <p>
              You bought the portfolio. You've got the AI influencer. <em className="underline" style={{ textUnderlineOffset: '4px' }}>But who's making the content?</em> 🤔
            </p>
            <p>Right now, that's you. Manually. Every single day.</p>
            <p>And that's exactly where most people get stuck, burn out, and quit.</p>
            <p>
              Meanwhile, the top accounts in this space are pumping out<br />
              <strong>100-250+ videos per day</strong> on full autopilot.
            </p>
          </div>

          <p className="text-gray-900 font-bold mb-8" style={{ fontSize: '22px' }}>Without the infrastructure, you're stuck with:</p>
        </div>

        <div className="max-w-[960px] mx-auto px-4 md:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-14">
            <div
              className="flex flex-col items-center gap-5 px-6 pt-10 pb-8 rounded-2xl"
              style={{ background: '#ffffff', border: '1px solid #e5e7eb' }}
            >
              <img
                src={`${FRAMER}/JoKum6GXoy1Dcf4Ec7ApbWePI.png?width=1024&height=1024`}
                alt="Time wasted"
                className="w-40 h-40 object-contain"
              />
              <p className="text-gray-700 text-center" style={{ fontSize: '18px', lineHeight: 1.5 }}>
                🕒 <strong>Hours wasted</strong> manually creating, editing, and scheduling every post
              </p>
            </div>
            <div
              className="flex flex-col items-center gap-5 px-6 pt-10 pb-8 rounded-2xl"
              style={{ background: '#ffffff', border: '1px solid #e5e7eb' }}
            >
              <img
                src={`${FRAMER}/M6sEdMnyoD6uNUuKuaLRlpMh3Fs.png?width=1024&height=1024`}
                alt="Money spent"
                className="w-40 h-40 object-contain"
              />
              <p className="text-gray-700 text-center" style={{ fontSize: '18px', lineHeight: 1.5 }}>
                💸 <strong>Money wasted</strong> hiring freelancers or buying tools that don't talk to each other
              </p>
            </div>
            <div
              className="flex flex-col items-center gap-5 px-6 pt-10 pb-8 rounded-2xl"
              style={{ background: '#ffffff', border: '1px solid #e5e7eb' }}
            >
              <img
                src={`${FRAMER}/dM5rZqyx4RJJveEhHg8cSi71JQ.png?width=836&height=744`}
                alt="Frustration"
                className="w-40 h-40 object-contain"
              />
              <p className="text-gray-700 text-center" style={{ fontSize: '18px', lineHeight: 1.5 }}>
                😩 <strong>Falling behind</strong> while competitors run 24/7 on autopilot
              </p>
            </div>
          </div>

          <p className="text-center mb-4" style={{ fontSize: 'clamp(20px, 3vw, 26px)', color: '#1a1a1a', letterSpacing: '0.05em' }}>
            But what if your content creation <strong className="underline" style={{ textUnderlineOffset: '4px' }}>ran completely on its own</strong>?
          </p>

          <AnimatedTimeline />
        </div>
      </section>

      {/* ============ INTRODUCING AI INFLUENCER PORTFOLIO PRO ============ */}
      <section
        className="py-16 md:py-24 px-4"
        style={{ background: 'linear-gradient(180deg, #051408 0%, #0a2810 30%, #112d14 60%, #1a3d1a 100%)' }}
      >
        <div className="max-w-[800px] mx-auto text-center">
          <p className="mb-5" style={{ fontSize: '30px', color: 'rgba(255,255,255,0.7)', fontStyle: 'italic' }}>Introducing</p>

          <div className="flex justify-center mb-10">
            <ProLogo width={280} />
          </div>

          <p className="mb-12 max-w-[750px] mx-auto" style={{ fontSize: 'clamp(20px, 4vw, 32px)', color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>
            The exact AI infrastructure we use to generate <strong style={{ color: '#93E360' }}>250+ videos per day</strong> and build $57K/day businesses. Now plugged directly into your portal - with <strong style={{ color: '#93E360' }}>lifetime access</strong> and unlimited content generation.
          </p>

          <p className="mb-6 max-w-[620px] mx-auto" style={{ fontSize: '18px', color: 'rgba(255,255,255,0.5)' }}>
            <span style={{ textDecoration: 'line-through' }}>Usually $297/month (over $3,500/year)</span>{' '}
            <span className="font-bold" style={{ color: '#93E360' }}>Today only: $97. One time. Forever. Save $100.</span>
          </p>

          <button
            onClick={handleUpgrade}
            disabled={processing}
            className="w-full max-w-[680px] mx-auto block py-5 px-6 md:px-10 rounded-full font-black md:whitespace-nowrap transition-all hover:scale-[1.03] mb-5 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              fontSize: 'clamp(18px, 4.5vw, 22px)',
              background: '#93E360',
              color: '#051408',
              boxShadow: '0 4px 24px rgba(147,227,96,0.4)',
            }}
          >
            {processing ? 'Processing...' : 'YES! I WANT TO UPGRADE FOR JUST $97'}
          </button>
          <p className="mb-10" style={{ fontSize: '16px', color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>Risk Free 30 Day, 100% Money Back Guarantee</p>

          {/* Avatar Overlays */}
          <div className="flex justify-center mb-10">
            <div className="flex -space-x-3">
              {['avatar-f1.jpg','avatar-m1.jpg','avatar-f3.jpg','avatar-m4.jpg','avatar-f5.jpg','avatar-m2.jpg','avatar-f4.jpg','avatar-m3.jpg'].map((src, i) => (
                <img
                  key={i}
                  src={`${import.meta.env.BASE_URL}${src}`}
                  alt=""
                  className="w-12 h-12 rounded-full object-cover"
                  style={{ border: '3px solid #ffffff', zIndex: 8 - i }}
                />
              ))}
            </div>
          </div>

          <p className="max-w-[750px] mx-auto" style={{ fontSize: 'clamp(17px, 3.5vw, 24px)', color: 'rgba(255,255,255,0.75)', lineHeight: 1.7 }}>
            Plug it in. Let it run 24/7. Wake up to finished, edited content ready to post. No monthly fees. No subscriptions. Just pure automated content creation that never stops.
          </p>
        </div>

      {/* ============ INSTANTLY ADD TO YOUR ACCOUNT ============ */}
      <div className="overflow-hidden pt-16 md:pt-24 pb-4">
        <div className="w-full px-4 md:px-8 mb-16">
          <img
            src={`${import.meta.env.BASE_URL}pro-mockup-main.png`}
            alt="AI Influencer Portfolio Pro"
            className="w-full mx-auto rounded-2xl"
          />
        </div>
        <div className="px-4 md:px-8 lg:px-12">

          <h2
            className="text-center font-black mb-16"
            style={{ fontFamily: "'Caveat', cursive", fontSize: 'clamp(36px, 5vw, 56px)', color: '#fff' }}
          >
            Instantly unlocked <span style={{ color: '#93E360', fontStyle: 'italic' }}>inside your</span> portal...
          </h2>

          {/* Feature 1: 24/7 Automated Content Engine */}
          <div
            className="rounded-3xl overflow-hidden mb-8"
            style={{ background: 'linear-gradient(135deg, #56c596 0%, #7edcba 50%, #a8e6cf 100%)' }}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 items-center">
              <div className="flex justify-center items-end p-8 md:p-12 lg:p-16">
                <img
                  src={`${import.meta.env.BASE_URL}pro-mockup-hero.png`}
                  alt="AI Content Engine"
                  className="w-full max-w-[500px]"
                />
              </div>
              <div className="p-8 md:p-12 lg:p-16 md:pl-4">
                <h3 className="font-black text-gray-900 mb-2" style={{ fontSize: 'clamp(30px, 4vw, 48px)', lineHeight: 1.15 }}>
                  🤖 24/7 Automated Content Engine<br />
                  <span style={{ color: 'rgba(0,0,0,0.5)', fontSize: '0.65em' }}>(Runs While You Sleep)</span>
                </h3>
                <p className="text-gray-800 mt-6" style={{ fontSize: 'clamp(17px, 2vw, 22px)', lineHeight: 1.7 }}>
                  Schedule it before bed. Wake up to <strong>3-100+ fully edited posts</strong> ready to publish. No touching it. No checking in. It just runs.
                </p>
              </div>
            </div>
          </div>

          {/* Feature 2: Unlimited AI Influencers */}
          <div
            className="rounded-3xl overflow-hidden mb-8"
            style={{ background: 'linear-gradient(135deg, #051408 0%, #112d14 100%)' }}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 items-center">
              <div className="p-8 md:p-12 lg:p-16">
                <img
                  src={`${import.meta.env.BASE_URL}pro-mockup-unlimited.png`}
                  alt="Unlimited AI Influencers"
                  className="w-full rounded-2xl shadow-2xl"
                />
              </div>
              <div className="p-8 md:p-12 lg:p-16 md:pl-4">
                <h3 className="font-black text-white mb-4" style={{ fontSize: 'clamp(28px, 4vw, 46px)', lineHeight: 1.15 }}>
                  🔥 Add Unlimited AI Influencers
                  <span className="block text-white/50 mt-1" style={{ fontSize: '0.55em' }}>(Scale Without Limits)</span>
                </h3>
                <p className="text-white/80 mt-4" style={{ fontSize: 'clamp(16px, 1.8vw, 21px)', lineHeight: 1.8 }}>
                  Don't stop at one. Add as many AI influencers as you want - <strong className="text-white">different niches, different faces, different revenue streams.</strong> Each one runs on autopilot. This is how we run dozens of accounts simultaneously.
                </p>
                <div className="flex flex-wrap gap-3 mt-8">
                  {[
                    { emoji: '🏋️', label: 'Fitness' },
                    { emoji: '💰', label: 'Finance' },
                    { emoji: '🍳', label: 'Cooking' },
                    { emoji: '✈️', label: 'Travel' },
                    { emoji: '💄', label: 'Beauty' },
                  ].map((cat) => (
                    <span
                      key={cat.label}
                      className="px-5 py-2.5 rounded-full font-medium text-white"
                      style={{ fontSize: '16px', background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.08)' }}
                    >
                      {cat.emoji} {cat.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Feature 3: Podcast Clips + Multi-Format Videos */}
          <div
            className="rounded-3xl overflow-hidden mb-8"
            style={{ background: 'linear-gradient(135deg, #f8a4b8 0%, #f7c6d0 30%, #fbd5c8 100%)' }}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 items-center">
              <div className="p-8 md:p-12 lg:p-16 overflow-hidden flex items-center justify-center">
                <img
                  src={`${import.meta.env.BASE_URL}pro-mockup-podcasts.png`}
                  alt="Podcast Clips and Multi-Format Videos"
                  className="w-full max-w-[500px]"
                />
              </div>
              <div className="p-8 md:p-12 lg:p-16 md:pl-4">
                <h3 className="font-black text-gray-900 mb-4" style={{ fontSize: 'clamp(30px, 4vw, 48px)', lineHeight: 1.15 }}>
                  🎙️ Podcast Clips + Multi-Format Videos
                </h3>
                <p className="text-gray-800 mt-6" style={{ fontSize: 'clamp(17px, 2vw, 22px)', lineHeight: 1.8 }}>
                  Not just standard posts. Generate podcast-style clips, talking head videos, and different content formats - all automatically.
                </p>
                <p className="text-gray-800 mt-4" style={{ fontSize: 'clamp(17px, 2vw, 22px)', lineHeight: 1.8 }}>
                  More variety means more reach. More reach means more revenue.
                </p>
              </div>
            </div>
          </div>

          {/* Feature 4: Direct Posting From Your Portal */}
          <div
            className="rounded-3xl overflow-hidden mt-8 mb-8"
            style={{ background: 'linear-gradient(180deg, #e8c8f0 0%, #f5d5b8 40%, #f7dcc0 100%)' }}
          >
            <div className="text-center pt-12 md:pt-16 px-8 md:px-16">
              <h3 className="font-black text-gray-900 mb-6" style={{ fontSize: 'clamp(30px, 4vw, 48px)', lineHeight: 1.15 }}>
                📲 Post Directly From Inside Your Portal
              </h3>
              <p className="text-gray-700 max-w-[800px] mx-auto" style={{ fontSize: 'clamp(17px, 1.8vw, 22px)', lineHeight: 1.7 }}>
                No downloading. No re-uploading. No switching between 5 different apps. Your content is created, edited, and posted - all from one place. The entire content pipeline from creation to publishing lives inside your portal. That's a true hands-off business.
              </p>
            </div>

            <div className="flex justify-center mt-8 pb-8 px-4 md:px-8">
              <img
                src={`${import.meta.env.BASE_URL}pro-mockup-posting.png`}
                alt="Post Directly From Your Portal"
                className="w-full max-w-[800px] rounded-2xl shadow-xl"
              />
            </div>
          </div>
        </div>
      </div>
      </section>

      {/* ============ EXCLUSIVE PRO-ONLY BONUSES ============ */}
      <section className="pt-8 pb-16 md:pb-24 px-4" style={{ background: 'linear-gradient(180deg, #1a3d1a 0%, #112d14 50%, #051408 100%)' }}>
        <div className="max-w-[1100px] mx-auto">
          <h2
            className="text-center text-white font-black mb-14"
            style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(28px, 4vw, 48px)' }}
          >
            🎁 Exclusive Pro-Only Bonuses
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Bonus 1: 2,000+ Proven Viral Hooks Formula */}
            <div
              className="rounded-3xl overflow-hidden p-8 md:p-10 text-center"
              style={{ background: 'linear-gradient(135deg, rgba(120,200,255,0.15) 0%, rgba(100,220,200,0.12) 100%)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <img
                src={`${import.meta.env.BASE_URL}pro-mockup-hooks.png`}
                alt="Viral Hooks Formula"
                className="w-full max-w-[340px] mx-auto rounded-xl mb-8 shadow-xl"
              />
              <h3 className="font-bold text-white text-xl md:text-2xl mb-4">2,000+ Proven Viral Hooks Formula</h3>
              <p className="text-white/70 leading-relaxed" style={{ fontSize: '16px' }}>
                Includes 100 of Alex Hormozi's top-viewed videos ever, broken down and delivered as plug-and-play templates. These hooks have generated millions of views - just swap in your niche and start posting content that actually stops the scroll.
              </p>
            </div>

            {/* Bonus 2: Content Script Generator */}
            <div
              className="rounded-3xl overflow-hidden p-8 md:p-10 text-center"
              style={{ background: 'linear-gradient(135deg, rgba(120,200,255,0.15) 0%, rgba(100,220,200,0.12) 100%)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <img
                src={`${import.meta.env.BASE_URL}pro-mockup-scripts.png`}
                alt="Content Script Generator"
                className="w-full max-w-[340px] mx-auto rounded-xl mb-8 shadow-xl"
              />
              <h3 className="font-bold text-white text-xl md:text-2xl mb-4">Content Script Generator</h3>
              <p className="text-white/70 leading-relaxed" style={{ fontSize: '16px' }}>
                An AI-powered tool that generates content scripts for you, wired directly into our entire knowledge base - every video we've ever produced. It's updated in real time so your scripts always reflect what's working right now, not last month.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============ COMPARISON TABLE ============ */}
      <section className="py-16 md:py-24 px-4 md:px-8 lg:px-12" style={{ background: '#f8f9fa' }}>
        <div className="mx-auto">
          <h2 className="text-center font-black text-gray-900 mb-12" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(28px, 4vw, 44px)' }}>
            Standard vs Portfolio Pro
          </h2>

          {/* Desktop: 3-column comparison table */}
          <div className="hidden md:grid grid-cols-[1fr_1.5fr_1.2fr] gap-0 rounded-2xl overflow-hidden" style={{ background: '#fff' }}>
            {[
              { feature: 'Feature', pro: 'Portfolio Pro ⚡', standard: 'Standard', isHeader: true },
              { feature: 'Content Creation', pro: '🤖 24/7 Automated AI Engine', standard: 'Manual creation' },
              { feature: 'AI Influencers', pro: '🥇 Unlimited AI Influencers', standard: '1 AI influencer' },
              { feature: 'Daily Posts', pro: '📅 3-100+ Posts Per Day (Auto)', standard: 'Limited manual posting' },
              { feature: 'Content Types', pro: '🎙️ Videos + Podcast Clips', standard: 'Standard posts only' },
              { feature: 'Publishing', pro: '📲 Direct Post From Portal', standard: 'Manual download + upload' },
              { feature: 'Pricing', pro: '🔓 Lifetime Access - No Monthly Fees', standard: '$297/month subscription' },
              { feature: 'Value', pro: '💰 $3,500+/year value', standard: '$297 value' },
            ].map((row, i) => (
              <div key={i} className="contents">
                <div className="px-8 md:px-10 py-7 flex items-center" style={{ borderBottom: i < 9 ? '1px solid #f0f0f0' : 'none' }}>
                  <span className={`${row.isHeader ? 'font-bold text-gray-900' : 'text-gray-500 font-medium'}`} style={{ fontSize: row.isHeader ? '22px' : '19px' }}>
                    {row.feature}
                  </span>
                </div>
                <div
                  className="px-8 md:px-10 py-7 flex items-center"
                  style={{
                    borderBottom: i < 9 ? '1px solid rgba(0,0,0,0.06)' : 'none',
                    background: 'linear-gradient(180deg, #f2fce8 0%, #e8f7d8 100%)',
                    borderLeft: '1px solid #c5e6a0',
                    borderRight: '1px solid #c5e6a0',
                  }}
                >
                  <span className={`${row.isHeader ? 'font-bold text-gray-900' : 'font-semibold text-gray-900'}`} style={{ fontSize: row.isHeader ? '24px' : '19px' }}>
                    {row.pro}
                  </span>
                </div>
                <div className="px-8 md:px-10 py-7 flex items-center" style={{ borderBottom: i < 9 ? '1px solid #f0f0f0' : 'none' }}>
                  <span className={`${row.isHeader ? 'font-bold text-gray-900' : 'text-gray-500 font-medium'}`} style={{ fontSize: row.isHeader ? '22px' : '19px' }}>
                    {row.standard}
                  </span>
                </div>
              </div>
            ))}

            <div className="contents">
              <div className="px-8 md:px-10 py-7"></div>
              <div
                className="px-8 md:px-10 py-7"
                style={{ background: 'linear-gradient(180deg, #f2fce8 0%, #e8f7d8 100%)', borderLeft: '1px solid #c5e6a0', borderRight: '1px solid #c5e6a0' }}
              >
                <p className="font-bold text-gray-900 mb-2" style={{ fontSize: '19px' }}><span style={{ textDecoration: 'line-through', color: '#9ca3af' }}>$197</span> $97 lifetime access</p>
                <p className="text-gray-500 mb-5" style={{ fontSize: '14px' }}><span style={{ textDecoration: 'line-through' }}>$297/month</span> - Save $100 today - No recurring fees</p>
                <button
                  onClick={handleUpgrade}
                  className="w-full px-8 py-4 rounded-xl font-bold text-white transition-all hover:scale-[1.02]"
                  style={{ fontSize: '19px', background: 'linear-gradient(135deg, #34c759, #2ebd55)', boxShadow: '0 4px 14px rgba(52,199,89,0.4)' }}
                >
                  👉 YES! Get Lifetime Access
                </button>
              </div>
              <div className="px-8 md:px-10 py-7 flex items-center">
                <span className="text-gray-500 font-medium" style={{ fontSize: '19px' }}>Included with your order</span>
              </div>
            </div>
          </div>

          {/* Mobile: Stacked comparison cards */}
          <div className="md:hidden flex flex-col gap-6 max-w-[400px] mx-auto">
            {/* Standard Card */}
            <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: '1px solid #e5e7eb' }}>
              <div className="py-4 px-6" style={{ borderBottom: '1px solid #e5e7eb' }}>
                <p className="font-bold text-gray-900 text-center" style={{ fontSize: '20px' }}>Standard</p>
              </div>
              {[
                { label: 'CONTENT', value: 'Manual creation' },
                { label: 'AI INFLUENCERS', value: '1 AI influencer' },
                { label: 'DAILY POSTS', value: 'Limited manual posting' },
                { label: 'CONTENT TYPES', value: 'Standard posts only' },
                { label: 'PRICING', value: '$297/month subscription' },
                { label: 'VALUE', value: '$588+ total value' },
                { label: 'PRICE', value: 'Included with your order' },
              ].map((item, i) => (
                <div key={i} className="py-4 px-6" style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <p className="font-black text-gray-900 uppercase tracking-wider mb-1" style={{ fontSize: '13px' }}>{item.label}</p>
                  <p className="text-gray-600" style={{ fontSize: '16px' }}>{item.value}</p>
                </div>
              ))}
            </div>

            {/* VS Badge */}
            <div className="flex justify-center my-[-12px] z-[3]">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center font-bold shadow-lg"
                style={{
                  fontSize: '16px',
                  background: 'linear-gradient(135deg, #93E360, #5cb832)',
                  color: '#051408',
                  boxShadow: '0 4px 12px rgba(147,227,96,0.4)',
                }}
              >
                vs
              </div>
            </div>

            {/* Pro Card */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: 'linear-gradient(180deg, #f2fce8 0%, #e8f7d8 100%)',
                border: '1px solid #c5e6a0',
              }}
            >
              <div className="py-4 px-6" style={{ borderBottom: '1px solid #c5e6a0' }}>
                <p className="font-bold text-gray-900 text-center" style={{ fontSize: '20px' }}>🔥 Pro</p>
              </div>
              {[
                { label: 'CONTENT', value: '🤖 24/7 Automated AI Engine' },
                { label: 'AI INFLUENCERS', value: '🥇 Unlimited AI Influencers' },
                { label: 'DAILY POSTS', value: '📅 3-100+ Posts Per Day (Auto)' },
                { label: 'CONTENT TYPES', value: '🎙️ Videos + Podcast Clips' },
                { label: 'PRICING', value: '🔓 Lifetime Access - No Monthly Fees' },
                { label: 'VALUE', value: '💰 $3,500+/year value' },
              ].map((item, i) => (
                <div key={i} className="py-4 px-6" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                  <p className="font-black text-gray-900 uppercase tracking-wider mb-1" style={{ fontSize: '13px' }}>{item.label}</p>
                  <p className="font-semibold text-gray-900" style={{ fontSize: '16px' }}>{item.value}</p>
                </div>
              ))}
              <div className="py-5 px-6">
                <p className="font-bold text-gray-900 mb-1 text-center" style={{ fontSize: '18px' }}><span style={{ textDecoration: 'line-through', color: '#9ca3af' }}>$197</span> $97 lifetime access</p>
                <p className="text-gray-500 mb-4 text-center" style={{ fontSize: '14px' }}><span style={{ textDecoration: 'line-through' }}>$297/month</span> - Save $100 today - No recurring fees</p>
                <button
                  onClick={handleUpgrade}
                  className="w-full px-6 py-4 rounded-xl font-bold text-white transition-all hover:scale-[1.02]"
                  style={{ fontSize: '18px', background: 'linear-gradient(135deg, #34c759, #2ebd55)', boxShadow: '0 4px 14px rgba(52,199,89,0.4)' }}
                >
                  👉 YES! Get Lifetime Access
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA SECTION ============ */}
      <section className="py-16 md:py-24 px-4 md:px-8 lg:px-12" style={{ background: 'linear-gradient(180deg, #051408 0%, #112d14 100%)' }}>
        <div className="max-w-[900px] mx-auto text-center">
          <p className="inline-flex items-center gap-2 text-white/90 font-semibold mb-4" style={{ fontSize: '17px' }}>
            🔥 Special Upgrade for Portfolio Members
          </p>

          <h2 className="font-black text-white mb-10 uppercase md:whitespace-nowrap" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(22px, 4vw, 44px)' }}>
            ⚠️ ONLY AVAILABLE RIGHT NOW ON THIS PAGE
          </h2>

          <img
            src={`${import.meta.env.BASE_URL}pro-mockup-main.png`}
            alt="AI Influencer Portfolio Pro"
            className="w-full max-w-[640px] mx-auto rounded-2xl mb-10"
          />

          <p className="text-white/80 font-bold mb-6" style={{ fontSize: '18px' }}>Here's everything you get with Portfolio Pro:</p>

          <div className="flex flex-col items-center gap-3 mb-8 max-w-[580px] mx-auto">
            {[
              '24/7 Automated AI Content Engine',
              'Unlimited AI Influencers',
              '3-100+ Posts Per Day on Autopilot',
              'Podcast Clips + Multi-Format Videos',
              'Lifetime Access - No Monthly Fees',
              '2,000+ Proven Viral Hooks Formula',
            ].map((item, i) => (
              <div
                key={i}
                className="w-full py-3 px-6 rounded-full flex items-center justify-center gap-2 font-semibold text-white"
                style={{ fontSize: '16px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                <span>✅</span> {item}
              </div>
            ))}
          </div>

          <p className="text-white/80 mb-4" style={{ fontSize: '17px' }}>
            👉 <strong>This is lifetime access for a single payment. No monthly fees. No subscriptions. Once you leave this page, this offer is gone forever.</strong>
          </p>
          <p className="mb-8" style={{ fontSize: '15px', color: 'rgba(255,255,255,0.4)' }}>
            <span style={{ textDecoration: 'line-through' }}>$297/month ($3,564/year)</span>{' '}
            <span className="font-bold" style={{ color: '#93E360' }}>Today only: $97. One time. Forever. Save $100.</span>
          </p>

          {chargeError && (
            <div className="mb-4 mx-auto max-w-[680px] p-3 rounded-lg text-sm text-red-200 text-center" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
              {chargeError}
            </div>
          )}

          <button
            onClick={handleUpgrade}
            disabled={processing}
            className="w-full max-w-[680px] mx-auto block py-5 px-6 md:px-8 rounded-full font-black text-white md:whitespace-nowrap transition-all hover:scale-[1.03] mb-4 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              fontSize: 'clamp(18px, 4.5vw, 22px)',
              background: 'linear-gradient(135deg, #34c759, #2ebd55)',
              boxShadow: '0 4px 24px rgba(52,199,89,0.4)',
            }}
          >
            {processing ? 'Processing...' : 'YES! I WANT TO UPGRADE FOR JUST $97!'}
          </button>

          <p className="flex items-center justify-center gap-2 text-white/50 mb-6" style={{ fontSize: '15px' }}>
            ✅ Risk Free 30 Day, 100% Money Back Guarantee
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
            No thanks, I'll pass on this one time exclusive offer and bypass my extra $100 discount today
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

      {/* Phone mockup floating element */}
      <div className="hidden lg:block fixed bottom-0 right-0 pointer-events-none opacity-30" style={{ zIndex: 1 }}>
        <img
          src={`${FRAMER}/wLiM7LxQWNrYajb9wT2bjIDk.svg?width=485&height=968`}
          alt=""
          className="w-[120px]"
        />
      </div>
    </div>
  );
}
