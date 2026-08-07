import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'wouter';
import { motion, useScroll, useTransform, useInView, AnimatePresence } from 'framer-motion';
import { useBrandedFunnel } from '@/contexts/branded-funnel';

function WistiaVideo({ mediaId = "quoc7nzkor", className = "" }: { mediaId?: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const playerScript = document.querySelector('script[src="https://fast.wistia.com/player.js"]');
    if (!playerScript) {
      const s = document.createElement('script');
      s.src = 'https://fast.wistia.com/player.js';
      s.async = true;
      document.head.appendChild(s);
    }

    const embedScript = document.querySelector(`script[src="https://fast.wistia.com/embed/${mediaId}.js"]`);
    if (!embedScript) {
      const s = document.createElement('script');
      s.src = `https://fast.wistia.com/embed/${mediaId}.js`;
      s.async = true;
      s.type = 'module';
      document.head.appendChild(s);
    }
  }, [mediaId]);

  return (
    <div ref={containerRef} className={className}>
      <style dangerouslySetInnerHTML={{ __html: `wistia-player[media-id='${mediaId}']:not(:defined) { background: center / contain no-repeat url('https://fast.wistia.com/embed/medias/${mediaId}/swatch'); display: block; filter: blur(5px); padding-top:56.25%; }` }} />
      <wistia-player media-id={mediaId} aspect="1.7777777777777777" />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   PlaceholderImage — used wherever a real image must be replaced
   by the funnel owner before going live (proof banners, founder
   photos, etc). Renders a clean dashed-bordered slot showing exactly
   what the user is meant to drop in.
   ───────────────────────────────────────────────────────────────────── */
function PlaceholderImage({ label, hint, ratio = '16 / 9' }: { label: string; hint?: string; ratio?: string }) {
  return (
    <div
      className="w-full rounded-xl flex flex-col items-center justify-center text-center px-6"
      style={{
        aspectRatio: ratio,
        background: 'rgba(255,255,255,0.03)',
        border: '2px dashed rgba(255,255,255,0.22)',
        color: 'rgba(255,255,255,0.7)',
      }}
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-60 mb-1">Replace with</span>
      <span className="text-sm md:text-base font-bold uppercase">{label}</span>
      {hint && <span className="text-[11px] mt-2 opacity-60 max-w-[420px]">{hint}</span>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   DevOnlyWarningBanner — renders a hard, impossible-to-miss warning
   when the page is being viewed in dev mode (i.e. before the funnel
   owner has replaced the placeholder proof + press images). The user
   sets PLACEHOLDERS_REPLACED to true once they've swapped everything
   in and the banner disappears.
   ───────────────────────────────────────────────────────────────────── */
const PLACEHOLDERS_REPLACED = false; // ← set to true once you've replaced ALL placeholder images
function DevOnlyWarningBanner() {
  if (PLACEHOLDERS_REPLACED) return null;
  return (
    <div
      className="rounded-xl p-5 mt-4"
      style={{ background: 'rgba(227,38,82,0.12)', border: '2px solid #E32652', color: '#fff' }}
    >
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] mb-2" style={{ color: '#E32652' }}>
        ⚠ Placeholder images detected — DO NOT publish yet
      </div>
      <p className="text-sm leading-relaxed mb-2">
        This sales page ships with <strong>blank placeholder slots</strong> for the proof banner,
        the "Prove To Me This Makes Money" screenshot wall, the "As Seen On" press logos,
        and the founder photo. <strong>Real proof and press logos are not included</strong>
        — and you must never use anyone else's.
      </p>
      <p className="text-sm leading-relaxed">
        Replace every dashed slot with <strong>your own</strong> screenshots, logos, and photos
        before going live. When you're done, set <code style={{ background: 'rgba(0,0,0,0.4)', padding: '1px 6px', borderRadius: '4px' }}>PLACEHOLDERS_REPLACED = true</code>
        at the top of <code style={{ background: 'rgba(0,0,0,0.4)', padding: '1px 6px', borderRadius: '4px' }}>src/pages/sales.tsx</code>
        to hide this banner.
      </p>
    </div>
  );
}

const recentPurchases = [
  { name: 'James', city: 'London', product: 'DFY AI Influencer Build Out' },
  { name: 'Sarah', city: 'New York', product: 'DFY AI Influencer Build Out' },
  { name: 'Michael', city: 'Sydney', product: 'AI Influencer Portfolio + Upsell Bundle' },
  { name: 'Emma', city: 'Toronto', product: 'DFY AI Influencer Build Out' },
  { name: 'David', city: 'Manchester', product: 'DFY AI Influencer Build Out' },
  { name: 'Sophie', city: 'Los Angeles', product: 'AI Influencer Portfolio + Upsell Bundle' },
  { name: 'Ryan', city: 'Dublin', product: 'DFY AI Influencer Build Out' },
  { name: 'Olivia', city: 'Melbourne', product: 'DFY AI Influencer Build Out' },
  { name: 'Daniel', city: 'Houston', product: 'AI Influencer Portfolio + Upsell Bundle' },
  { name: 'Amy', city: 'Birmingham', product: 'DFY AI Influencer Build Out' },
  { name: 'Chris', city: 'Chicago', product: 'DFY AI Influencer Build Out' },
  { name: 'Jessica', city: 'Auckland', product: 'AI Influencer Portfolio + Upsell Bundle' },
  { name: 'Mark', city: 'Bristol', product: 'DFY AI Influencer Build Out' },
  { name: 'Laura', city: 'Miami', product: 'DFY AI Influencer Build Out' },
  { name: 'Tom', city: 'Leeds', product: 'AI Influencer Portfolio + Upsell Bundle' },
  { name: 'Hannah', city: 'Perth', product: 'DFY AI Influencer Build Out' },
  { name: 'Jake', city: 'San Francisco', product: 'DFY AI Influencer Build Out' },
  { name: 'Megan', city: 'Glasgow', product: 'AI Influencer Portfolio + Upsell Bundle' },
  { name: 'Luke', city: 'Dallas', product: 'DFY AI Influencer Build Out' },
  { name: 'Chloe', city: 'Vancouver', product: 'DFY AI Influencer Build Out' },
];

function SalesPopNotification() {
  const [visible, setVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const getTimeAgo = useCallback(() => {
    const mins = Math.floor(Math.random() * 45) + 2;
    return mins < 60 ? `${mins} minutes ago` : `${Math.floor(mins / 60)} hour ago`;
  }, [currentIndex]);

  useEffect(() => {
    if (dismissed) return;

    const showDelay = setTimeout(() => {
      setVisible(true);
    }, 5000);

    return () => clearTimeout(showDelay);
  }, [dismissed]);

  useEffect(() => {
    if (dismissed) return;

    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setCurrentIndex(prev => (prev + 1) % recentPurchases.length);
        setVisible(true);
      }, 600);
    }, 7000);

    return () => clearInterval(interval);
  }, [dismissed]);

  if (dismissed) return null;

  const purchase = recentPurchases[currentIndex];

  return (
    <div
      className="fixed bottom-14 md:bottom-20 left-2 md:left-4 z-[60] max-w-[300px] md:max-w-[340px] transition-all duration-500"
      style={{
        transform: visible ? 'translateY(0)' : 'translateY(120%)',
        opacity: visible ? 1 : 0,
      }}
    >
      <div className="rounded-xl shadow-2xl overflow-hidden" style={{ background: '#FFFFFF', border: '1px solid #E5E3E3' }}>
        <div className="flex items-start gap-3 p-3.5">
          <img src={`${import.meta.env.BASE_URL}product-mockup.png`} alt="AI Influencer Portfolios" className="w-10 h-10 rounded-lg shrink-0 object-cover" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold leading-tight" style={{ color: '#051408' }}>
              {purchase.name} from {purchase.city}
            </p>
            <p className="text-[12px] leading-tight mt-0.5" style={{ color: '#676F68' }}>
              just purchased <strong style={{ color: '#051408' }}>{purchase.product}</strong>
            </p>
            <p className="text-[11px] mt-1" style={{ color: '#93E360' }}>
              {getTimeAgo()}
            </p>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full cursor-pointer hover:bg-gray-100 transition-colors"
            style={{ color: '#999' }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="px-3.5 pb-2 flex items-center gap-1.5">
          <div className="flex gap-0.5">
            {[1,2,3,4,5].map(s => (
              <svg key={s} width="10" height="10" viewBox="0 0 24 24" fill="#93E360" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
            ))}
          </div>
          <span className="text-[10px] font-medium" style={{ color: '#676F68' }}>Verified purchase</span>
        </div>
      </div>
    </div>
  );
}

function GuaranteeBadge({ variant = 'light' }: { variant?: 'light' | 'dark' }) {
  const isLight = variant === 'light';
  return (
    <div className="flex items-center gap-4">
      <div className="w-16 h-16 shrink-0">
        <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          <defs>
            <linearGradient id="goldGrad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#F7D977" />
              <stop offset="50%" stopColor="#D4A843" />
              <stop offset="100%" stopColor="#B8860B" />
            </linearGradient>
          </defs>
          <path d="M32 4L40 8L48 6L52 14L60 18L58 26L62 34L56 40L56 48L48 50L44 58L36 56L32 62L28 56L20 58L16 50L8 48L8 40L2 34L6 26L4 18L12 14L16 6L24 8L32 4Z" fill="url(#goldGrad)" />
          <path d="M22 32L28 38L42 24" stroke="#051408" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-black uppercase leading-tight" style={{ color: isLight ? '#051408' : '#FFFFFF' }}>7-Day Money-Back</p>
        <p className="text-sm font-black uppercase leading-tight" style={{ color: isLight ? '#051408' : '#FFFFFF' }}>Guarantee</p>
        <p className="text-xs mt-1" style={{ color: isLight ? '#676F68' : 'rgba(255,255,255,0.5)' }}>No questions asked. Full refund.</p>
      </div>
    </div>
  );
}

function TrustedBanner({ countryFlag, variant = 'green' }: { countryFlag: string; variant?: 'green' | 'dark' }) {
  const isDark = variant === 'dark';
  const avatars = ['avatar-f1.jpg','avatar-m1.jpg','avatar-f3.jpg','avatar-m4.jpg','avatar-f5.jpg'];
  const textColor = isDark ? '#FFFFFF' : '#051408';
  return (
    <div className="flex items-center gap-4">
      <span className="flex -space-x-2.5 shrink-0">
        {avatars.map((src, i) => (
          <img key={i} src={`${import.meta.env.BASE_URL}${src}`} alt="" className="w-10 h-10 rounded-full object-cover" style={{ border: isDark ? '3px solid #051408' : '3px solid #FFFFFF', zIndex: avatars.length - i }} />
        ))}
      </span>
      <div className="flex flex-col">
        <div className="flex gap-0.5 mb-1">
          {[1,2,3,4,5].map(s => (
            <svg key={s} width="14" height="14" viewBox="0 0 24 24" fill="#93E360" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
          ))}
        </div>
        <p className="text-[11px] font-black uppercase tracking-wider leading-tight" style={{ color: textColor }}>
          TRUSTED BY 12,000+ DIGITAL
        </p>
        <p className="text-[11px] font-black uppercase tracking-wider leading-tight" style={{ color: textColor }}>
          ENTREPRENEURS{countryFlag ? ` FROM ${countryFlag}` : ''}
        </p>
      </div>
    </div>
  );
}

function CTAButton({ onClick }: { onClick: () => void; variant?: 'dark' | 'light' }) {
  return (
    <button
      onClick={onClick}
      className="w-full max-w-[560px] mx-auto py-4 md:py-5 px-6 md:px-10 rounded-2xl text-base md:text-lg font-extrabold uppercase tracking-wider cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:brightness-110 flex flex-col items-center justify-center"
      style={{
        background: '#93E360',
        color: '#051408',
        boxShadow: '0 4px 20px rgba(147,227,96,0.3)',
      }}
    >
      <span className="flex items-center gap-2">YES - BUILD MY AI PORTFOLIO <span className="text-xl">&#8594;</span></span>
      <span className="block text-[10px] md:text-[11px] font-semibold mt-1 uppercase tracking-wider opacity-70">Done For You In 24 Hours, 7-Day Refund Guarantee</span>
    </button>
  );
}

function StarRating() {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <svg key={s} width="14" height="14" viewBox="0 0 24 24" fill="#FFBE00" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
      ))}
    </div>
  );
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(147,227,96,0.03)', border: '1px solid rgba(147,227,96,0.1)' }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-5 text-left cursor-pointer"
        style={{ background: 'transparent', border: 'none', color: '#fff' }}
      >
        <span className="font-semibold text-base pr-4">{question}</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#93E360" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5">
          <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>{answer}</p>
        </div>
      )}
    </div>
  );
}

type Testimonial = {
  initials: string;
  name: string;
  title: string;
  text: string;
  date: string;
  color: string;
  avatar?: string;
};


function TestimonialCard({ t }: { t: Testimonial }) {
  return (
    <div className="p-5 rounded-xl" style={{ background: '#FFFFFF', border: '1px solid #E5E3E3', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div className="flex items-center gap-3 mb-3">
        {t.avatar ? (
          <img src={t.avatar} alt={t.name} className="w-9 h-9 rounded-full shrink-0 object-cover" />
        ) : (
          <div className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center font-bold text-xs text-white" style={{ background: t.color }}>
            {t.initials}
          </div>
        )}
        <span className="font-semibold text-sm" style={{ color: '#051408' }}>{t.name}</span>
      </div>
      <div className="flex gap-0.5 mb-2">
        {[1,2,3,4,5].map(s => (
          <svg key={s} width="14" height="14" viewBox="0 0 24 24" fill="#FFBE00" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
        ))}
      </div>
      <h4 className="font-bold text-sm mb-2" style={{ color: '#051408' }}>{t.title}</h4>
      <p className="text-[13px] leading-relaxed mb-3" style={{ color: '#676F68' }}>{t.text}</p>
      <p className="text-xs" style={{ color: '#9ca3af' }}>{t.date}</p>
    </div>
  );
}


const hiwStepsData = [
  {
    step: '01',
    title: 'You Sign Up - We Build Everything',
    desc: 'Within 24 hours, our team builds your entire AI influencer business from scratch. Custom AI influencer, unique brand identity, high-converting sales page, email automations, AI agent systems - all built bespokely around you.',
    details: ['Custom AI influencer persona', 'Branded sales page', 'Email automation system', 'AI content engine', 'Sales tracking dashboard'],
    mockupType: 'dashboard' as const,
  },
  {
    step: '02',
    title: 'You Start Promoting',
    desc: 'Once your portfolio is live, you simply start sending traffic to your custom sales page. AI generates faceless content for you - no filming, no editing, no guesswork. Just promote and watch the system work.',
    details: ['AI-generated faceless content', 'Organic traffic strategies', 'Pre-built promotion templates', '15 mins per day maximum'],
    mockupType: 'content' as const,
  },
  {
    step: '03',
    title: 'We Handle Everything Else',
    desc: 'When someone purchases through your sales page, they enter our proven funnel with upsells, downsells, and an average order value of $200+. We handle all customer service, all product delivery, all the headaches. Zero operational burden on you.',
    details: ['Full order fulfillment', 'Customer service handled', 'Upsell & downsell funnels', '$200+ average order value'],
    mockupType: 'funnel' as const,
  },
  {
    step: '04',
    title: 'You Keep 100% Of The Profits',
    desc: 'Every sale, every upsell - 100% of the profit is yours. We pay you out monthly. No revenue splits, no hidden fees. The most hands-off, leveraged business model with maximum profit.',
    details: ['100% profit retention', 'Monthly payouts', 'No revenue splits', 'Scale with more portfolios'],
    mockupType: 'profit' as const,
  },
];

function HiwMockup({ mockupType }: { mockupType: string }) {
  if (mockupType === 'dashboard') {
    return (
      <div className="rounded-2xl overflow-hidden" style={{ background: '#111', border: '1px solid rgba(147,227,96,0.15)', boxShadow: '0 0 80px rgba(147,227,96,0.08)' }}>
        <div className="flex items-center gap-1.5 px-4 py-2.5" style={{ background: '#1a1a1a', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#ff5f57' }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#febc2e' }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#28c840' }} />
          <span className="text-[10px] ml-2" style={{ color: 'rgba(255,255,255,0.3)' }}>your-portfolio.com</span>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[{l:'Influencer',v:'Ready'},{l:'Sales Page',v:'Live'},{l:'Automations',v:'Active'}].map((s,i) => (
              <div key={i} className="rounded-xl p-3 text-center" style={{ background: '#1a1a1a' }}>
                <p className="text-[9px] mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.l}</p>
                <p className="text-sm font-bold" style={{ color: '#93E360' }}>{s.v}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl p-4" style={{ background: '#1a1a1a' }}>
            <p className="text-[10px] mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Build Progress</p>
            <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: '#0a0a0a' }}>
              <div className="h-full rounded-full" style={{ width: '100%', background: 'linear-gradient(90deg, #93E360, #4ade80)' }} />
            </div>
            <p className="text-right text-[10px] mt-1 font-bold" style={{ color: '#93E360' }}>100% Complete</p>
          </div>
          <div className="mt-3 flex gap-2 flex-wrap">
            {['AI Influencer','Brand Kit','Email Flow','Content Pack'].map((t,i) => (
              <span key={i} className="text-[9px] px-2 py-1 rounded-full" style={{ background: 'rgba(147,227,96,0.1)', color: '#93E360' }}>&#10003; {t}</span>
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (mockupType === 'content') {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl overflow-hidden" style={{ background: '#111', border: '1px solid rgba(147,227,96,0.15)', boxShadow: '0 0 80px rgba(147,227,96,0.08)' }}>
          <div className="p-5">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: '#93E360' }}>AI Content Generator</p>
            <div className="space-y-2">
              {['Instagram Reel Script','TikTok Hook','Email Sequence','Story Slides'].map((t,i) => (
                <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ background: '#1a1a1a' }}>
                  <span className="text-xs text-white">{t}</span>
                  <span className="text-[9px] px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(147,227,96,0.15)', color: '#93E360' }}>Generated &#10003;</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (mockupType === 'funnel') {
    return (
      <div className="rounded-2xl overflow-hidden" style={{ background: '#111', border: '1px solid rgba(147,227,96,0.15)', boxShadow: '0 0 80px rgba(147,227,96,0.08)' }}>
        <div className="p-5">
          <p className="text-[10px] font-bold uppercase tracking-wider mb-4" style={{ color: '#93E360' }}>Live Funnel Activity</p>
          <div className="space-y-2">
            {[
              {t:'New purchase - Main Product',a:'$27.00',time:'Just now'},
              {t:'Upsell accepted - VIP Bundle',a:'$197.00',time:'2 min ago'},
              {t:'Bump added - Content Pack',a:'$47.00',time:'5 min ago'},
              {t:'New purchase - Main Product',a:'$27.00',time:'8 min ago'},
              {t:'Upsell accepted - Agency License',a:'$497.00',time:'12 min ago'},
            ].map((e,i) => (
              <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ background: '#1a1a1a' }}>
                <div>
                  <p className="text-[11px] text-white">{e.t}</p>
                  <p className="text-[9px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{e.time}</p>
                </div>
                <span className="text-xs font-bold" style={{ color: '#93E360' }}>{e.a}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg p-3 text-center" style={{ background: 'rgba(147,227,96,0.08)', border: '1px solid rgba(147,227,96,0.15)' }}>
            <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.5)' }}>Average order value</p>
            <p className="text-2xl font-black" style={{ color: '#93E360', fontFamily: 'var(--app-font-display)' }}>$218</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#111', border: '1px solid rgba(147,227,96,0.15)', boxShadow: '0 0 80px rgba(147,227,96,0.08)' }}>
      <div className="p-5">
        <p className="text-[10px] font-bold uppercase tracking-wider mb-4" style={{ color: '#93E360' }}>Your Profit Dashboard</p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[{l:'This Week',v:'$4,218'},{l:'This Month',v:'$18,740'},{l:'Profit Margin',v:'100%'},{l:'Next Payout',v:'$18,740'}].map((s,i) => (
            <div key={i} className="rounded-xl p-3" style={{ background: '#1a1a1a' }}>
              <p className="text-[9px] mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.l}</p>
              <p className="text-lg font-black" style={{ color: '#93E360', fontFamily: 'var(--app-font-display)' }}>{s.v}</p>
            </div>
          ))}
        </div>
        <div className="rounded-xl p-4" style={{ background: '#1a1a1a' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Revenue growth</p>
            <span className="text-[10px] font-bold" style={{ color: '#93E360' }}>+312%</span>
          </div>
          <div className="flex items-end gap-[3px] h-16">
            {[20,35,28,45,55,40,65,80,70,95,85,100].map((h,i) => (
              <div key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: `linear-gradient(to top, rgba(147,227,96,0.3), rgba(147,227,96,${0.4 + i * 0.05}))` }} />
            ))}
          </div>
        </div>
        <div className="mt-3 text-center">
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>You keep <strong style={{ color: '#93E360' }}>every single penny</strong></p>
        </div>
      </div>
    </div>
  );
}

function HiwParallaxSteps({ goToCheckout, countryFlag }: { goToCheckout: () => void; countryFlag: string }) {
  const [activeStep, setActiveStep] = useState(0);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const idx = parseInt((visible[0].target as HTMLElement).dataset.hiwIdx || '0', 10);
          setActiveStep(idx);
        }
      },
      { threshold: 0.15, rootMargin: '-20% 0px -60% 0px' }
    );
    stepRefs.current.forEach((el) => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="max-w-[1100px] mx-auto px-6 pb-20 pt-6">
      {hiwStepsData.map((item, idx) => {
        const isActive = activeStep === idx;
        return (
          <div
            key={idx}
            ref={(el) => { stepRefs.current[idx] = el; }}
            data-hiw-idx={idx}
            className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6 lg:gap-14 cursor-pointer"
            onClick={() => setActiveStep(idx)}
            style={{ borderBottom: idx < hiwStepsData.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
          >
            <div className="py-8">
              <div className="flex items-center gap-4 mb-0">
                <span
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-base font-black shrink-0 transition-all duration-300"
                  style={{
                    background: isActive ? 'rgba(147,227,96,0.15)' : 'rgba(255,255,255,0.04)',
                    color: isActive ? '#93E360' : 'rgba(255,255,255,0.25)',
                    fontFamily: 'var(--app-font-display)',
                    border: isActive ? '1px solid rgba(147,227,96,0.3)' : '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  {item.step}
                </span>
                <div className="h-[2px] w-10 transition-all duration-300" style={{ background: isActive ? 'linear-gradient(90deg, #93E360, transparent)' : 'rgba(255,255,255,0.06)' }} />
              </div>

              <h3
                className="text-xl md:text-2xl font-bold uppercase mt-4 transition-colors duration-300"
                style={{
                  fontFamily: 'var(--app-font-display)',
                  color: isActive ? '#FFFFFF' : 'rgba(255,255,255,0.3)',
                  lineHeight: 1.15,
                }}
              >
                {item.title}
              </h3>

              <motion.div
                initial={false}
                animate={{
                  height: isActive ? 'auto' : 0,
                  opacity: isActive ? 1 : 0,
                }}
                transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="overflow-hidden"
              >
                <p className="text-sm leading-relaxed mt-3 mb-4" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  {item.desc}
                </p>
                <div className="flex flex-wrap gap-2">
                  {item.details.map((d, di) => (
                    <span
                      key={di}
                      className="text-[11px] font-medium px-3 py-1.5 rounded-full"
                      style={{ background: 'rgba(147,227,96,0.08)', color: '#93E360', border: '1px solid rgba(147,227,96,0.2)' }}
                    >
                      &#10003; {d}
                    </span>
                  ))}
                </div>
              </motion.div>
            </div>

            <div className="hidden lg:flex items-start pt-8">
              <motion.div
                initial={false}
                animate={{
                  opacity: isActive ? 1 : 0,
                  scale: isActive ? 1 : 0.96,
                }}
                transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="w-full"
                style={{ pointerEvents: isActive ? 'auto' : 'none' }}
              >
                <HiwMockup mockupType={item.mockupType} />
              </motion.div>
            </div>
          </div>
        );
      })}

      <div className="text-center mt-14">
        <CTAButton onClick={goToCheckout} />
        <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-4 sm:gap-6 mt-8 max-w-[600px] mx-auto">
          <GuaranteeBadge variant="dark" />
          <TrustedBanner countryFlag={countryFlag} variant="dark" />
        </div>
      </div>
    </div>
  );
}

function MagicWord({ children, progress, range }: { children: string; progress: any; range: number[] }) {
  const opacity = useTransform(progress, range, [0, 1]);
  return (
    <span className="relative mr-[0.3em] inline-block">
      <span className="opacity-[0.15]">{children}</span>
      <motion.span className="absolute inset-0" style={{ opacity }}>{children}</motion.span>
    </span>
  );
}

function MagicText({ text }: { text: string }) {
  const container = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({
    target: container,
    offset: ["start 0.9", "start 0.25"],
  });
  const words = text.split(" ");
  return (
    <p ref={container} className="flex flex-wrap text-xl md:text-2xl lg:text-3xl font-semibold leading-relaxed" style={{ color: '#FFFFFF' }}>
      {words.map((word, i) => {
        const start = i / words.length;
        const end = start + 1 / words.length;
        return <MagicWord key={i} progress={scrollYProgress} range={[start, end]}>{word}</MagicWord>;
      })}
    </p>
  );
}

function IncomeCalculator({ goToCheckout, countryFlag }: { goToCheckout: () => void; countryFlag: string }) {
  const [customersPerDay, setCustomersPerDay] = useState(2);
  const coachingRate = 0.15;
  const dfyRate = 0.10;

  const monthlyCustomers = customersPerDay * 30;
  const frontEnd = monthlyCustomers * 164;
  const coachingClients = Math.round(monthlyCustomers * coachingRate);
  const coachingIncome = coachingClients * 500;
  const dfyClients = Math.round(monthlyCustomers * dfyRate);
  const dfyIncome = dfyClients * 390;
  const totalMonthly = frontEnd + coachingIncome + dfyIncome;

  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  const formatNum = (n: number) => n.toLocaleString();

  return (
    <section className="relative py-16 md:py-24 px-4 md:px-6 overflow-hidden" style={{ background: '#111613' }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center top, rgba(147,227,96,0.08) 0%, transparent 60%)' }} />
      <div ref={ref} className="max-w-[900px] mx-auto relative z-10">
        <div className="text-center mb-10 md:mb-14">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-5" style={{ background: 'rgba(147,227,96,0.12)', border: '1px solid rgba(147,227,96,0.25)' }}>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#93E360' }}>Interactive Income Calculator</span>
          </div>
          <h2 className="font-bold uppercase" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(26px, 4.5vw, 44px)', color: '#FFFFFF', lineHeight: 1.1 }}>
            HOW TO HIT <span style={{ color: '#93E360' }}>$15,000/MO</span> WITH THIS MODEL
          </h2>
          <p className="mt-4 text-sm md:text-base max-w-[600px] mx-auto leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
            All you do is promote. We handle product delivery, customer service, content, ads - everything. Drag the slider to see your potential income.
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="rounded-2xl overflow-hidden"
          style={{ background: '#051408', border: '1px solid rgba(147,227,96,0.2)' }}
        >
          <div className="p-6 md:p-10">
            <div className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.6)' }}>Customers Per Day</label>
                <span className="text-2xl font-black" style={{ fontFamily: 'var(--app-font-display)', color: '#93E360' }}>{customersPerDay}</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={customersPerDay}
                onChange={(e) => setCustomersPerDay(Number(e.target.value))}
                className="w-full h-3 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #93E360 0%, #93E360 ${((customersPerDay - 1) / 9) * 100}%, rgba(147,227,96,0.15) ${((customersPerDay - 1) / 9) * 100}%, rgba(147,227,96,0.15) 100%)`,
                  accentColor: '#93E360',
                }}
              />
              <div className="flex justify-between mt-1.5">
                <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>1</span>
                <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>10</span>
              </div>
            </div>

            <div className="space-y-3 mb-8">
              <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: 'rgba(147,227,96,0.06)', border: '1px solid rgba(147,227,96,0.1)' }}>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider mb-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Front-End Product Sales</p>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{customersPerDay}/day x 30 days x $164 avg order</p>
                </div>
                <span className="text-xl md:text-2xl font-black" style={{ fontFamily: 'var(--app-font-display)', color: '#FFFFFF' }}>${formatNum(frontEnd)}</span>
              </div>

              <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: 'rgba(147,227,96,0.06)', border: '1px solid rgba(147,227,96,0.1)' }}>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider mb-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>1-1 Coaching Commissions</p>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{coachingClients} clients/mo x $500 payout - you do nothing extra</p>
                </div>
                <span className="text-xl md:text-2xl font-black" style={{ fontFamily: 'var(--app-font-display)', color: '#FFFFFF' }}>${formatNum(coachingIncome)}</span>
              </div>

              <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: 'rgba(147,227,96,0.06)', border: '1px solid rgba(147,227,96,0.1)' }}>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider mb-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>DFY Content & Ads Recurring</p>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{dfyClients} clients/mo x $390/mo avg - fully passive</p>
                </div>
                <span className="text-xl md:text-2xl font-black" style={{ fontFamily: 'var(--app-font-display)', color: '#FFFFFF' }}>${formatNum(dfyIncome)}<span className="text-xs font-normal" style={{ color: 'rgba(255,255,255,0.4)' }}>/mo</span></span>
              </div>
            </div>

            <div className="rounded-xl p-5 md:p-6 text-center" style={{ background: 'rgba(147,227,96,0.1)', border: '2px solid rgba(147,227,96,0.3)' }}>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>Your Estimated Monthly Income</p>
              <p className="font-black" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(36px, 6vw, 56px)', color: '#93E360', lineHeight: 1.1 }}>
                ${formatNum(totalMonthly)}<span className="text-lg md:text-xl" style={{ color: 'rgba(147,227,96,0.6)' }}>/mo</span>
              </p>
              <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
                That's ${formatNum(totalMonthly * 12)}/year - and you only paid $27 to start
              </p>
            </div>

            <p className="text-center text-xs mt-4 leading-relaxed" style={{ color: 'rgba(255,255,255,0.3)' }}>
              We handle product delivery, customer service, and fulfillment end to end. We can even handle your content and ads if you wish. All you do is promote.
            </p>
          </div>
        </motion.div>

        <div className="text-center pt-10">
          <CTAButton onClick={goToCheckout} />
          <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-4 sm:gap-6 mt-8 max-w-[600px] mx-auto">
            <GuaranteeBadge variant="dark" />
            <TrustedBanner countryFlag={countryFlag} variant="dark" />
          </div>
        </div>
      </div>
    </section>
  );
}

const COUNTRY_FLAGS: Record<string, string> = {
  US: "\u{1F1FA}\u{1F1F8}", GB: "\u{1F1EC}\u{1F1E7}", AU: "\u{1F1E6}\u{1F1FA}", CA: "\u{1F1E8}\u{1F1E6}", NZ: "\u{1F1F3}\u{1F1FF}",
  AE: "\u{1F1E6}\u{1F1EA}", DE: "\u{1F1E9}\u{1F1EA}", NL: "\u{1F1F3}\u{1F1F1}", SE: "\u{1F1F8}\u{1F1EA}", CH: "\u{1F1E8}\u{1F1ED}",
  IE: "\u{1F1EE}\u{1F1EA}", NO: "\u{1F1F3}\u{1F1F4}", SG: "\u{1F1F8}\u{1F1EC}", DK: "\u{1F1E9}\u{1F1F0}", BE: "\u{1F1E7}\u{1F1EA}",
  FR: "\u{1F1EB}\u{1F1F7}", ES: "\u{1F1EA}\u{1F1F8}", IT: "\u{1F1EE}\u{1F1F9}", JP: "\u{1F1EF}\u{1F1F5}", KR: "\u{1F1F0}\u{1F1F7}",
  IN: "\u{1F1EE}\u{1F1F3}", BR: "\u{1F1E7}\u{1F1F7}", MX: "\u{1F1F2}\u{1F1FD}", ZA: "\u{1F1FF}\u{1F1E6}", PH: "\u{1F1F5}\u{1F1ED}",
  MY: "\u{1F1F2}\u{1F1FE}", TH: "\u{1F1F9}\u{1F1ED}", ID: "\u{1F1EE}\u{1F1E9}",
};

function formatRevShort(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function getSalesMilestone(rev: number): { label: string; color: string } {
  if (rev >= 1000000) return { label: "MILLION DOLLAR CLUB", color: "#eab308" };
  if (rev >= 100000) return { label: "SIX-FIGURE CLUB", color: "#a855f7" };
  if (rev >= 10000) return { label: "MOMENTUM BUILDER", color: "#d97706" };
  if (rev >= 1000) return { label: "STARTER CLUB", color: "#16a34a" };
  return { label: "RISING", color: "#9ca3af" };
}

export default function Sales({ videoId = "quoc7nzkor" }: { videoId?: string }) {
  const [, setLocation] = useLocation();
  const branded = useBrandedFunnel();
  const goToCheckout = () => setLocation('/checkout');
  const brandedLogo = branded.isBranded && branded.logoDarkUrl ? branded.logoDarkUrl : null;

  const [countryFlag, setCountryFlag] = useState('');
  const [lbData, setLbData] = useState<{ entries: any[]; totalMembers: number } | null>(null);

  useEffect(() => {
    fetch('https://ipapi.co/json/')
      .then(r => r.json())
      .then(data => {
        if (data.country_code) {
          const flag = data.country_code
            .toUpperCase()
            .split('')
            .map((c: string) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
            .join('');
          setCountryFlag(flag);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const API_BASE = `${import.meta.env.BASE_URL}api`;
    fetch(`${API_BASE}/leaderboard?limit=15`)
      .then(r => r.json())
      .then(data => { if (data.entries) setLbData(data); })
      .catch(() => {});
  }, []);


  const testimonials: Testimonial[] = [
    { initials: "BM", name: "Bella Martinez", title: "first sale in 24 hours!!", text: "ok so I had literally ZERO experience online. none. no audience no tech skills nothing lol. they built my whole AI influencer portfolio and sales page in one day and I woke up the next morning to a $27 sale notification. I actually cried haha. this is real", date: "Mar 21, 2026", color: "#4ade80", avatar: `${import.meta.env.BASE_URL}avatar-f1.jpg` },
    { initials: "MH", name: "Muna Hassan", title: "$6K in 32 days no paid ads", text: "I made $6,247 in my first 32 days. didnt spend a single dollar on ads. all I do is post the content they gave me and drive people to the page they built. the system just works I dont even understand how it converts this well lol", date: "Mar 19, 2026", color: "#60a5fa", avatar: `${import.meta.env.BASE_URL}avatar-f2.jpg` },
    { initials: "JT", name: "James Torres", title: "10x return first week", text: "was skeptical tbh. been burned by every done for you thing out there. but $27 was nothing to lose so I went for it. they delivered my influencer, product, page, everything. made $270+ back in 7 days just from organic. not bad at all", date: "Mar 18, 2026", color: "#f97316", avatar: `${import.meta.env.BASE_URL}avatar-m1.jpg` },
    { initials: "KW", name: "Keisha Williams", title: "they built everything", text: "all I do is promote. thats it. I dont write copy, dont design pages, dont create products. they did ALL of it. my only job is sharing the link and I made my first $500 in week two", date: "Mar 18, 2026", color: "#8b5cf6", avatar: `${import.meta.env.BASE_URL}avatar-f3.jpg` },
    { initials: "RP", name: "Ryan Parker", title: "quit my job lol", text: "handed in my notice 2 months after buying this. was working 60 hour weeks at a job I hated. bought it on a whim during lunch break. portfolio is doing $4K+/month now and still growing. best $27 ever spent no question", date: "Mar 13, 2026", color: "#ec4899" },
    { initials: "AS", name: "Aisha Siddiqi", title: "THIS IS INSANE", text: "went from scrolling tiktok feeling sorry for myself to actually having a real business generating daily sales. they built the whole thing in 24 hours. product, page, influencer, everything. I cant believe this is my life now lol", date: "Mar 12, 2026", color: "#14b8a6", avatar: `${import.meta.env.BASE_URL}avatar-f4.jpg` },
    { initials: "DM", name: "Derek Mitchell", title: "3 sales day one", text: "shared link on my IG story, 3 sales before lunch. simple as that", date: "Jan 28, 2026", color: "#f59e0b", avatar: `${import.meta.env.BASE_URL}avatar-m2.jpg` },
    { initials: "TN", name: "Tanya Nguyen", title: "$0 to $2,100 in 3 weeks", text: "3 weeks ago I had nothing. no product no page no clue. now I have a fully branded AI influencer portfolio making sales on autopilot. $2,100 and counting. the 24 hour delivery is legit they actually delivered overnight", date: "Dec 19, 2025", color: "#6366f1" },
    { initials: "CS", name: "Connor Sullivan", title: "finally something that works", text: "bought courses, coaching programs, group programs, you name it. spent over $8K on stuff that never worked. this $27 thing delivered more results in ONE WEEK than everything else combined. genuinely speechless rn", date: "Nov 20, 2025", color: "#10b981" },
    { initials: "LR", name: "Lauren Reed", title: "husband wants one now too lmao", text: "told my husband I bought a $27 AI portfolio thing and he literally rolled his eyes at me. showed him my first $400 week and guess what? he asked me to buy one for him too. we both run AI portfolios from home now. life. changed.", date: "Nov 4, 2025", color: "#3b82f6", avatar: `${import.meta.env.BASE_URL}avatar-f5.jpg` },
    { initials: "MP", name: "Marcus Price", title: "4.2% conversion rate!!!", text: "the sales page they built converts at 4.2%. on cold traffic. from a $27 product. I've built pages before and they were trash compared to this. the copy, design, flow is all world class honestly", date: "Sep 18, 2025", color: "#a855f7", avatar: `${import.meta.env.BASE_URL}avatar-m3.jpg` },
    { initials: "NJ", name: "Natasha Jones", title: "$900 first month part time", text: "single mum, maybe 2 hours a day after kids go to bed. $900 first month just posting content and sharing my link. not life changing yet but its REAL money from real customers and its growing every week", date: "Sep 17, 2025", color: "#ef4444" },
    { initials: "BW", name: "Brandon Walsh", title: "the real deal fr", text: "been burned so many times. every system is always missing something. this one actually delivers a complete business. influencer, product, sales page, templates, everything. all I do is promote. $1,200 in 3 weeks", date: "Sep 16, 2025", color: "#0ea5e9" },
    { initials: "PG", name: "Priya Gupta", title: "I just share a link lol", text: "people ask me what I do and I tell them I share a link. thats literally it. they built my entire AI influencer business, I post content, people click, people buy. $3,400 in 6 weeks doing this 30 mins a day. I still cant believe it tbh", date: "Sep 9, 2025", color: "#84cc16", avatar: `${import.meta.env.BASE_URL}avatar-f6.jpg` },
    { initials: "SC", name: "Sean Crawford", title: "insane quality", text: "ordered 11pm, woke up to my complete portfolio ready to go. quality of the sales page alone would cost $2K+ from an agency easy. first sale within 48 hrs", date: "Sep 13, 2025", color: "#d946ef" },
    { initials: "OG", name: "Olivia Garcia", title: "best $27 of my life", text: "I dont say this lightly. best purchase I've ever made online. period. my portfolio has generated $4,800 in 2 months. my old business made $0 in 2 years lol. the difference is someone actually BUILT it for me instead of teaching me theory", date: "Sep 9, 2025", color: "#f97316" },
    { initials: "TH", name: "Tyler Henderson", title: "sales while I sleep", text: "check my phone every morning and theres new sale notifications. its surreal honestly. they built the product, the page, everything. my influencer does the selling I just drive traffic", date: "Sep 17, 2025", color: "#4ade80", avatar: `${import.meta.env.BASE_URL}avatar-m4.jpg` },
    { initials: "NK", name: "Nina Kowalski", title: "$1,800 in 2 weeks", text: "$1,800. two weeks. no experience. no list. no audience. just the system they built and the content templates. followed the steps exactly and it works. period.", date: "Jan 16, 2026", color: "#60a5fa" },
    { initials: "JC", name: "Jordan Clarke", title: "replaced my freelancing income", text: "was freelancing 40+ hrs a week making $3K/month. my AI portfolio makes the same and I work maybe 5 hours a week on it now. just schedule posts and share the link. they built everything else for me. freedom is real", date: "Nov 7, 2025", color: "#f97316", avatar: `${import.meta.env.BASE_URL}avatar-m5.jpg` },
    { initials: "RB", name: "Rachel Brooks", title: "daily sales in 72 hours", text: "first sale 72 hours after delivery. now getting 1-3 sales per day just from organic content. product they made is genuinely good too my customers leave amazing feedback which is nice", date: "Sep 19, 2025", color: "#8b5cf6", avatar: `${import.meta.env.BASE_URL}avatar-f7.jpg` },
    { initials: "AJ", name: "Andre Johnson", title: "thought it was a scam ngl", text: "every DFY service I tried before was garbage. half finished cookie cutter junk. this was actually different tho. portfolio was custom to my niche, branding was professional, started making money within the first week. I stand corrected", date: "Sep 17, 2025", color: "#ec4899" },
    { initials: "HT", name: "Hannah Torres", title: "my friends think im a genius haha", text: "friends keep asking how I started a tech company. I just smile. they dont need to know it cost $27 lol", date: "Sep 18, 2025", color: "#14b8a6" },
    { initials: "DV", name: "Daniel Vasquez", title: "GAME CHANGER", text: "work full time, 2 kids. needed something I could do in spare time without learning a bunch of stuff. this is literally perfect for that. they build it I promote it. $1,600 first month working maybe 20 mins a day honestly probably less some days", date: "Mar 17, 2026", color: "#f59e0b", avatar: `${import.meta.env.BASE_URL}avatar-m6.jpg` },
    { initials: "VT", name: "Vanessa Thomas", title: "content templates are gold", text: "they didnt just build my portfolio, the content templates they gave me are incredible. I literally just plug in my details post and sales come in. $5,200 in 2 months without writing a single piece of copy myself. who even does that lol", date: "Mar 18, 2026", color: "#6366f1" },
    { initials: "CL", name: "Chris Lee", title: "accountant was shocked", text: "showed my accountant the numbers and he couldnt believe I started a business doing $3K+/month from a $27 investment. hes now asking ME for advice which is hilarious tbh", date: "Dec 10, 2025", color: "#10b981" },
    { initials: "MW", name: "Maya Williams", title: "5 SALES DAY ONE", text: "posted my first content at 9am. by midnight I had 5 sales. FIVE. day one. zero audience. the sales page they built does all the heavy lifting its honestly ridiculous how good it converts", date: "Nov 18, 2025", color: "#3b82f6", avatar: `${import.meta.env.BASE_URL}avatar-f8.jpg` },
    { initials: "PW", name: "Patrick Watson", title: "better than any course", text: "spent $12K+ on courses and coaching. none of them gave me an actual BUSINESS. this gave me a complete ready to sell portfolio in 24 hours. already made back my investment 50x over", date: "Sep 18, 2025", color: "#a855f7" },
    { initials: "EH", name: "Elena Hernandez", title: "changed everything for us", text: "single mom of 3. was working two jobs barely getting by. friend told me about this and I thought no way its real. 6 weeks later quit my second job. AI portfolio makes more than both jobs combined. I still get emotional talking about it honestly because its changed our whole situation at home", date: "Jan 14, 2026", color: "#ef4444" },
    { initials: "KM", name: "Kevin Murphy", title: "24 hour delivery is legit", text: "ordered 2pm tuesday. wednesday morning had complete AI influencer, branded product, professional sales page, content templates. made first sale wednesday night. insane.", date: "Dec 2, 2025", color: "#0ea5e9", avatar: `${import.meta.env.BASE_URL}avatar-m7.jpg` },
    { initials: "LM", name: "Lisa Montgomery", title: "just post and share", text: "my entire job is posting templates and sharing my link. thats it. they built everything. $7,200 in 3 months spending maybe 30 mins a day. unreal", date: "Dec 1, 2025", color: "#84cc16" },
    { initials: "JF", name: "Jake Foster", title: "wife is on board now lol", text: "wife thought online business was a scam. showed her the daily sales coming in, $50-$150 per day, and now shes asking when she can get her own portfolio haha", date: "Nov 17, 2025", color: "#d946ef" },
    { initials: "SA", name: "Samira Ahmed", title: "fastest ROI ever", text: "made my $27 back within 6 hours. 10x that in the first week. didnt have to learn anything just promote what they built. this is how online business should work fr", date: "Oct 12, 2025", color: "#f97316" },
    { initials: "RW", name: "Robert Wilson", title: "$4,200 month one", text: "set a goal of $500 my first month. made $4,200. the portfolio they built is literally a money printing machine. page converts, product is great, customers keep buying. mind = blown", date: "Oct 4, 2025", color: "#4ade80", avatar: `${import.meta.env.BASE_URL}avatar-m8.jpg` },
    { initials: "TF", name: "Tara Flynn", title: "free from client work!!", text: "used to trade hours for dollars doing social media management. now my AI portfolio makes more and I dont deal with a single client. they built it, I promote it, money comes in. this is freedom", date: "Jan 23, 2026", color: "#60a5fa" },
    { initials: "MS", name: "Michael Santos", title: "quality blew me away", text: "expected something basic for $27 but what they delivered was genuinely premium. influencer looks incredible, digital product is actually valuable, showed the sales page to a marketer friend and he thought I paid like $5K for it lmao", date: "Jan 28, 2026", color: "#f97316" },
    { initials: "JD", name: "Jessica Davis", title: "10 years of trying and THIS worked", text: "dropshipping. amazon FBA. affiliate marketing. print on demand. 10 years of trying stuff and nothing worked. this worked in 3 days. the difference? someone finally just BUILT the business for me", date: "Feb 25, 2026", color: "#8b5cf6" },
    { initials: "WC", name: "William Chen", title: "way better than amazon FBA", text: "ran an amazon FBA business for 2 years. inventory headaches, supplier issues, razor thin margins. my AI portfolio has zero inventory zero suppliers and 90%+ margins. and they built it all for me. no comparison honestly", date: "Jan 22, 2026", color: "#ec4899", avatar: `${import.meta.env.BASE_URL}avatar-m9.jpg` },
    { initials: "AM", name: "Amber Mitchell", title: "bonuses are worth 10x alone", text: "portfolio was incredible on its own but the bonuses? content templates, traffic playbook, DM scripts - went from 1 sale a day to 5-6 after using them. absolute game changer the bonuses are lowkey the best part", date: "Jan 23, 2026", color: "#14b8a6" },
    { initials: "GT", name: "Greg Thompson", title: "promote from my phone thats it", text: "no laptop. no office. I do everything from my phone while waiting in line, lunch breaks, before bed. $2,800 last month in spare time. system is genius honestly", date: "Feb 5, 2026", color: "#f59e0b" },
    { initials: "NP", name: "Nadia Patel", title: "47 sales week one!!!", text: "47 sales. week one. no audience. no ads. just content templates and my social accounts. averaging $200+/day now still growing. the page they built converts like nothing ive ever seen before", date: "Jan 29, 2026", color: "#6366f1" },
    { initials: "ZC", name: "Zach Coleman", title: "easiest business ever", text: "ran a landscaping company, pressure washing biz, and marketing agency. this AI portfolio is easier than ALL of them combined. no employees no equipment no clients. just promote and profit", date: "Feb 11, 2026", color: "#10b981", avatar: `${import.meta.env.BASE_URL}avatar-m10.jpg` },
    { initials: "KR", name: "Karen Rodriguez", title: "skeptic to superfan", text: "almost didnt buy. been burned before. but $27 why not right? saw the quality of what they delivered, made 3 sales in 48 hours and became a superfan. these guys are legit", date: "Feb 7, 2026", color: "#3b82f6" },
    { initials: "TK", name: "Trevor King", title: "$280K week is real", text: "saw their $280K screenshot and thought fake. after running my own portfolio 2 months and making $8K I now see how scaling with paid ads could absolutely hit those numbers. the system is built to scale thats the thing most people dont get yet", date: "Feb 20, 2026", color: "#a855f7" },
    { initials: "SR", name: "Sarah Richardson", title: "coworkers have no idea lol", text: "still work my day job but AI portfolio side income now exceeds my salary. coworkers complain about bills while im secretly planning my exit. they built this entire business for me in 24 hours let that sink in", date: "Jan 28, 2026", color: "#ef4444" },
    { initials: "JB", name: "Jason Blake", title: "replaced uber income", text: "was driving uber 12 hrs a day making $150. now I make $150+ from my portfolio working 30 mins. they built it all. best decision of my life", date: "Jan 22, 2026", color: "#0ea5e9" },
    { initials: "LH", name: "Layla Hughes", title: "even my kids are impressed", text: "my teenager asked how im making money on my phone. showed her the dashboard and she said mom thats actually really cool. if a 15 year old is impressed you know its legit haha", date: "Feb 2, 2026", color: "#84cc16" },
    { initials: "DK", name: "David Kim", title: "7 day guarantee sold me", text: "was on the fence but 7 day refund guarantee made it a no brainer. didnt need it tho - made $340 in first 5 days. 6 weeks in doing $3K+/month now", date: "Feb 1, 2026", color: "#d946ef", avatar: `${import.meta.env.BASE_URL}avatar-m11.jpg` },
    { initials: "MR", name: "Monica Rivera", title: "delivered before I woke up", text: "ordered midnight. woke up 7am. complete portfolio in my inbox. first sale by noon", date: "Feb 17, 2026", color: "#f97316" },
    { initials: "BT", name: "Blake Turner", title: "tried everything this actually works", text: "dropshipping. crypto. NFTs. courses. coaching. print on demand. amazon. ALL failed or were way too complicated. this? they build it you promote it. $1,900 in 3 weeks. finally", date: "Feb 20, 2026", color: "#4ade80" },
    { initials: "CJ", name: "Carla Jenkins", title: "influencer sells better than I ever could", text: "im terrible at selling, like actually hate it. my AI influencer does all the selling on the page they built and I just get people there. $2,600 first month without a single sales call or video of my face", date: "Feb 13, 2026", color: "#60a5fa" },
    { initials: "NO", name: "Nathan Owens", title: "criminal value at $27", text: "what you get would easily cost $5,000+ from freelancers. influencer, product, sales page, content strategy, all done for you. $6K+ so far from a $27 investment. actually criminal how underpriced this is", date: "Feb 12, 2026", color: "#f97316" },
    { initials: "EP", name: "Emily Patterson", title: "telling everyone I know", text: "told my friends, family, coworkers. anyone who wants to make money online THIS is it. stop wasting money on courses and just get someone to build the business for you", date: "Jan 13, 2026", color: "#8b5cf6" },
    { initials: "RH", name: "Ryan Harris", title: "daily sales no days off", text: "at least 1 sale every single day for 38 days straight. most days 3-5. the system is a machine. all I do is feed it traffic", date: "Jan 30, 2026", color: "#ec4899" },
    { initials: "SW", name: "Stephanie Walker", title: "this is actually real", text: "keep pinching myself. $4,100 last month. no tech skills, no marketing experience, no audience when I started. they built EVERYTHING. I just promote. if your reading this and hesitating just do it honestly you wont regret it", date: "Feb 9, 2026", color: "#14b8a6" },
    { initials: "MF", name: "Marcus Freeman", title: "friend bought same day", text: "buddy saw my earnings and bought same day. now were both making money. quality is so good people cant believe it costs $27", date: "Feb 5, 2026", color: "#f59e0b" },
    { initials: "AW", name: "Ashley Wright", title: "zero tech skills needed", text: "I can barely use excel lol. thought id struggle but they build EVERYTHING. product, page, content templates. all I do is copy paste and post. $800 in 2 weeks with zero tech skills", date: "Feb 3, 2026", color: "#6366f1" },
    { initials: "JV", name: "Justin Vargas", title: "DFY model is the future", text: "why would anyone spend months learning to build a business when you can have it built for you in 24 hours? made my money back day one. averaging $120/day now. DFY is the future period", date: "Mar 5, 2026", color: "#10b981" },
    { initials: "TA", name: "Taylor Adams", title: "went viral $2,400 in one day", text: "one of my posts hit 50K views and I made $2,400 that day from my portfolio. the sales page converted all that traffic into buyers. even on normal days im doing $100-200 tho so its not like I need to go viral to make money", date: "Feb 9, 2026", color: "#3b82f6" },
    { initials: "LD", name: "Laura Diaz", title: "makes money while I sleep", text: "woke up to 4 sales this morning. was literally sleeping. the portfolio works 24/7 the page is always live always selling. I just post content during the day. passive income is actually real turns out", date: "Feb 2, 2026", color: "#a855f7" },
    { initials: "CH", name: "Cameron Hayes", title: "10/10 would buy 100x over", text: "$27 in, $9,400 out in 3 months. thats the ROI. portfolio quality, sales page, product, all premium. no brainer investment honestly wish I found this sooner", date: "Feb 12, 2026", color: "#ef4444" },
  ];

  const valueStackItems = [
    { name: "Custom AI Influencer Persona & Digital Product", value: 997 },
    { name: "DFY High-Converting Branded Sales Page", value: 1497 },
    { name: "Pre-written Email Automation Sequences", value: 497 },
    { name: "AI Content Engine (Faceless Viral Clips)", value: 997 },
    { name: "Sales Tracking Dashboard & Analytics", value: 297 },
    { name: "BONUS: 60-Min Content Conversion Masterclass", value: 497 },
    { name: "BONUS: AI Content Prompts & Tools Vault", value: 397 },
    { name: "BONUS: Done-For-You VSL (Scripted, Recorded & Edited)", value: 497 },
    { name: "BONUS: Plug & Play Ad Creative Templates", value: 497 },
    { name: "BONUS: Proven Social Proof Library (Reviews & Testimonials)", value: 997 },
    { name: "BONUS: Sales Dashboard & Leaderboard Access", value: 297 },
    { name: "BONUS: Built-In Referral Commission Program", value: 1997 },
  ];

  const totalValue = valueStackItems.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="min-h-screen pb-16" style={{ background: '#051408', color: '#fff' }}>

      {/* ============ URGENCY BANNER ============ */}
      <div className="w-full py-2.5 px-4 text-center" style={{ background: 'linear-gradient(90deg, #051408 0%, #0d3514 30%, #1a5a20 50%, #0d3514 70%, #051408 100%)' }}>
        <p className="text-[13px] font-bold tracking-wider m-0" style={{ color: '#FFFFFF' }}>
          67% DISCOUNT AUTO APPLIED AT CHECKOUT - ENDS {(() => { const now = new Date(); const estOffset = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })); const tomorrow = new Date(estOffset); tomorrow.setDate(tomorrow.getDate() + 1); return tomorrow.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }).toUpperCase(); })()} @ 12AM EST 🔥
        </p>
      </div>

      {/* ============ HERO BANNER (GREEN BG) ============ */}
      <section className="relative overflow-hidden" style={{ background: 'linear-gradient(170deg, #051408 0%, #0a2810 40%, #0d3514 70%, #0a2810 100%)' }}>
        <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(ellipse at 30% 50%, rgba(147,227,96,0.15) 0%, transparent 70%), radial-gradient(ellipse at 70% 80%, rgba(147,227,96,0.1) 0%, transparent 60%)' }} />

        <div className="relative z-10 max-w-[1360px] mx-auto px-6 pt-10 pb-6">

          {/* Top Bar: Logo + Real Time Update + Contact */}
          <div className="flex items-center justify-between mb-4 md:mb-10">
            <div className="flex items-center">
              <img src={brandedLogo || `${import.meta.env.BASE_URL}logo.png`} alt="AI Influencers Portfolio" className="h-8 md:h-12 w-auto" />
            </div>

            <div className="hidden md:flex justify-center">
              <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full whitespace-nowrap" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(147,227,96,0.15)' }}>
                <span className="relative inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap" style={{ background: '#93E360', color: '#051408', boxShadow: '0 0 12px rgba(147,227,96,0.6), 0 0 24px rgba(147,227,96,0.3)' }}>
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#e74c3c' }} />
                    <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: '#e74c3c', boxShadow: '0 0 6px rgba(231,76,60,0.8)' }} />
                  </span>
                  LIVE
                </span>
                <span className="text-[13px] font-bold whitespace-nowrap" style={{ color: '#FFFFFF' }}>
                  ONLY <span style={{ color: '#e74c3c', textDecoration: 'line-through', textDecorationColor: '#e74c3c', textDecorationThickness: '2px' }}>6</span> 2 BUILDS LEFT FOR {new Date().toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 justify-end">
              <div className="hidden sm:block text-right">
                <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>Got Questions?</p>
                <p className="text-sm font-bold text-white">+1 (973) 813-4224</p>
              </div>
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(147,227,96,0.12)', border: '1px solid rgba(147,227,96,0.25)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#93E360" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
              </div>
            </div>
          </div>

          {/* Mobile-only LIVE badge */}
          <div className="flex md:hidden justify-center mb-5">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(147,227,96,0.15)' }}>
              <span className="relative inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: '#93E360', color: '#051408' }}>
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#e74c3c' }} />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: '#e74c3c' }} />
                </span>
                LIVE
              </span>
              <span className="text-[11px] font-bold" style={{ color: '#FFFFFF' }}>
                ONLY 2 BUILDS LEFT FOR {new Date().toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}
              </span>
            </div>
          </div>

          {/* Headline */}
          <div className="text-center mb-5 md:mb-8 max-w-[1100px] mx-auto">
            <h1 className="font-bold leading-[0.95] tracking-tight uppercase mb-3 md:mb-5 px-1" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(28px, 5.2vw, 60px)', color: '#FFFFFF' }}>
              Our Portfolio Of AI Influencers Makes{' '}
              <span style={{ color: '#93E360' }}>$57K/day.</span>{' '}
              We'll Build & Launch Your Own AI Influencer Business{' '}
              <span style={{ color: '#93E360' }}>100% Done For You</span>{' '}
              Within 24 Hours
            </h1>
            <p className="text-sm md:text-base leading-relaxed max-w-[960px] mx-auto" style={{ color: 'rgba(255,255,255,0.6)' }}>
              We handle all product creation, customer service, tech and pay you up to $1,500 per sale. This model is 100% faceless, no experience required and you just need to post AI content (takes 15 mins a day).
            </p>
          </div>

          {/* Two-Column: VSL Left + Product Card Right */}
          <div className="flex flex-col lg:grid lg:grid-cols-2 gap-6 lg:gap-8 items-start">

            {/* Left Column: VSL + Proof */}
            <div className="space-y-6 order-1 lg:order-1">
              {/* VSL Video */}
              <div
                className="rounded-2xl overflow-hidden w-full"
                style={{
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <WistiaVideo mediaId={videoId} />
              </div>

              {/* Proof Stats — REPLACE WITH YOUR OWN PROOF BANNER */}
              <PlaceholderImage
                label="REPLACE: Your proof banner image"
                hint="Suggested: a single horizontal screenshot or graphic showing your headline result (e.g. revenue, results, before/after). PNG/JPG, ~1200×400px."
                ratio="1200 / 400"
              />
              <DevOnlyWarningBanner />
            </div>

            {/* Right Column: Product Card */}
            <div className="flex flex-col order-2 lg:order-2">
              <div className="relative rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(147,227,96,0.15)' }}>
                {/* Trusted Badge */}
                <div className="flex items-center justify-center gap-2 py-2.5 flex-wrap" style={{ background: '#93E360' }}>
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#051408' }}>TRUSTED BY 12,000+</span>
                  <span className="flex -space-x-1.5">
                    {['avatar-f1.jpg','avatar-m1.jpg','avatar-f3.jpg','avatar-m4.jpg'].map((src, i) => (
                      <img key={i} src={`${import.meta.env.BASE_URL}${src}`} alt="" className="w-6 h-6 rounded-full object-cover" style={{ border: '2px solid #051408' }} />
                    ))}
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#051408' }}>DIGITAL ENTREPRENEURS{countryFlag ? ' FROM' : ''}</span>
                  {countryFlag && <span className="text-xl leading-none">{countryFlag}</span>}
                </div>

                {/* Product Mockup Area */}
                <div className="flex items-center justify-center" style={{ background: '#111', padding: '30px 0' }}>
                  <div className="text-center px-3">
                    <div className="w-full rounded-xl mx-auto overflow-hidden">
                      <img src={`${import.meta.env.BASE_URL}product-mockup.png`} alt="AI Influencer Portfolio System" className="w-full h-auto" />
                    </div>
                  </div>
                </div>

                {/* Price + CTA */}
                <div className="p-6 text-center" style={{ background: '#0a0a0a' }}>
                  <div className="flex items-center justify-center gap-3 mb-2">
                    <span className="text-sm font-semibold uppercase" style={{ color: 'rgba(255,255,255,0.5)' }}>ONLY</span>
                    <span className="text-6xl font-black text-white" style={{ fontFamily: 'var(--app-font-display)' }}>$27</span>
                    <span className="text-xl line-through" style={{ color: '#e74c3c', textDecorationColor: '#e74c3c' }}>$97</span>
                  </div>
                  <p className="text-sm mb-5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    Your complete DFY AI Influencer Portfolio - product, sales page, content & branding - built and delivered in 24 hours. Just $27. 7-day money-back guarantee.
                  </p>
                  <button
                    onClick={goToCheckout}
                    className="w-full py-4 px-6 text-base font-extrabold rounded-2xl uppercase tracking-wider cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:brightness-110 flex flex-col items-center justify-center"
                    style={{ background: '#93E360', color: '#051408', boxShadow: '0 4px 20px rgba(147,227,96,0.3)' }}
                  >
                    <span className="flex items-center gap-2">YES - BUILD MY AI PORTFOLIO <span className="text-xl">&#8594;</span></span>
                    <span className="block text-[10px] font-semibold mt-1 uppercase tracking-wider opacity-70">Done For You In 24 Hours, 7-Day Refund Guarantee</span>
                  </button>
                  <img src={`${import.meta.env.BASE_URL}checkout-secure.webp`} alt="Guaranteed safe & secure checkout - PayPal, Visa, Mastercard, Apple Pay, Google Pay" className="mt-4 w-full max-w-[340px] mx-auto" />
                </div>
              </div>
            </div>

          </div>

          {/* ============================================================
              AS SEEN ON Press Logos — PLACEHOLDER
              ⚠️  Press logos are NOT included in this template.
              You must supply your own. Drop your logo PNGs in /public
              (transparent background, white version) and re-add them
              to the array below.
              ============================================================ */}
          <div className="mt-10 pb-4 overflow-hidden">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-center mb-6" style={{ color: 'rgba(255,255,255,0.4)' }}>As Seen On:</p>
            <div className="relative">
              <div className="flex items-center justify-center gap-8 flex-wrap px-8">
                {[1,2,3,4,5,6,7,8].map((i) => (
                  <div
                    key={i}
                    className="h-10 w-32 rounded-md flex items-center justify-center text-[10px] font-bold uppercase tracking-wider"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.45)' }}
                  >
                    Your Logo {i}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-center mt-3 uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>
                Replace with your own press / partner / "as featured in" logos. Remove this section if you have none.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* ============ HOW THE INDUSTRY WORKS - LONG FORM ============ */}
      <section className="py-12 md:py-20 px-4 md:px-6" style={{ background: '#FFFFFF' }}>
        <div className="max-w-[1200px] mx-auto">

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-8 lg:gap-16 items-start">

            {/* Left: Long-form Copy */}
            <div className="lg:sticky lg:top-8">

              <h2 className="font-bold mb-6" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(24px, 3.5vw, 36px)', color: '#051408', lineHeight: 1.15 }}>
                AI is becoming a trillion-dollar industry. Influencers are driving a $30+ billion market. And now you can own a fully built AI influencer business in 24 hours.
              </h2>
              <p className="mb-6 text-xl" style={{ fontFamily: "'Permanent Marker', cursive", color: '#0d3514' }}>
                Combined? Makes the best business model ever to exist in human history.
              </p>

              <div className="space-y-5 text-[17px] leading-[1.85]" style={{ color: '#333' }}>
                <p>
                  Let me guess...
                </p>
                <p>
                  You wake up every morning already tense. Before the day even starts, your mind is filling with noise - messages, deadlines, money worries, and that low-grade guilt that you should be doing <em>more</em> with your life.
                </p>
                <p>
                  You move through your day on autopilot. Replying. Fixing. Attending. Pushing through.
                </p>
                <p>
                  And at the end of it all, you don't feel like you're <em>building</em> a life.
                </p>
                <p className="font-bold" style={{ color: '#051408' }}>
                  You feel like you're just <em>maintaining</em> one.
                </p>
                <p>
                  A life that's expensive to keep running, but emotionally unrewarding. You're not broke - but you're pinned down. Money comes in and disappears. And one disruption could throw everything off.
                </p>
                <p>
                  Sound familiar? You're not alone. And you're definitely not lazy.
                </p>
                <p>
                  You've probably already looked into dropshipping, affiliate marketing, freelancing, Amazon FBA, crypto, agencies, coaching, print on demand, faceless content...
                </p>
                <p className="font-bold" style={{ color: '#051408' }}>
                  And the result isn't clarity. It's cognitive soup.
                </p>
                <p>
                  Conflicting advice. Endless business models. Gurus promising everything. Complicated funnels. Expensive tools. Jargon. Strategies that sound good until you actually try to do them.
                </p>
                <p>
                  You're not just confused. You're <em>exhausted</em> by confusion.
                </p>
                <p>
                  And deep down, there's a sentence that sits in the background of your life like a low electrical hum:
                </p>
                <p className="font-bold text-lg" style={{ color: '#051408' }}>
                  "I cannot keep doing this forever."
                </p>

                <p>
                  That's exactly why AI Influencer Portfolios exists.
                </p>

                <p>
                  Not another course. Not another framework. Not another guru telling you to "figure it out."
                </p>

                <p className="font-bold" style={{ color: '#051408' }}>This is a done-for-you business - built around you in 24 hours - that eliminates every excuse that's been holding you back:</p>

                <div className="space-y-3">
                  {[
                    "No showing your face or building a 'personal brand'",
                    "No chasing clients or draining 1:1 work",
                    "No filming, editing, or daily content creation",
                    "No team needed - not at the start, not at scale",
                    "No tech skills or experience required",
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="text-red-500 text-lg mt-0.5">✕</span>
                      <p className="font-medium" style={{ color: '#051408' }}>{item}</p>
                    </div>
                  ))}
                </div>

                <p className="font-bold" style={{ color: '#051408' }}>Here's how it actually works:</p>

                <p>
                  You sign up. Within 24 hours, our team builds your entire AI Influencer Portfolio from scratch - custom AI influencer, branded sales page, email automations, AI content engine, everything.
                </p>
                <p>
                  You spend 15 minutes a day promoting with AI-generated faceless content. No filming. No editing. No guesswork.
                </p>
                <p>
                  People discover your influencer, click through, and 1-2% purchase your digital product at 100% profit margin ($17, $27, or $47+). Algorithms push your content to more people. The system compounds.
                </p>
                <p className="font-bold" style={{ color: '#051408' }}>Rinse, repeat & scale.</p>

                <p>And the best part?</p>

                <div className="space-y-3">
                  {[
                    'We handle all customer service and product delivery',
                    'We handle all the operational headaches - zero burden on you',
                    'You keep 100% of every sale, every upsell, every penny',
                    'Scale into multiple niches (we personally run 26+ accounts)',
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5" style={{ background: '#93E360' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#051408" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      </span>
                      <p className="font-medium" style={{ color: '#051408' }}>{item}</p>
                    </div>
                  ))}
                </div>

                <p>
                  While everyone else is burning out trying to be the next social media star, drowning in client work, or second-guessing themselves for the hundredth time...
                </p>
                <p className="font-bold" style={{ color: '#051408' }}>
                  You'll be quietly building systematic wealth behind the scenes.
                </p>

                <p>
                  Look, I'll be straight with you. This isn't some magical get-rich-quick scheme. But the numbers don't lie:
                </p>

                <div className="space-y-3">
                  {[
                    'Bella made her first sale within 24 hours of launching (with zero experience)',
                    'Muna generated $6K without ads in just 32 days',
                    'We recently did 3,008 sales in a week with $280K+ in revenue',
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="text-lg mt-0.5">👉</span>
                      <p className="font-medium" style={{ color: '#051408' }}>{item}</p>
                    </div>
                  ))}
                </div>

                <p>All without building personal brands, grinding on social media, managing difficult clients, or trading time for money.</p>

                <p className="font-bold" style={{ color: '#051408' }}>So here's the real question:</p>
                <p>
                  Five years from now, do you want to be in the same place - stuck, stretched thin, watching other people build the life you want?
                </p>
                <p>
                  Or do you want to look back at today as the moment everything changed?
                </p>
                <p>
                  This isn't just another online business model. It's the simplest, most leveraged path to building real income online - without sacrificing your privacy, your mental health, or your freedom.
                </p>
                <p className="font-bold" style={{ color: '#051408' }}>The only question left is: are you ready?</p>
              </div>

            </div>

            {/* ============================================================
                Right: Proof Screenshots — PLACEHOLDER
                ⚠️  Stripe / Hyros / dashboard screenshots are NOT included
                in this template. You must supply your own. Drop your
                screenshots in /public as proof-1.png through proof-11.png
                (or whatever names you like) and replace the array below.
                Use real, honest, your-own-account screenshots only.
                ============================================================ */}
            <div>
              <div className="py-3 text-center rounded-t-xl mb-2" style={{ background: '#93E360' }}>
                <p className="text-sm font-black uppercase" style={{ color: '#051408' }}>"PROVE TO ME THIS MAKES MONEY"</p>
              </div>
              <div className="space-y-3">
                {[
                  { label: 'YOUR Stripe / payment dashboard screenshot', rotate: '-1.5deg' },
                  { label: 'YOUR revenue or sales total screenshot',     rotate: '1deg' },
                  { label: 'YOUR daily / weekly results screenshot',     rotate: '-0.5deg' },
                  { label: 'YOUR ad account / ROAS screenshot',          rotate: '1.5deg' },
                  { label: 'YOUR client results screenshot',             rotate: '-1deg' },
                  { label: 'YOUR transaction count screenshot',          rotate: '0.5deg' },
                  { label: 'YOUR testimonial / DM screenshot',           rotate: '-0.8deg' },
                  { label: 'YOUR proof screenshot 8',                    rotate: '1.2deg' },
                ].map((p, i) => (
                  <div
                    key={i}
                    className="w-full rounded-lg shadow-xl relative flex flex-col items-center justify-center text-center px-4 py-12"
                    style={{
                      transform: `rotate(${p.rotate})`,
                      zIndex: i + 1,
                      background: 'rgba(5,20,8,0.04)',
                      border: '2px dashed rgba(5,20,8,0.25)',
                      color: '#051408',
                    }}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-60 mb-1">Replace with</span>
                    <span className="text-sm font-bold uppercase">{p.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] mt-3 uppercase tracking-wider opacity-60 text-center" style={{ color: '#051408' }}>
                Use ONLY your own real account screenshots. Do not borrow or fabricate proof.
              </p>
            </div>

          </div>

        </div>
      </section>

      {/* ============ HOW IT WORKS - PARALLAX SCROLL ============ */}
      <section className="relative overflow-hidden" style={{ background: '#051408' }}>
        <div className="text-center pt-20 pb-6 px-6">
          <span className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-[11px] font-bold uppercase tracking-widest mb-6" style={{ background: 'rgba(147,227,96,0.1)', border: '1px solid rgba(147,227,96,0.2)', color: '#93E360' }}>
            How It Works
          </span>
          <h2 className="font-bold uppercase mb-4" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(28px, 4.5vw, 48px)', color: '#FFFFFF', lineHeight: 1.1 }}>
            4 Steps To Your <span style={{ color: '#93E360' }}>AI Profit Machine</span>
          </h2>
          <p className="text-base max-w-[550px] mx-auto" style={{ color: 'rgba(255,255,255,0.5)' }}>
            We build everything. You just promote. Here's exactly what happens when you get started today.
          </p>
        </div>

        <HiwParallaxSteps goToCheckout={goToCheckout} countryFlag={countryFlag} />
      </section>

      {/* ============ INCOME CALCULATOR ============ */}
      <IncomeCalculator goToCheckout={goToCheckout} countryFlag={countryFlag} />

      {/* ============ SOCIAL PROOF / TESTIMONIALS WITH GLOBE ============ */}
      <section className="py-12 md:py-16 px-4 md:px-6" style={{ background: '#FFFFFF' }}>
        <div className="max-w-[1200px] mx-auto">

          <div className="text-center mb-6 md:mb-10">
            <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full mb-6" style={{ background: '#93E360', color: '#051408' }}>
              <span className="text-sm font-bold">⭐ EXCELLENT BASED ON 100'S OF REVIEWS</span>
            </div>
            <h2 className="font-bold uppercase" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(28px, 4vw, 48px)', color: '#051408' }}>
              OVER 12,000+ PEOPLE FROM 47 COUNTRIES <span className="relative inline-block"><span className="relative z-10" style={{ color: '#93E360' }}>HELPED</span><span className="absolute bottom-[0.05em] left-[-4px] right-[-4px] z-0 rounded-md" style={{ height: '0.32em', background: 'rgba(147,227,96,0.2)' }}></span></span>
            </h2>

            <div className="mt-6 overflow-hidden relative" style={{ maskImage: 'linear-gradient(to right, transparent, black 5%, black 95%, transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 5%, black 95%, transparent)' }}>
              <div className="flex gap-3 animate-marquee-flags whitespace-nowrap">
                {[...Array(2)].map((_, setIdx) => (
                  <div key={setIdx} className="flex gap-3 shrink-0">
                    {['🇺🇸','🇬🇧','🇨🇦','🇦🇺','🇩🇪','🇫🇷','🇪🇸','🇮🇹','🇧🇷','🇲🇽','🇯🇵','🇰🇷','🇮🇳','🇳🇬','🇿🇦','🇦🇪','🇸🇦','🇵🇭','🇮🇩','🇹🇭','🇻🇳','🇲🇾','🇸🇬','🇳🇿','🇮🇪','🇳🇱','🇧🇪','🇨🇭','🇦🇹','🇸🇪','🇳🇴','🇩🇰','🇫🇮','🇵🇱','🇵🇹','🇬🇷','🇹🇷','🇪🇬','🇰🇪','🇬🇭','🇨🇴','🇦🇷','🇨🇱','🇵🇪','🇵🇰','🇧🇩','🇷🇴'].map((flag, i) => (
                      <span key={`${setIdx}-${i}`} className="text-2xl">{flag}</span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4">
            {testimonials.map((t, i) => (
              <motion.div
                key={i}
                className="break-inside-avoid mb-4"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-5%" }}
                transition={{ duration: 0.4, delay: i < 8 ? i * 0.05 : 0 }}
              >
                <TestimonialCard t={t} />
              </motion.div>
            ))}
          </div>

          <div className="text-center mt-12">
            <CTAButton onClick={goToCheckout} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-4 sm:gap-6 mt-8 max-w-[600px] mx-auto">
            <GuaranteeBadge variant="light" />
            <TrustedBanner countryFlag={countryFlag} variant="green" />
          </div>

        </div>
      </section>

      {/* ============ MILESTONES & LEADERBOARD SECTION ============ */}
      <section className="py-12 md:py-20 px-4 md:px-6" style={{ background: '#051408' }}>
        <div className="max-w-[1100px] mx-auto">

          <p className="text-sm font-bold uppercase tracking-widest mb-4 text-center" style={{ color: '#93E360' }}>
            🎁 Unlock Real Rewards
          </p>
          <h2 className="font-bold uppercase text-center mb-3" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(28px, 4.5vw, 44px)', color: '#FFFFFF', lineHeight: 1.1 }}>
            HIT MILESTONES. WIN PRIZES.
          </h2>
          <p className="text-center text-base mb-12 max-w-[650px] mx-auto" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Our members track their revenue inside the portal. When you hit a milestone, you unlock exclusive rewards that get bigger as you grow.
          </p>

          {/* Milestone Cards - 3 columns top, 2 columns bottom */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {[
              { target: '$1,000', label: 'STARTER CLUB', icon: '🎁', color: '#93E360', reward: 'We send you an exclusive gift pack in the post' },
              { target: '$10,000', label: 'MOMENTUM BUILDER', icon: '🔥', color: '#f59e0b', reward: 'Exclusive merch drop + shoutout on our socials' },
              { target: '$100,000', label: 'SIX-FIGURE CLUB', icon: '🏆', color: '#a855f7', reward: '1-on-1 private coaching call with the team + custom plaque' },
            ].map((m) => (
              <div key={m.target} className="rounded-xl p-6 text-center" style={{ background: '#111613', border: `1px solid ${m.color}20` }}>
                <span className="text-3xl">{m.icon}</span>
                <div className="text-3xl font-black mt-2" style={{ color: m.color, fontFamily: "'Oswald', sans-serif" }}>
                  {m.target}
                </div>
                <div className="text-[10px] font-bold tracking-[0.2em] mt-1" style={{ color: m.color }}>{m.label}</div>
                <p className="text-sm mt-3" style={{ color: 'rgba(255,255,255,0.5)' }}>{m.reward}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-14">
            {[
              { target: '$1,000,000', label: "MILLIONAIRE'S CIRCLE", icon: '👑', color: '#eab308', reward: 'Engraved plaque + trophy presented at our next live event' },
              { target: '$10,000,000', label: 'EMPIRE BUILDER', icon: '💎', color: '#ef4444', reward: 'Custom trophy plaque + permanent spot on our Wall of Legends + lifetime VIP access' },
            ].map((m) => (
              <div key={m.target} className="rounded-xl p-6 text-center" style={{ background: '#111613', border: `1px solid ${m.color}20` }}>
                <span className="text-3xl">{m.icon}</span>
                <div className="text-3xl font-black mt-2" style={{ color: m.color, fontFamily: "'Oswald', sans-serif" }}>
                  {m.target}
                </div>
                <div className="text-[10px] font-bold tracking-[0.2em] mt-1" style={{ color: m.color }}>{m.label}</div>
                <p className="text-sm mt-3" style={{ color: 'rgba(255,255,255,0.5)' }}>{m.reward}</p>
              </div>
            ))}
          </div>

          {/* Live Leaderboard Preview */}
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
                    const ms = getSalesMilestone(u.totalRevenue);
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
                        <div className="hidden md:block text-center text-base">{COUNTRY_FLAGS[u.countryCode] || '\u{1F3F3}\u{FE0F}'}</div>
                        <div className="text-right font-bold text-xs md:text-sm" style={{ color: '#93E360' }}>{formatRevShort(u.totalRevenue)}</div>
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

      {/* ============ WHAT'S INCLUDED LONG-FORM SECTION ============ */}
      <section className="py-12 md:py-20 px-4 md:px-6" style={{ background: '#FFFFFF' }}>
        <div className="max-w-[820px] mx-auto rounded-2xl p-5 md:p-14" style={{ background: '#FFFFFF', border: '1px solid #E5E3E3', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>

          <h2 className="font-bold uppercase mb-10 text-center" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(28px, 4.5vw, 44px)', color: '#051408', lineHeight: 1.1 }}>
            HERE'S EXACTLY WHAT WE BUILD FOR YOU (IN 24 HOURS)
          </h2>

          <div className="space-y-6 text-[17px] leading-[1.8]" style={{ color: '#051408' }}>
            <p><strong>Most people who want to start an online business get stuck in the same loop:</strong></p>

            <p>Get inspired. Research intensely. Open too many tabs. Save videos and posts. Maybe buy something. Feel the pressure to "do it right."</p>

            <p className="font-bold inline-block" style={{ background: 'rgba(255,190,0,0.3)', padding: '2px 6px' }}>Then freeze. Delay. Lose momentum. Feel bad about themselves.</p>

            <p>And the worst part? They start thinking it's a character flaw.</p>

            <p>"Why do I keep doing this?" "Why can't I just commit?" "Maybe I'm not built for business."</p>

            <p>But here's the truth nobody tells you:</p>

            <p className="font-bold inline-block" style={{ background: 'rgba(255,190,0,0.3)', padding: '2px 6px' }}>The problem was never you. It was friction.</p>

            <p>Every other business model asks you to figure out the hard parts yourself - the product, the tech, the copy, the funnel, the content, the customer service...</p>

            <p><em>We eliminate all of it. Here's what you get when you join today:</em></p>

            <div className="space-y-5 my-8 pl-2">
              {[
                'A custom AI influencer built around a proven niche that 100K+ people search for monthly',
                'A fully built, high-converting sales page designed to turn strangers into buyers',
                'Pre-written email sequences that nurture and convert on autopilot',
                'An AI content engine that generates faceless viral clips - no filming, no editing',
                'Complete sales tracking dashboard so you can see every dollar in real time',
                'All customer service and product delivery handled by our team - not you',
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded shrink-0 flex items-center justify-center mt-0.5" style={{ background: '#93E360' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#051408" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </span>
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <p><strong>We're not handing you a course and wishing you luck.</strong></p>

            <p>We're not asking you to "figure it out" on your own.</p>

            <p>After building AI influencer businesses that collectively generated millions in revenue, we realized something powerful:</p>

            <p><strong>More information is never the answer. Done-for-you execution is.</strong></p>

            <p>The people who win online aren't the ones who watch the most videos or buy the most courses. They're the ones who get a working system in their hands <em>fast</em> - and start promoting it.</p>

            <p>That's exactly what this is.</p>

            <p>Within 24 hours of joining, your entire AI Influencer Portfolio is live and ready to sell. All you do is promote - which takes about 15 minutes a day using the AI-generated content we provide.</p>

            <p><strong>That's how Bella made her first sale in under 24 hours with zero experience. That's how Muna hit $6K in 32 days without a single ad. And that's how we did $280K+ in a single week.</strong></p>
          </div>

          {/* CTA Button */}
          <div className="mt-10">
            <CTAButton onClick={goToCheckout} />
          </div>

          {/* Proof Icons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-4 sm:gap-6 mt-8 max-w-[600px] mx-auto">
            <GuaranteeBadge />

            <TrustedBanner countryFlag={countryFlag} />
          </div>

        </div>
      </section>

      {/* ============ HERE'S EXACTLY WHAT YOU'LL GET ============ */}
      <section className="py-12 md:py-20 px-4 md:px-6" style={{ background: 'linear-gradient(170deg, #051408 0%, #0a2810 40%, #0d3514 70%, #0a2810 100%)' }}>
        <div className="max-w-[1100px] mx-auto">

          <p className="text-sm font-bold uppercase tracking-widest mb-4 text-center" style={{ color: '#93E360' }}>Everything Done For You</p>
          <h2 className="font-bold uppercase text-center mb-4" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(28px, 4vw, 42px)', color: '#FFFFFF', lineHeight: 1.1 }}>
            YOUR COMPLETE DFY AI INFLUENCER BUSINESS - DELIVERED IN 24 HOURS
          </h2>
          <p className="text-center text-base mb-12 max-w-[650px] mx-auto" style={{ color: 'rgba(255,255,255,0.5)' }}>
            We don't give you a course and wish you luck. We build your entire business from scratch and hand it to you ready to go.
          </p>

          {/* What's Included - 2 col, 4 rows - card style with visual */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-16">
            {[
              {
                title: 'Custom AI Influencer Persona',
                desc: 'A unique AI influencer built around a proven, high-demand niche - designed to attract buyers from day one.',
                visual: (
                  <div className="flex items-center justify-center gap-3">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(147,227,96,0.15)', border: '1px solid rgba(147,227,96,0.3)' }}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#93E360" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                    </div>
                    <div className="space-y-1">
                      <div className="h-2 w-24 rounded-full" style={{ background: 'rgba(147,227,96,0.2)' }} />
                      <div className="h-2 w-16 rounded-full" style={{ background: 'rgba(147,227,96,0.12)' }} />
                      <div className="h-2 w-20 rounded-full" style={{ background: 'rgba(147,227,96,0.08)' }} />
                    </div>
                  </div>
                ),
              },
              {
                title: 'High-Converting Sales Page',
                desc: 'A branded, fully written sales page with hooks, proof, offer stack, and CTA - built to convert cold traffic into paying customers.',
                visual: (
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(147,227,96,0.2)' }}>
                    <div className="px-3 py-1.5 flex items-center gap-1.5" style={{ background: 'rgba(147,227,96,0.08)' }}>
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#ff5f57' }} />
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#febc2e' }} />
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#28c840' }} />
                    </div>
                    <div className="p-3 space-y-2">
                      <div className="h-2 w-full rounded-full" style={{ background: 'rgba(147,227,96,0.2)' }} />
                      <div className="h-2 w-3/4 rounded-full" style={{ background: 'rgba(147,227,96,0.12)' }} />
                      <div className="h-6 w-full rounded-md mt-2" style={{ background: '#93E360' }} />
                    </div>
                  </div>
                ),
              },
              {
                title: 'AI Content Engine',
                desc: 'Generates faceless viral clips without filming or editing. Just post and let AI do the heavy lifting for organic reach.',
                visual: (
                  <div className="grid grid-cols-3 gap-2">
                    {[1,2,3].map(n => (
                      <div key={n} className="rounded-lg flex items-center justify-center" style={{ background: 'rgba(147,227,96,0.08)', border: '1px solid rgba(147,227,96,0.15)', aspectRatio: '9/16' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#93E360" strokeWidth="1.5"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                      </div>
                    ))}
                  </div>
                ),
              },
              {
                title: 'Pre-Written Email Sequences',
                desc: 'Automated email flows that nurture leads and convert them on autopilot - no copywriting skills needed.',
                visual: (
                  <div className="space-y-2">
                    {['Welcome Series', 'Nurture Flow', 'Sale Closer'].map(t => (
                      <div key={t} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: 'rgba(147,227,96,0.06)', border: '1px solid rgba(147,227,96,0.12)' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#93E360" strokeWidth="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                        <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{t}</span>
                        <svg className="ml-auto" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#93E360" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                      </div>
                    ))}
                  </div>
                ),
              },
              {
                title: 'Sales Tracking Dashboard',
                desc: 'See every dollar earned, every customer, every metric in real time. Complete clarity over your business performance.',
                visual: (
                  <div className="rounded-xl p-3" style={{ background: 'rgba(147,227,96,0.06)', border: '1px solid rgba(147,227,96,0.12)' }}>
                    <div className="flex items-end gap-1.5 justify-center h-16">
                      {[40, 55, 35, 70, 60, 85, 75].map((h, i) => (
                        <div key={i} className="w-4 rounded-t" style={{ height: `${h}%`, background: i === 5 ? '#93E360' : 'rgba(147,227,96,0.2)' }} />
                      ))}
                    </div>
                    <p className="text-[10px] text-center mt-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Revenue Trend</p>
                  </div>
                ),
              },
              {
                title: 'Full Customer Service & Delivery',
                desc: 'We handle all customer support, product delivery, and refunds. You focus on promoting - we handle the rest.',
                visual: (
                  <div className="flex items-center justify-center">
                    <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: 'rgba(147,227,96,0.1)', border: '2px solid rgba(147,227,96,0.25)' }}>
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#93E360" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                    </div>
                  </div>
                ),
              },
              {
                title: 'Delivered In 24 Hours',
                desc: 'Your complete business is built, tested, and delivered within 24 hours of purchase. Ready to generate revenue immediately.',
                visual: (
                  <div className="flex items-center justify-center">
                    <div className="relative w-20 h-20 rounded-full flex items-center justify-center" style={{ background: 'rgba(147,227,96,0.1)', border: '2px solid rgba(147,227,96,0.25)' }}>
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#93E360" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                    </div>
                  </div>
                ),
              },
              {
                title: 'Branded Content & Copy',
                desc: 'All branding, product descriptions, social bios, and marketing copy written and ready to use across every platform.',
                visual: (
                  <div className="space-y-2">
                    <div className="h-2.5 w-full rounded-full" style={{ background: 'rgba(147,227,96,0.15)' }} />
                    <div className="h-2.5 w-5/6 rounded-full" style={{ background: 'rgba(147,227,96,0.1)' }} />
                    <div className="h-2.5 w-2/3 rounded-full" style={{ background: 'rgba(147,227,96,0.08)' }} />
                    <div className="flex gap-2 mt-3">
                      {['Bio', 'Captions', 'Hooks'].map(t => (
                        <span key={t} className="text-[9px] font-bold px-2 py-1 rounded-md" style={{ background: 'rgba(147,227,96,0.1)', color: '#93E360', border: '1px solid rgba(147,227,96,0.2)' }}>{t}</span>
                      ))}
                    </div>
                  </div>
                ),
              },
            ].map((item, i) => (
              <div key={i} className="rounded-2xl overflow-hidden flex flex-col" style={{ background: '#111613', border: '1px solid rgba(147,227,96,0.1)' }}>
                <div className="p-6 pb-4">
                  <h4 className="text-lg font-bold text-white mb-2" style={{ fontFamily: 'var(--app-font-display)' }}>{item.title}</h4>
                  <p className="text-[13px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>{item.desc}</p>
                </div>
                <div className="p-5 pt-2 mt-auto">
                  <div className="rounded-xl p-5" style={{ background: 'rgba(147,227,96,0.04)', border: '1px solid rgba(147,227,96,0.08)' }}>
                    {item.visual}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Bonuses Headline */}
          <h3 className="font-bold uppercase text-center mb-8" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(22px, 3vw, 32px)', color: '#FFFFFF', lineHeight: 1.2 }}>
            BUT THAT'S NOT ALL, YOU ALSO GET...
          </h3>

          {/* Bonuses - 2 col, 3 rows - same card style */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-14">
            {[
              {
                title: '60-Min Content Conversion Masterclass',
                value: '$497',
                desc: 'Step-by-step video training on creating AI content that converts followers into paying customers.',
                visual: (
                  <div className="flex items-center justify-center">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(147,227,96,0.15)', border: '1px solid rgba(147,227,96,0.3)' }}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#93E360" strokeWidth="1.5"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                    </div>
                  </div>
                ),
              },
              {
                title: 'AI Content Prompts & Tools Vault',
                value: '$397',
                desc: 'Every prompt, script, and template needed to create daily content with your AI influencer - no guesswork.',
                visual: (
                  <div className="grid grid-cols-2 gap-2">
                    {['Hooks', 'Captions', 'Scripts', 'CTAs'].map(t => (
                      <div key={t} className="rounded-lg px-3 py-2 text-center" style={{ background: 'rgba(147,227,96,0.08)', border: '1px solid rgba(147,227,96,0.15)' }}>
                        <span className="text-[10px] font-bold" style={{ color: '#93E360' }}>{t}</span>
                      </div>
                    ))}
                  </div>
                ),
              },
              {
                title: 'Done-For-You VSL (Scripted, Recorded & Edited)',
                value: '$497',
                desc: 'A complete video sales letter featuring your custom AI influencer - professionally scripted, recorded, and edited for you.',
                visual: (
                  <div className="flex items-center justify-center">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(147,227,96,0.15)', border: '1px solid rgba(147,227,96,0.3)' }}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#93E360" strokeWidth="1.5"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                    </div>
                  </div>
                ),
              },
              {
                title: 'Plug & Play Ad Creative Templates',
                value: '$497',
                desc: 'Battle-tested ad templates ready to deploy. Just swap in your influencer details and start running traffic.',
                visual: (
                  <div className="grid grid-cols-3 gap-2">
                    {[1,2,3].map(n => (
                      <div key={n} className="rounded-lg" style={{ background: 'rgba(147,227,96,0.08)', border: '1px solid rgba(147,227,96,0.15)', aspectRatio: '1/1' }}>
                        <div className="flex items-center justify-center h-full">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#93E360" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                        </div>
                      </div>
                    ))}
                  </div>
                ),
              },
              {
                title: 'Proven Social Proof Library',
                value: '$997',
                desc: 'Leverage thousands of real reviews and testimonials on your sales pages, content, and marketing - no starting from scratch.',
                visual: (
                  <div className="flex items-center justify-center -space-x-3">
                    {[1,2,3,4,5].map(n => (
                      <div key={n} className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(147,227,96,0.12)', border: '2px solid #111613' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#93E360" strokeWidth="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                      </div>
                    ))}
                  </div>
                ),
              },
              {
                title: 'Sales Dashboard & Leaderboard',
                value: '$297',
                desc: 'Gamified leaderboard and real-time tracking so you see every metric and stay motivated to grow.',
                visual: (
                  <div className="space-y-1.5">
                    {[{ name: '#1', w: '100%' }, { name: '#2', w: '80%' }, { name: '#3', w: '65%' }].map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[10px] font-bold w-5" style={{ color: '#93E360' }}>{r.name}</span>
                        <div className="h-3 rounded-full" style={{ width: r.w, background: i === 0 ? '#93E360' : 'rgba(147,227,96,0.2)' }} />
                      </div>
                    ))}
                  </div>
                ),
              },
            ].map((bonus, i) => (
              <div key={i} className="rounded-2xl overflow-hidden flex flex-col" style={{ background: '#111613', border: '1px solid rgba(147,227,96,0.1)' }}>
                <div className="p-6 pb-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#93E360' }}>Bonus - Value {bonus.value}</p>
                  <h4 className="text-lg font-bold text-white mb-2" style={{ fontFamily: 'var(--app-font-display)' }}>{bonus.title}</h4>
                  <p className="text-[13px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>{bonus.desc}</p>
                </div>
                <div className="p-5 pt-2 mt-auto">
                  <div className="rounded-xl p-5" style={{ background: 'rgba(147,227,96,0.04)', border: '1px solid rgba(147,227,96,0.08)' }}>
                    {bonus.visual}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl overflow-hidden mb-14" style={{ background: '#111613', border: '2px solid rgba(147,227,96,0.3)' }}>
            <div className="p-6 md:p-8 flex flex-col md:flex-row gap-6 items-center">
              <div className="flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#93E360' }}>Bonus - Value $1,997</p>
                <h4 className="text-xl md:text-2xl font-bold text-white mb-3" style={{ fontFamily: 'var(--app-font-display)' }}>Built-In Referral Commission Program</h4>
                <p className="text-[14px] leading-relaxed mb-4" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  Earn up to <span className="font-bold text-white">$1,500 per sale</span> when your referrals purchase our high-ticket backend offers. Plus earn <span className="font-bold text-white">$250-$1,500/month recurring</span> from content and ad package referrals - without doing any extra work. You refer. We close. You get paid.
                </p>
              </div>
              <div className="w-full md:w-[280px] shrink-0 space-y-3">
                <div className="rounded-xl px-5 py-4 text-center" style={{ background: 'rgba(147,227,96,0.08)', border: '1px solid rgba(147,227,96,0.2)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Per-Sale Commission</p>
                  <p className="text-2xl font-black" style={{ fontFamily: 'var(--app-font-display)', color: '#93E360' }}>UP TO $1,500</p>
                </div>
                <div className="rounded-xl px-5 py-4 text-center" style={{ background: 'rgba(147,227,96,0.08)', border: '1px solid rgba(147,227,96,0.2)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Monthly Recurring</p>
                  <p className="text-2xl font-black" style={{ fontFamily: 'var(--app-font-display)', color: '#93E360' }}>$250-$1,500/MO</p>
                </div>
              </div>
            </div>
          </div>

          {/* Pricing Breakdown */}
          <div className="text-center mb-8 mt-4">
            <p className="text-sm uppercase tracking-widest font-bold mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Total Value: <span style={{ color: 'rgba(255,255,255,0.6)' }}>${totalValue.toLocaleString()}</span>
            </p>
            <p className="text-base font-bold mb-2">
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>Normal Price: </span>
              <span className="line-through" style={{ color: '#e74c3c' }}>$97</span>
            </p>
            <p className="font-black uppercase tracking-wide" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(32px, 5vw, 52px)', lineHeight: 1.1 }}>
              <span style={{ color: '#FFFFFF' }}>Today's Price:</span> <span style={{ color: '#93E360' }}>$27</span>
            </p>
          </div>

          {/* CTA Button */}
          <div className="text-center">
            <CTAButton onClick={goToCheckout} />
          </div>

          {/* Proof Icons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-4 sm:gap-6 mt-8 max-w-[600px] mx-auto">
            <GuaranteeBadge variant="dark" />
            <TrustedBanner countryFlag={countryFlag} variant="dark" />
          </div>

        </div>
      </section>

      {/* ============ US VS THEM COMPARISON ============ */}
      <section className="py-12 md:py-20 px-4 md:px-6" style={{ background: '#FFFFFF' }}>
        <div className="max-w-[900px] mx-auto">
          <div className="text-center mb-12">
            <span className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-[11px] font-bold uppercase tracking-widest mb-6" style={{ background: 'rgba(5,20,8,0.05)', border: '1px solid rgba(5,20,8,0.1)', color: '#051408' }}>
              Why This Is Different
            </span>
            <h2 className="font-bold uppercase mb-4" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(28px, 4.5vw, 44px)', color: '#051408', lineHeight: 1.1 }}>
              Us vs <span style={{ color: '#e74c3c' }}>Everyone Else</span>
            </h2>
          </div>

          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid #E5E3E3', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
            <div className="grid grid-cols-3">
              <div className="p-2 md:p-4" style={{ background: '#FAFAFA' }} />
              <div className="p-2 md:p-4 text-center font-bold text-[10px] md:text-sm uppercase tracking-wider" style={{ background: 'rgba(231,76,60,0.06)', color: '#e74c3c', borderBottom: '2px solid rgba(231,76,60,0.3)' }}>Other Models</div>
              <div className="p-2 md:p-4 text-center font-bold text-[10px] md:text-sm uppercase tracking-wider" style={{ background: 'rgba(147,227,96,0.1)', color: '#0a6e1a', borderBottom: '2px solid #93E360' }}>AI Influencer Portfolios</div>
            </div>
            {[
              { label: 'Setup time', them: 'Weeks or months', us: 'Done in 24 hours' },
              { label: 'Product creation', them: 'You figure it out', us: 'We give you ours (proven)' },
              { label: 'Sales page', them: 'Build your own', us: 'Built for you' },
              { label: 'Content creation', them: 'Film & edit yourself', us: 'AI generates it all' },
              { label: 'Customer service', them: 'Handle it yourself', us: 'We handle everything' },
              { label: 'Product delivery', them: 'You fulfill orders', us: 'Fully automated by us' },
              { label: 'Tech & systems', them: 'Learn it all yourself', us: 'Done for you' },
              { label: 'Revenue split', them: 'Platform takes 30-50%', us: 'You keep 100%' },
              { label: 'Experience needed', them: 'Months of learning', us: 'Zero experience' },
              { label: 'Daily time required', them: '4-8 hours minimum', us: '15 mins per day' },
              { label: 'Proven results', them: 'No guarantees', us: '$57K/day and growing' },
            ].map((row, i) => (
              <div key={i} className="grid grid-cols-3" style={{ borderTop: '1px solid #F0EFEF' }}>
                <div className="p-2 md:p-3.5 text-[11px] md:text-[13px] font-medium" style={{ color: '#051408', background: '#FAFAFA' }}>{row.label}</div>
                <div className="p-2 md:p-3.5 text-[11px] md:text-[13px] text-center flex items-center justify-center gap-1" style={{ color: '#999' }}>
                  <span style={{ color: '#e74c3c' }}>✕</span> <span className="hidden md:inline">{row.them}</span><span className="md:hidden">{row.them.split(' ').slice(0, 3).join(' ')}</span>
                </div>
                <div className="p-2 md:p-3.5 text-[11px] md:text-[13px] text-center font-semibold flex items-center justify-center gap-1" style={{ color: '#0a6e1a', background: 'rgba(147,227,96,0.04)' }}>
                  <span style={{ color: '#93E360' }}>✓</span> {row.us}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-14 max-w-[750px] mx-auto">
            <div className="rounded-2xl p-8" style={{ background: '#FAFAFA', border: '1px solid #E5E3E3' }}>
              <p className="text-lg leading-relaxed mb-4" style={{ color: '#676F68' }}>
                <strong style={{ color: '#051408' }}>They</strong> make you watch 40 hours of theory, create your own product, build your own funnel, figure out traffic, handle customer support, and pray it works.
              </p>
              <p className="text-lg leading-relaxed mb-4" style={{ color: '#676F68' }}>
                <strong style={{ color: '#0a6e1a' }}>We</strong> give you full 100% ownership. We give you our proven products (literally the one you are on right now). We handle all customer service, product delivery and tech. All you need to do is promote via AI content (which we give you as well) and get paid.
              </p>
              <div className="mt-6 pt-6" style={{ borderTop: '1px solid #E5E3E3' }}>
                <p className="text-xl font-bold mb-2" style={{ fontFamily: "'Permanent Marker', cursive", color: '#0a6e1a' }}>
                  This is not a course.
                </p>
                <p className="text-base leading-relaxed" style={{ color: '#676F68' }}>
                  This is a done-for-you business handover with products already making us <strong style={{ color: '#051408' }}>$57,000 a day</strong> (beyond proven).
                </p>
              </div>
            </div>
          </div>

          <div className="text-center mt-12">
            <CTAButton onClick={goToCheckout} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-4 sm:gap-6 mt-8 max-w-[600px] mx-auto">
            <GuaranteeBadge variant="light" />
            <TrustedBanner countryFlag={countryFlag} variant="green" />
          </div>
        </div>
      </section>

      {/* ============ HOW DOES IT WORK ============ */}
      <section className="py-12 md:py-20 px-4 md:px-6" style={{ background: 'linear-gradient(170deg, #051408 0%, #0a2810 40%, #0d3514 70%, #0a2810 100%)' }}>
        <div className="max-w-[820px] mx-auto text-center">

          <h2 className="font-bold uppercase mb-4" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(28px, 4.5vw, 44px)', color: '#FFFFFF', lineHeight: 1.1, fontStyle: 'italic' }}>
            STILL SKEPTICAL? WATCH HOW THE ENTIRE SYSTEM WORKS
          </h2>
          <p className="text-lg mb-10" style={{ color: 'rgba(255,255,255,0.6)' }}>
            See a complete walkthrough of a real AI Influencer Portfolio - from setup to daily sales.
          </p>

          {/* Wistia Video */}
          <div
            className="rounded-2xl overflow-hidden w-full mx-auto mb-10"
            style={{
              border: '1px solid rgba(255,255,255,0.08)',
              maxWidth: '700px',
            }}
          >
            <WistiaVideo mediaId="0lwww3bf2v" />
          </div>

          {/* CTA Button */}
          <CTAButton onClick={goToCheckout} />

          {/* Proof Icons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-4 sm:gap-6 mt-8 max-w-[600px] mx-auto">
            <GuaranteeBadge variant="dark" />

            <TrustedBanner countryFlag={countryFlag} variant="dark" />
          </div>

        </div>
      </section>

      {/* ============ "BUT WILL THIS WORK FOR ME?" OBJECTION CRUSHER ============ */}
      <section className="py-12 md:py-20 px-4 md:px-6" style={{ background: '#FFFFFF' }}>
        <div className="max-w-[1000px] mx-auto">

          <h2 className="font-bold uppercase text-center mb-12" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(28px, 4.5vw, 44px)', color: '#051408', lineHeight: 1.1 }}>
            "BUT WILL THIS ACTUALLY WORK FOR ME?"
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start mb-14">

            {/* Left: Objection Crushers */}
            <div className="space-y-8">

              <div>
                <div className="flex items-start gap-3 mb-3">
                  <span className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-sm font-bold mt-0.5" style={{ background: 'rgba(147,227,96,0.15)', color: '#0a6e1a', border: '1.5px solid rgba(147,227,96,0.4)' }}>?</span>
                  <h3 className="text-lg font-bold" style={{ fontFamily: 'var(--app-font-display)', color: '#051408' }}>"I don't have any experience or tech skills..."</h3>
                </div>
                <p className="text-[15px] leading-[1.8] pl-10" style={{ color: '#676F68' }}>
                  Perfect - that's exactly who this is built for. We build everything for you. The product, the sales page, the emails, the content engine. You don't need to know how to code, design, or write copy. Bella had zero experience and made her first sale in 24 hours.
                </p>
              </div>

              <div>
                <div className="flex items-start gap-3 mb-3">
                  <span className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-sm font-bold mt-0.5" style={{ background: 'rgba(147,227,96,0.15)', color: '#0a6e1a', border: '1.5px solid rgba(147,227,96,0.4)' }}>?</span>
                  <h3 className="text-lg font-bold" style={{ fontFamily: 'var(--app-font-display)', color: '#051408' }}>"I don't have time - I'm already stretched thin..."</h3>
                </div>
                <p className="text-[15px] leading-[1.8] pl-10" style={{ color: '#676F68' }}>
                  This takes 15 minutes a day. That's it. The AI content engine does the heavy lifting. You're not building a second job - you're building an asset that works while you sleep. If you can scroll social media for 15 minutes, you can run this.
                </p>
              </div>

              <div>
                <div className="flex items-start gap-3 mb-3">
                  <span className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-sm font-bold mt-0.5" style={{ background: 'rgba(147,227,96,0.15)', color: '#0a6e1a', border: '1.5px solid rgba(147,227,96,0.4)' }}>?</span>
                  <h3 className="text-lg font-bold" style={{ fontFamily: 'var(--app-font-display)', color: '#051408' }}>"I've been burned before by online business programs..."</h3>
                </div>
                <p className="text-[15px] leading-[1.8] pl-10" style={{ color: '#676F68' }}>
                  We get it. You've seen the fake screenshots, the rented Lambos, the empty promises. That's why we don't sell a course. We build you a working business. You can see the proof on this page - real revenue dashboards, real student results, real reviews. Plus, you're covered by our 7-day money-back guarantee.
                </p>
              </div>

            </div>

            {/* Right: Visual Proof Card */}
            <div className="flex items-center justify-center">
              <img src={`${import.meta.env.BASE_URL}product-mockup-large.png`} alt="Your DFY AI Portfolio" className="w-full h-auto" />
            </div>

          </div>

          {/* Bottom Closing Copy */}
          <div className="text-center mb-10 max-w-[700px] mx-auto">
            <p className="text-lg font-bold leading-relaxed mb-4" style={{ color: '#051408' }}>
              Whether you're a burnt-out employee, a side-hustler who's tried everything, a parent who needs more flexibility, or someone who just knows they're capable of more...
            </p>
            <p className="text-lg font-bold leading-relaxed" style={{ color: '#051408' }}>
              This is the simplest, most hands-off path to building real online income - and we build it all for you.
            </p>
          </div>

          {/* CTA Button */}
          <div className="text-center">
            <CTAButton onClick={goToCheckout} />
          </div>

          {/* Proof Icons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-4 sm:gap-6 mt-8 max-w-[600px] mx-auto">
            <GuaranteeBadge variant="light" />
            <TrustedBanner countryFlag={countryFlag} variant="green" />
          </div>

        </div>
      </section>

      {/* ============ WHO IS THE FOUNDER ============ */}
      <section className="py-12 md:py-20 px-4 md:px-6" style={{ background: '#FFFFFF' }}>
        <div className="max-w-[900px] mx-auto">

          {/* Top Badge */}
          <div className="flex justify-center mb-6">
            <span className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-sm font-bold uppercase tracking-wider" style={{ background: '#93E360', color: '#051408' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#051408" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
              EXCELLENT BASED ON DOZENS OF REVIEWS
            </span>
          </div>

          {/* Headline */}
          <h2 className="text-center font-bold uppercase mb-12" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(28px, 4.5vw, 44px)', color: '#051408', lineHeight: 1.1 }}>
            WHO IS BEHIND AI INFLUENCER PORTFOLIOS?
          </h2>

          {/* Bio Copy - Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start mb-16">
            <div className="flex items-start justify-center">
              {/* REPLACE: Your founder photo or photo collage. Suggested: 480×600px PNG/JPG. */}
              <div
                className="w-full max-w-[480px] flex flex-col items-center justify-center text-center px-6"
                style={{
                  aspectRatio: '4 / 5',
                  background: 'rgba(5,20,8,0.04)',
                  border: '2px dashed rgba(5,20,8,0.25)',
                  borderRadius: '12px',
                  color: '#051408',
                }}
              >
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-60 mb-2">Replace with</span>
                <span className="text-base font-bold uppercase">Your founder photo or collage</span>
                <span className="text-xs mt-2 opacity-60">~480 × 600px · PNG or JPG</span>
              </div>
            </div>

            <div className="space-y-5">
              <p className="text-[15px] leading-[1.8]" style={{ color: '#333' }}>
                I got fed up of building a personal brand so <strong style={{ color: '#051408' }}>I deleted myself from the internet and created a faceless model.</strong>
              </p>
              <p className="text-[15px] leading-[1.8]" style={{ color: '#333' }}>
                I didn't come from money. I didn't have connections. I didn't have a degree in marketing.
              </p>
              <p className="text-[15px] leading-[1.8]" style={{ color: '#333' }}>
                What I did have was <strong style={{ color: '#051408' }}>nearly a decade in the online business trenches</strong> - failing at business models that demanded my face, my time, and my sanity before finding the one that actually worked.
              </p>
              <p className="text-[15px] leading-[1.8]" style={{ color: '#333' }}>
                Over the years, I've personally <strong style={{ color: '#051408' }}>generated millions of dollars online</strong> and helped clients collectively bring in <strong style={{ color: '#051408' }}>millions more in revenue</strong>. Not with complicated funnels or expensive agencies - but with <strong style={{ color: '#051408' }}>simple, systematic AI-driven businesses</strong> that run themselves.
              </p>
              <p className="text-[15px] leading-[1.8]" style={{ color: '#333' }}>
                For the past 5 years, I've been sharing everything behind the scenes on YouTube, helping <strong style={{ color: '#051408' }}>thousands of people</strong> build their first online income stream.
              </p>
              <p className="text-[15px] leading-[1.8]" style={{ color: '#333' }}>
                But I kept seeing the same problem over and over: people would buy courses, watch videos, get inspired... <strong style={{ color: '#051408' }}>and still never launch.</strong>
              </p>
              <p className="text-[15px] leading-[1.8]" style={{ color: '#333' }}>
                Not because they were lazy. Because there was too much friction.
              </p>
              <p className="text-[15px] leading-[1.8]" style={{ color: '#333' }}>
                <strong style={{ color: '#051408' }}>That's why I created AI Influencer Portfolios - a done-for-you system that eliminates every barrier between you and your first sale.</strong>
              </p>
              <div className="pt-4">
                <p style={{
                  fontFamily: "'Caveat', cursive",
                  fontSize: '48px',
                  fontWeight: 700,
                  color: '#93E360',
                  lineHeight: 1,
                  transform: 'rotate(-2deg)',
                  letterSpacing: '1px',
                  textShadow: '1px 1px 0px rgba(147,227,96,0.15)',
                  position: 'relative',
                }}>
                  James L
                  <span style={{
                    display: 'block',
                    height: '2px',
                    background: 'linear-gradient(90deg, transparent 0%, #93E360 15%, #93E360 70%, transparent 100%)',
                    marginTop: '-2px',
                    opacity: 0.4,
                    transform: 'rotate(1deg) scaleX(1.1)',
                  }} />
                </p>
                <p className="text-sm font-semibold uppercase tracking-widest mt-1" style={{ color: '#555' }}>Creator</p>
              </div>
            </div>
          </div>

          {/* White Card: "AND NOW I'M GIVING IT ALL TO YOU..." */}
          <div className="rounded-2xl p-8 md:p-12" style={{ background: '#FFFFFF', border: '1px solid #E5E3E3', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>

            <h3 className="text-center font-bold uppercase mb-8" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(22px, 3.5vw, 34px)', color: '#051408', lineHeight: 1.15, letterSpacing: '-0.01em' }}>
              HERE'S WHAT I WANT YOU TO UNDERSTAND...
            </h3>

            <div className="space-y-5 mb-8">
              <p className="text-[15px] leading-[1.8]" style={{ color: '#333' }}>
                You're not struggling because you lack motivation. You're not failing because there's something wrong with you.
              </p>
              <p className="text-[15px] leading-[1.8]" style={{ color: '#333' }}>
                You're stuck because every other business model asks you to do the hard parts yourself - and by the time you figure it out, your energy is gone.
              </p>
              <p className="text-[15px] leading-[1.8]" style={{ color: '#333' }}>
                Imagine this instead:
              </p>
              <p className="text-[15px] leading-[1.8]" style={{ color: '#333' }}>
                <strong style={{ color: '#051408' }}>Tomorrow morning, you wake up and check your phone. You see sales notifications from people you've never met, buying products you didn't have to create, from a business you didn't have to build.</strong>
              </p>
              <p className="text-[15px] leading-[1.8]" style={{ color: '#333' }}>
                That low-grade tension in your chest? It starts to loosen. Because for the first time, you're not just dreaming about change - you're watching it happen.
              </p>
            </div>

            <p className="text-[15px] leading-[1.8] mb-5" style={{ color: '#333' }}>That's what AI Influencer Portfolios gives you:</p>

            <div className="space-y-4 mb-8">
              {[
                'A real business generating real income - built for you in 24 hours',
                'Complete freedom from the 9-to-5 grind, client work, and content creation',
                'The breathing room to finally build the life you actually want',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded flex items-center justify-center shrink-0" style={{ background: '#93E360' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#051408" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </span>
                  <p className="text-[15px] font-semibold" style={{ color: '#051408' }}>{item}</p>
                </div>
              ))}
            </div>

            <p className="text-[15px] leading-[1.8] mb-8" style={{ color: '#333' }}>
              No courses to watch. No tech to figure out. No content to film. We handle all of it.
            </p>

            {/* CTA Button */}
            <CTAButton onClick={goToCheckout} />

            <div className="flex justify-center mt-8">
              <TrustedBanner countryFlag={countryFlag} />
            </div>

          </div>

        </div>
      </section>

      {/* ============ VALUE STACK / WHAT'S INCLUDED ============ */}
      <section className="py-12 md:py-16 px-4 md:px-6">
        <div className="max-w-[700px] mx-auto">
          <p className="text-center text-sm font-bold uppercase tracking-widest mb-3" style={{ color: '#93E360' }}>
            LIMITED TIME - 67% OFF TODAY ONLY
          </p>
          <h2 className="text-center font-bold uppercase mb-4" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(24px, 4vw, 36px)' }}>
            Everything You're Getting Today For A Fraction Of What It's Worth...
          </h2>
          <p className="text-center text-[15px] leading-[1.7] mb-10" style={{ color: '#676F68' }}>
            We've spent years and millions of dollars perfecting this system. Today, you get the entire done-for-you AI Influencer Portfolio - plus all bonuses - for less than a dinner out.
          </p>

          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(147,227,96,0.15)', background: 'rgba(147,227,96,0.02)' }}>
            {valueStackItems.map((item, i) => (
              <div key={i} className="flex items-center justify-between px-3 md:px-6 py-3 md:py-4" style={{ borderBottom: i < valueStackItems.length - 1 ? '1px solid rgba(147,227,96,0.06)' : 'none' }}>
                <div className="flex items-center gap-2 md:gap-3 min-w-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#93E360" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
                  <span className="font-medium text-xs md:text-sm">{item.name}</span>
                </div>
                <span className="text-xs md:text-sm font-bold shrink-0 ml-2" style={{ color: '#676F68' }}>${item.value}</span>
              </div>
            ))}

            <div className="px-6 py-5 flex items-center justify-between" style={{ background: 'rgba(147,227,96,0.08)', borderTop: '2px solid rgba(147,227,96,0.2)' }}>
              <span className="font-bold text-base">Total Value:</span>
              <span className="font-bold text-lg line-through" style={{ color: '#676F68' }}>${totalValue.toLocaleString()}</span>
            </div>
          </div>

          <div className="text-center mt-8">
            <p className="text-sm uppercase tracking-wider mb-2" style={{ color: '#676F68' }}>Today you get everything for just</p>
            <div className="flex items-center justify-center gap-3 mb-6">
              <span className="font-bold" style={{ color: '#93E360', fontSize: '56px', fontFamily: 'var(--app-font-display)' }}>$27</span>
              <span className="line-through text-2xl" style={{ color: '#e74c3c', textDecorationColor: '#e74c3c' }}>$97</span>
            </div>
            <CTAButton onClick={goToCheckout} />
            <img src={`${import.meta.env.BASE_URL}checkout-secure.webp`} alt="Guaranteed safe & secure checkout - PayPal, Visa, Mastercard, Apple Pay, Google Pay" className="mt-4 w-full max-w-[340px] mx-auto" />
          </div>
        </div>
      </section>

      {/* ============ PROOF THIS WORKS ============ */}
      <section className="py-12 md:py-20 px-4 md:px-6" style={{ background: '#FFFFFF' }}>
        <div className="max-w-[820px] mx-auto text-center">

          <h2 className="font-bold uppercase mb-6" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(24px, 4vw, 40px)', color: '#051408', lineHeight: 1.15 }}>
            WANT PROOF THIS WILL WORK FOR YOU?
          </h2>

          <div className="max-w-[620px] mx-auto mb-10 space-y-4 text-[15px] leading-[1.8]" style={{ color: '#051408' }}>
            <p>
              You're on the <span className="font-bold">exact same type of page</span>, reading the <span className="font-bold">exact same type of offer</span>, looking at the <span className="font-bold">exact same product</span> that you will be selling.
            </p>
            <p>
              The only difference? <span style={{ color: '#93E360', fontWeight: 700 }}>Next time it will be YOUR customer on a page like this, about to pay YOU - not us.</span>
            </p>
            <p>
              You keep <span className="font-bold">100% of the profits</span>. We build everything. You just promote.
            </p>
          </div>

          {/* DFY Bundle Mockup */}
          <div className="mx-auto mb-10" style={{ maxWidth: '800px' }}>
            <img src={`${import.meta.env.BASE_URL}product-mockup.png`} alt="Your DFY Bundle" className="w-full h-auto" />
          </div>

          {/* CTA Button */}
          <CTAButton onClick={goToCheckout} />

          {/* Proof Icons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-4 sm:gap-6 mt-8 max-w-[600px] mx-auto">
            <GuaranteeBadge />

            <TrustedBanner countryFlag={countryFlag} />
          </div>

        </div>
      </section>

      {/* ============ GUARANTEE ============ */}
      <section className="py-12 md:py-20 px-4 md:px-6" style={{ background: 'linear-gradient(170deg, #051408 0%, #0a2810 40%, #0d3514 70%, #0a2810 100%)' }}>
        <div className="max-w-[820px] mx-auto">

          {/* Badge Icon */}
          <div className="flex justify-center mb-8">
            <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: 'rgba(147,227,96,0.1)', border: '3px solid #93E360' }}>
              <div className="text-center leading-none">
                <span className="text-[7px] font-black text-white block uppercase">Money Back</span>
                <span className="text-lg font-black block" style={{ color: '#93E360' }}>7 DAYS</span>
                <span className="text-[7px] font-black text-white block uppercase">Guarantee</span>
              </div>
            </div>
          </div>

          <h2 className="font-bold uppercase text-center mb-8" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(24px, 4vw, 40px)', color: '#FFFFFF', lineHeight: 1.15 }}>
            YOU'RE COMPLETELY PROTECTED - ZERO RISK
          </h2>

          <div className="space-y-5 mb-10">
            <p className="text-[16px] leading-[1.8] font-semibold italic" style={{ color: 'rgba(255,255,255,0.85)' }}>
              "I know what you're thinking. You've been burned before. You've bought things online that promised the world and delivered nothing. I get it."
            </p>
            <p className="text-[15px] leading-[1.8]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              That's why I want to make this completely risk-free for you.
            </p>
            <p className="text-[15px] leading-[1.8]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Even though it's only $27 - you worked for that money. It matters. And I respect that.
            </p>
            <p className="text-[15px] leading-[1.8]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              So here's the deal:
            </p>
            <p className="text-[15px] leading-[1.8]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Join today. We'll build your complete AI Influencer Portfolio within 24 hours. Review everything. Test it out. See the quality of what we deliver.
            </p>
            <p className="text-[15px] leading-[1.8]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              If for any reason you're not happy - the system isn't what you expected, the quality doesn't meet your standards, or you just change your mind - send one email to hello@aiinfluencerportfolios.com within 7 days.
            </p>
            <p className="text-[15px] leading-[1.8] font-bold" style={{ color: '#93E360' }}>
              You get every penny back. No questions. No hoops. No awkward conversations.
            </p>
            <p className="text-[15px] leading-[1.8]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              I can offer this because I know what we deliver. 300+ people have joined before you and you can read their unfiltered reviews on this page. I'm not worried about refunds - I'm worried about you missing out.
            </p>
          </div>

          {/* CTA Button */}
          <CTAButton onClick={goToCheckout} />

          <div className="flex justify-center mt-8">
            <TrustedBanner countryFlag={countryFlag} variant="dark" />
          </div>

        </div>
      </section>

      {/* ============ FAQ ============ */}
      <section className="py-12 md:py-20 px-4 md:px-6" style={{ background: '#FFFFFF' }}>
        <div className="max-w-[820px] mx-auto">

          <h2 className="text-center font-bold uppercase mb-4" style={{ fontFamily: 'var(--app-font-display)', fontSize: 'clamp(28px, 4.5vw, 40px)', color: '#051408', lineHeight: 1.1 }}>
            FREQUENTLY ASKED QUESTIONS
          </h2>
          <p className="text-center text-[15px] mb-10" style={{ color: '#676F68' }}>
            Need help email us: <a href="mailto:hello@aiinfluencerportfolios.com" style={{ color: '#93E360', textDecoration: 'none', fontWeight: 600 }}>hello@aiinfluencerportfolios.com</a>
          </p>

          <div className="space-y-3 mb-10">
            {[
              { q: 'I want this - what exactly am I getting?', a: 'You\'re getting a complete done-for-you AI Influencer Portfolio business built for you within 24 hours. This includes a custom AI influencer, branded sales page, email automations, AI content engine for faceless viral clips, sales tracking dashboard, and all customer service handled by our team. Plus 7 bonuses: 60-Min Content Conversion Masterclass, AI Content Prompts & Tools Vault, Done-For-You VSL (Scripted, Recorded & Edited), Plug & Play Ad Creative Templates, Proven Social Proof Library (thousands of reviews and testimonials you can use), Sales Dashboard & Leaderboard Access, and our Built-In Referral Commission Program where you can earn up to $1,500 per sale and $250-$1,500/month recurring.' },
              { q: 'How fast will I see results?', a: 'Your entire business is built and ready to sell within 24 hours. How fast you see sales depends on how consistently you promote. Bella made her first sale in under 24 hours. Muna hit $6K in 32 days. Most members see their first sales within the first week of actively promoting.' },
              { q: 'How much does it cost?', a: 'Just $27 today (67% off the regular price). This is a one-time payment. No subscriptions, no hidden fees, no upsell required. You keep 100% of every sale your AI Influencer Portfolio generates.' },
              { q: 'Do I need any experience or tech skills?', a: 'Absolutely not. We build everything for you. You don\'t need to know how to code, design, write copy, or create content. If you can post on social media, you can run this. Our 60-Min Quick Start Masterclass walks you through everything step by step.' },
              { q: 'How much time does this take per day?', a: 'About 15 minutes. Your only job is promoting your AI Influencer Portfolio using the AI-generated content we provide. No filming, no editing, no customer service - we handle all of that.' },
              { q: 'How does the referral commission program work?', a: 'When you bring in a customer and they purchase any of our backend high-ticket offers, you earn up to $1,500 per sale - we handle the selling, you just refer. On top of that, if they sign up for our recurring content and ad management packages, you earn $250 to $1,500 every month they stay on. You don\'t have to do any extra work - it\'s built right into your portfolio.' },
              { q: 'How is this different from courses or other programs?', a: 'Most programs sell you information and leave you to figure it out. We build you a working business. Within 24 hours, you have a live product, a sales page, email sequences, and an AI content engine - all done for you. You don\'t learn how to build it. You receive it built.' },
              { q: 'What if it doesn\'t work for me?', a: 'You\'re covered by our 7-day money-back guarantee. If you\'re not happy for any reason, email hello@aiinfluencerportfolios.com and we\'ll refund every penny. No questions, no hoops. We can offer this because we know what we deliver - 300+ people have joined before you.' },
            ].map((item, i) => (
              <details key={i} className="group rounded-xl overflow-hidden" style={{ background: '#93E360' }}>
                <summary className="flex items-center justify-between px-6 py-4 cursor-pointer list-none">
                  <span className="text-[15px] font-semibold" style={{ color: '#051408' }}>{item.q}</span>
                  <svg className="w-5 h-5 shrink-0 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="#051408" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                </summary>
                <div className="px-6 pb-4">
                  <p className="text-[14px] leading-[1.7]" style={{ color: 'rgba(5,20,8,0.75)' }}>{item.a}</p>
                </div>
              </details>
            ))}
          </div>

          {/* CTA Button */}
          <CTAButton onClick={goToCheckout} />

          {/* Proof Icons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-4 sm:gap-6 mt-8 max-w-[600px] mx-auto">
            <GuaranteeBadge />

            <TrustedBanner countryFlag={countryFlag} />
          </div>

        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="py-12 px-6 text-center" style={{ background: 'linear-gradient(170deg, #051408 0%, #0a2810 40%, #0d3514 70%, #0a2810 100%)' }}>
        <div className="max-w-[820px] mx-auto">

          {/* Logo */}
          <img src={brandedLogo || `${import.meta.env.BASE_URL}logo.png`} alt="AI Influencers Portfolio" className="h-12 w-auto mx-auto mb-8" />

          {/* Disclaimers */}
          <div className="space-y-4 text-[11px] leading-[1.7]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            <p>
              This website is not part of the Facebook website or Facebook Inc. Additionally, this site is NOT endorsed by Facebook in any way. FACEBOOK is a trademark of FACEBOOK, Inc.
            </p>
            <p>
              The results shared on this page are not typical and your results will vary. These testimonials are not intended to represent or guarantee that everyone will achieve the same results. Individual results depend on your effort, commitment, and follow-through. Any business endeavor carries inherent risks and there are no guarantees of success.
            </p>
            <p>
              We offer a 7-day money-back guarantee from the date of purchase. If you're not satisfied with your AI Influencer Portfolio for any reason within 7 days, contact us for a full refund.
            </p>
            <p>
              The testimonials and examples shown are real results from actual clients. However, these results are not typical and your results may vary. Past performance does not guarantee future results.
            </p>
          </div>

          <p className="text-[11px] mt-6" style={{ color: 'rgba(255,255,255,0.25)' }}>
            © {new Date().getFullYear()} AI Influencer Portfolios. All rights reserved.
          </p>

        </div>
      </footer>

      {/* ============ SALES POP NOTIFICATION ============ */}
      <SalesPopNotification />

      {/* ============ STICKY BOTTOM BAR ============ */}
      <div className="fixed bottom-0 left-0 right-0 py-2 md:py-3 px-3 md:px-6 flex items-center justify-center md:justify-between z-50" style={{ background: 'rgba(5,20,8,0.95)', borderTop: '1px solid rgba(147,227,96,0.1)', backdropFilter: 'blur(12px)' }}>
        <p className="hidden md:block text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Starting at <strong style={{ color: '#93E360' }}>$27</strong> - one-time payment for lifetime access
        </p>
        <button
          onClick={goToCheckout}
          className="w-full md:w-auto px-8 py-3 text-sm font-extrabold uppercase tracking-wider rounded-2xl cursor-pointer transition-all duration-200 hover:scale-[1.03] hover:brightness-110"
          style={{ background: '#93E360', color: '#051408', boxShadow: '0 4px 20px rgba(147,227,96,0.3)' }}
        >
          YES - BUILD MY AI PORTFOLIO &#8594;
        </button>
      </div>

    </div>
  );
}
