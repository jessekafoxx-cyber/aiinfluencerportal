import { useLocation } from 'wouter';
import { useState, useEffect, useRef } from 'react';
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

function ProLogo({ width = 152 }: { width?: number }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo-pro.png`}
      alt="AI Influencer Portfolio Pro"
      style={{ width, height: 'auto' }}
    />
  );
}

const PRODUCTS = [
  { name: '5 More Custom AI Influencer Builds', value: '$2,485' },
  { name: '47 Done-For-You Digital Products', value: '$4,700' },
  { name: 'One-Click Install 6-Step Sales Funnel (Per Product)', value: '$2,350' },
  { name: '2x Proven $500K+/Month Product Blueprints', value: '$1,997' },
  { name: 'Done-For-You Ad Creatives & Copy', value: '$1,497' },
  { name: 'Content Research & Strategy Docs', value: '$997' },
  { name: 'Sales Page Copy for All 47 Products', value: '$2,350' },
  { name: 'Email Sequences for Every Offer', value: '$1,410' },
  { name: 'Set Up Each Product in Under 60 Seconds', value: 'Included' },
];

const BONUSES = [
  { name: 'Scaling Playbook (How We Hit $500K/Month)', value: '$997' },
  { name: 'Multi-Niche Expansion Strategy Guide', value: '$499' },
  { name: 'Priority Build Queue for Your 5 New Influencers', value: '$499' },
];

const DIGITAL_PRODUCTS = [
  { title: "AI Info Products", img: "product-13.png" },
  { title: "ChatGPT 6-Figure System", img: "product-23.png" },
  { title: "Content Funnel System", img: "product-06.png" },
  { title: "Social Growth Engine", img: "product-24.png" },
  { title: "Targeted Traffic System", img: "product-27.png" },
  { title: "AI Search Optimization", img: "product-47.webp" },
  { title: "Systeme.io Business", img: "product-25.webp" },
  { title: "AI Workflow System", img: "product-10.webp" },
  { title: "High Trust Content", img: "product-11.webp" },
  { title: "Membership Framework", img: "product-22.webp" },
  { title: "Business Operations", img: "product-15.webp" },
  { title: "YouTube Ads Scaling", img: "product-28.webp" },
  { title: "AI Profit Mastery", img: "product-04.webp" },
  { title: "E-Commerce Margins", img: "product-18.webp" },
  { title: "Crypto Starter Guide", img: "product-20.webp" },
  { title: "Weekend Marketing Plan", img: "product-14.webp" },
  { title: "Digital Product Business", img: "product-16.webp" },
  { title: "Skool Community System", img: "product-26.webp" },
  { title: "ADHD Focus Formula", img: "product-32.png" },
  { title: "Google Ads Local Clients", img: "product-44.png" },
  { title: "Digital Product Funnel", img: "product-09.png" },
  { title: "Beat The Banks", img: "product-05.png" },
  { title: "ChatGPT Daily Income", img: "product-17.webp" },
  { title: "CapCut Video Editing", img: "product-35.webp" },
  { title: "Ultra Running Blueprint", img: "product-01.webp" },
  { title: "Fitness Transformation", img: "product-02.webp" },
  { title: "ADHD Productivity", img: "product-03.webp" },
  { title: "Etsy Digital Products", img: "product-19.webp" },
  { title: "AI Resume Service", img: "product-21.webp" },
  { title: "AI Blogging System", img: "product-33.webp" },
  { title: "Mental Health Starter", img: "product-37.webp" },
  { title: "Course VA Starter", img: "product-38.webp" },
  { title: "Canva Template Studio", img: "product-43.webp" },
  { title: "Time & Energy Reclaim", img: "product-45.webp" },
  { title: "Smart Money Systems", img: "product-40.png" },
  { title: "Anger Management System", img: "product-34.webp" },
  { title: "Faceless Income System", img: "product-39.webp" },
  { title: "Investment Portfolio", img: "product-12.webp" },
  { title: "Funnel Builder System", img: "product-08.webp" },
  { title: "Affiliate Marketing", img: "product-46.png" },
  { title: "AI Content Operations", img: "product-30.webp" },
  { title: "Hyrox Training Plan", img: "product-29.webp" },
  { title: "Hypnotherapy Method", img: "product-41.webp" },
  { title: "Google Search Ads", img: "product-31.webp" },
  { title: "Wedding Planning DFY", img: "product-07.webp" },
  { title: "MicroSaaS Blueprint", img: "product-36.webp" },
  { title: "LinkedIn Lead Machine", img: "product-42.webp" },
];

export default function Upsell3() {
  const [, setLocation] = useLocation();
  const [processing, setProcessing] = useState(false);
  const [chargeError, setChargeError] = useState('');

  const handleUpgrade = async () => {
    setProcessing(true);
    setChargeError('');
    const result = await chargeUpsell('upsell-3');
    setProcessing(false);
    if (result.success) {
      setLocation('/thank-you');
    } else {
      setChargeError(result.error || 'Payment failed. Please try again.');
    }
  };
  const handleSkip = () => setLocation('/thank-you');

  return (
    <div className="w-full min-h-screen" style={{ background: '#051408' }}>

      {/* ============ HERO SECTION ============ */}
      <section
        className="w-full relative overflow-hidden"
        style={{ background: 'linear-gradient(180deg, #051408 0%, #0d3514 50%, #0a2810 100%)' }}
      >
        {/* Nav */}
        <nav className="w-full max-w-[1100px] mx-auto px-4 py-4 flex items-center justify-between">
          <ProLogo width={140} />
          <div
            className="relative rounded-full overflow-hidden"
            style={{
              width: 220,
              height: 40,
              background: 'rgba(255,255,255,0.06)',
              border: '2px solid rgba(255,255,255,0.1)',
            }}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full overflow-hidden"
              style={{ width: '85%' }}
            >
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(90deg, #e53e3e, #ef4444, #f56565)',
                  backgroundSize: '200% 100%',
                }}
              />
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255,255,255,0.12) 8px, rgba(255,255,255,0.12) 16px)',
                  backgroundSize: '22.6px 40px',
                  animation: 'stripesMove 0.8s linear infinite',
                }}
              />
            </div>
            <span
              className="relative z-10 flex items-center justify-center w-full h-full font-black text-white"
              style={{ fontSize: 'clamp(13px, 1.5vw, 15px)', fontFamily: 'var(--app-font-display)', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
            >
              Step 2 of 3
            </span>
          </div>
        </nav>

        {/* Floating AI Avatar Photos with branch lines */}
        <div className="hidden md:block absolute inset-0 pointer-events-none z-0">
          {/* SVG branch/vine lines */}
          <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
            {/* Left branch lines */}
            <line x1="3%" y1="20%" x2="14%" y2="34%" stroke="rgba(147,227,96,0.15)" strokeWidth="1.5" />
            <line x1="14%" y1="34%" x2="8%" y2="52%" stroke="rgba(147,227,96,0.12)" strokeWidth="1" />
            <line x1="8%" y1="52%" x2="5%" y2="68%" stroke="rgba(147,227,96,0.1)" strokeWidth="1" />
            <circle cx="14%" cy="34%" r="3" fill="rgba(147,227,96,0.2)" />
            <circle cx="8%" cy="52%" r="2.5" fill="rgba(147,227,96,0.15)" />
            {/* Right branch lines */}
            <line x1="88%" y1="18%" x2="93%" y2="30%" stroke="rgba(147,227,96,0.15)" strokeWidth="1.5" />
            <line x1="93%" y1="30%" x2="87%" y2="46%" stroke="rgba(147,227,96,0.12)" strokeWidth="1" />
            <line x1="87%" y1="46%" x2="92%" y2="62%" stroke="rgba(147,227,96,0.1)" strokeWidth="1" />
            <circle cx="93%" cy="30%" r="3" fill="rgba(147,227,96,0.2)" />
            <circle cx="87%" cy="46%" r="2.5" fill="rgba(147,227,96,0.15)" />
          </svg>

          {[
            { img: 'ai-avatar-1.png', top: '14%', left: '2%', size: 72, delay: '0s' },
            { img: 'ai-avatar-2.png', top: '32%', left: '11%', size: 64, delay: '1.5s' },
            { img: 'ai-avatar-3.png', top: '26%', right: '3%', size: 68, delay: '0.8s' },
            { img: 'ai-avatar-4.png', top: '44%', right: '8%', size: 60, delay: '2s' },
            { img: 'ai-avatar-5.png', top: '56%', left: '4%', size: 56, delay: '0.5s' },
            { img: 'ai-avatar-6.png', top: '60%', right: '4%', size: 52, delay: '1.2s' },
          ].map((av, i) => (
            <div
              key={i}
              className="absolute rounded-full overflow-hidden"
              style={{
                top: av.top,
                left: (av as { left?: string }).left,
                right: (av as { right?: string }).right,
                width: av.size,
                height: av.size,
                border: '2px solid rgba(147,227,96,0.4)',
                boxShadow: '0 0 24px rgba(147,227,96,0.25), 0 0 8px rgba(0,0,0,0.3)',
                animation: `avatarFloat 4s ease-in-out infinite`,
                animationDelay: av.delay,
              }}
            >
              <img
                src={`${import.meta.env.BASE_URL}${av.img}`}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
          ))}
        </div>

        {/* Hero Content */}
        <div className="max-w-[1000px] mx-auto px-4 pt-8 md:pt-14 pb-4 text-left md:text-center relative z-10">

          {/* Subtitle Pill */}
          <span
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-white mb-8"
            style={{
              fontSize: 'clamp(16px, 2.2vw, 20px)',
              fontFamily: 'var(--app-font-script, Caveat, cursive)',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <span>✋</span> Final Special Offer
          </span>

          {/* Main Headline */}
          <h1
            className="text-white font-black leading-[1.05] mb-6"
            style={{ fontSize: 'clamp(30px, 4.8vw, 50px)', fontFamily: 'var(--app-font-display)' }}
          >
            WE'LL BUILD YOU 5 MORE{' '}
            <span style={{ color: '#93E360', fontFamily: 'var(--app-font-script, Caveat, cursive)', fontWeight: 400, fontSize: '1.1em' }}>UNIQUE AI</span>{' '}
            INFLUENCERS{' '}
            <span style={{ color: '#93E360', fontFamily: 'var(--app-font-script, Caveat, cursive)', fontWeight: 400, fontSize: '1.1em' }}>&</span>{' '}
            47 MORE DIGITAL PRODUCTS TO SCALE YOUR PORTFOLIO!
          </h1>

          {/* Subheadline - hidden on mobile */}
          <p
            className="hidden md:block text-white/70 mb-8 max-w-[820px] mx-auto"
            style={{ fontSize: 'clamp(14px, 1.6vw, 16px)', lineHeight: 1.6 }}
          >
            More AI influencers means 5X more content and sales. You'll also get 47 1-click install done for you digital products that can be launched in under 60 seconds all 100% done for you 🔥
          </p>

          {/* Benefit Pills - hidden on mobile */}
          <div className="hidden md:flex flex-nowrap justify-center gap-3 md:gap-4 mb-8">
            {[
              'One-Click Install for Every Product',
              'Complete 6-Step Sales Funnel Included',
              'Set Up in Under 60 Seconds',
            ].map((text, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-full text-white font-semibold whitespace-nowrap"
                style={{
                  fontSize: 'clamp(13px, 1.4vw, 15px)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: 'rgba(255,255,255,0.04)',
                }}
              >
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] text-white flex-shrink-0" style={{ background: '#22c55e' }}>✓</span>
                {text}
              </span>
            ))}
          </div>

          {chargeError && (
            <div className="mb-4 mx-auto max-w-[580px] p-3 rounded-lg text-sm text-red-200 text-center" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
              {chargeError}
            </div>
          )}

          {/* CTA Button */}
          <button
            onClick={handleUpgrade}
            disabled={processing}
            className="w-full md:w-auto md:mx-auto block px-10 md:px-16 py-4 md:py-5 rounded-lg font-black text-center cursor-pointer hover:scale-[1.02] transition-all duration-200 mb-6 md:mb-10 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              fontSize: 'clamp(18px, 2.5vw, 22px)',
              fontFamily: 'var(--app-font-display)',
              background: '#93E360',
              color: '#051408',
              boxShadow: '0 0 30px -5px rgba(147,227,96,0.4)',
            }}
          >
            {processing ? 'Processing...' : 'YES! Upgrade My Order!'}
          </button>
        </div>

        {/* Wistia Video Embed */}
        <div
          className="relative w-full max-w-[1100px] mx-auto px-4 mb-0"
          style={{ zIndex: 10 }}
        >
          <div className="w-full rounded-2xl overflow-hidden" style={{ border: '4px solid #93E360' }}>
            <WistiaVideo mediaId="owtq8i770x" />
          </div>
        </div>

        <div className="relative z-10">
          {/* ============ FIRST PRICING SECTION (inside hero) ============ */}
          <div className="max-w-[700px] mx-auto px-4 pt-14 md:pt-20 pb-14 md:pb-20 text-left md:text-center">
            <h2
              className="text-white font-black leading-tight mb-3"
              style={{ fontSize: 'clamp(24px, 4vw, 40px)', fontFamily: 'var(--app-font-display)' }}
            >
              The Portfolio Expansion{' '}
              <span style={{ color: '#93E360', fontFamily: 'var(--app-font-script, Caveat, cursive)', fontWeight: 400 }}>Package</span>
            </h2>
            <p className="font-bold mb-3" style={{ fontSize: 'clamp(15px, 2.2vw, 20px)', color: '#d4a843' }}>
              Total Value: <span className="line-through">$19,781</span>
            </p>
            <p
              className="text-white font-black mb-5"
              style={{ fontSize: 'clamp(22px, 3.2vw, 32px)', fontFamily: 'var(--app-font-display)' }}
            >
              Special One-Time Deal
            </p>

            <div className="flex items-center justify-center gap-4 mb-8">
              <div className="flex items-baseline">
                <span className="font-black text-white" style={{ fontSize: 'clamp(20px, 3vw, 30px)', fontFamily: 'var(--app-font-display)' }}>$</span>
                <span
                  className="text-white font-black"
                  style={{ fontSize: 'clamp(64px, 12vw, 110px)', fontFamily: 'var(--app-font-display)', lineHeight: 1 }}
                >
                  497
                </span>
              </div>
              <div className="text-left">
                <p className="text-white font-bold" style={{ fontSize: 'clamp(16px, 2.4vw, 22px)' }}>One-Payment</p>
                <p className="text-white font-bold" style={{ fontSize: 'clamp(16px, 2.4vw, 22px)' }}>Lifetime Access!</p>
              </div>
            </div>

            <button
              onClick={handleUpgrade}
              disabled={processing}
              className="block w-full md:mx-auto md:max-w-[580px] py-5 md:py-6 rounded-xl font-black text-center cursor-pointer hover:scale-[1.02] transition-all duration-200 mb-2 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                fontSize: 'clamp(18px, 2.8vw, 26px)',
                fontFamily: 'var(--app-font-display)',
                background: '#93E360',
                color: '#051408',
                boxShadow: '0 0 30px -5px rgba(147,227,96,0.4)',
              }}
            >
              {processing ? 'Processing...' : 'YES! Upgrade My Order!'}
            </button>
            <p className="text-white/50 text-xs mb-5">*Clicking this button will charge you $497</p>

            <p
              className="text-white/70 italic"
              style={{ fontSize: 'clamp(15px, 2vw, 18px)' }}
            >
              30 Days Money Back Guarantee
            </p>
          </div>
        </div>
      </section>

      {/* ============ PRODUCT BREAKDOWN SECTION ============ */}
      <section
        className="w-full relative"
        style={{
          background: '#ffffff',
          backgroundImage: 'linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      >
        <div className="max-w-[900px] mx-auto px-4 py-16 md:py-24 text-left md:text-center">

          {/* Section Header */}
          <p
            className="mb-4 italic"
            style={{
              fontSize: 'clamp(24px, 4vw, 40px)',
              fontFamily: 'var(--app-font-script, Caveat, cursive)',
              color: '#1a1a1a',
            }}
          >
            Everything you get today with
          </p>
          <h2
            className="font-black leading-[1.1] mb-12 md:mb-16"
            style={{
              fontSize: 'clamp(38px, 7vw, 72px)',
              fontFamily: 'var(--app-font-display)',
              color: '#1a1a1a',
            }}
          >
            The Portfolio<br />
            Expansion <span style={{ color: '#93E360', fontFamily: 'var(--app-font-script, Caveat, cursive)', fontWeight: 400, fontSize: '1.1em' }}>Package</span>
          </h2>

          {/* Product Mockup Image */}
          <div className="w-full max-w-[850px] mx-auto mb-12 md:mb-16">
            <img
              src={`${import.meta.env.BASE_URL}upsell3-mockup.png`}
              alt="Portfolio Expansion Package - 9X AI Influencers & 47+ Products"
              className="w-full h-auto"
            />
          </div>

          {/* Product List */}
          <div className="w-full max-w-[720px] mx-auto rounded-2xl overflow-hidden" style={{ border: '2px solid #e5e7eb' }}>
            {/* Header */}
            <div className="w-full px-6 md:px-8 py-5 flex items-center gap-3" style={{ background: '#93E360' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#051408" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
              <h3 className="font-black" style={{ fontSize: 'clamp(18px, 3vw, 26px)', color: '#051408', fontFamily: 'var(--app-font-display)' }}>
                50+ Products to Scale Your Portfolio
              </h3>
            </div>
            {/* Items */}
            <div className="divide-y divide-gray-100">
              {PRODUCTS.map((item, i) => (
                <div key={i} className="flex items-center justify-between px-6 py-3.5">
                  <div className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded flex items-center justify-center text-xs text-white" style={{ background: '#22c55e' }}>✓</span>
                    <span className="font-medium text-sm md:text-base" style={{ color: '#1a1a2e' }}>{item.name}</span>
                  </div>
                  <span className="font-bold text-sm md:text-base whitespace-nowrap" style={{ color: '#93E360' }}>Value: {item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bonuses */}
          <div className="w-full max-w-[720px] mx-auto mt-8 rounded-2xl overflow-hidden" style={{ border: '2px solid #e5e7eb' }}>
            {/* Header */}
            <div className="w-full px-6 md:px-8 py-5 flex items-center gap-3" style={{ background: '#93E360' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#051408" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>
              <h3 className="font-black" style={{ fontSize: 'clamp(18px, 3vw, 26px)', color: '#051408', fontFamily: 'var(--app-font-display)' }}>
                Plus These Free Bonuses
              </h3>
            </div>
            {/* Items */}
            <div className="divide-y divide-gray-100">
              {BONUSES.map((item, i) => (
                <div key={i} className="flex items-center justify-between px-6 py-3.5">
                  <div className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded flex items-center justify-center text-xs text-white" style={{ background: '#22c55e' }}>✓</span>
                    <span className="font-medium text-sm md:text-base" style={{ color: '#1a1a2e' }}>{item.name}</span>
                  </div>
                  <span className="font-bold text-sm md:text-base whitespace-nowrap" style={{ color: '#93E360' }}>Value: {item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ============ DIGITAL PRODUCTS GRID ============ */}
          <div className="mt-16 md:mt-24">
            <p
              className="mb-4 italic"
              style={{
                fontSize: 'clamp(22px, 3.5vw, 36px)',
                fontFamily: 'var(--app-font-script, Caveat, cursive)',
                color: '#1a1a1a',
              }}
            >
              Here's a list of all the
            </p>
            <h2
              className="font-black leading-[1.1] mb-12 md:mb-16"
              style={{
                fontSize: 'clamp(30px, 5.5vw, 56px)',
                fontFamily: 'var(--app-font-display)',
                color: '#1a1a1a',
              }}
            >
              Digital Products You're{' '}
              <span style={{ color: '#93E360', fontFamily: 'var(--app-font-script, Caveat, cursive)', fontWeight: 400, fontSize: '1.1em' }}>
                Going to Get
              </span>
            </h2>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-5 md:gap-8 max-w-[1000px] mx-auto">
              {DIGITAL_PRODUCTS.map((product, i) => (
                <div
                  key={i}
                  className="rounded-xl overflow-hidden flex flex-col"
                  style={{ background: '#ffffff', border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
                >
                  <div className="w-full aspect-[4/3] flex items-center justify-center p-3" style={{ background: '#f5f5f5' }}>
                    <img
                      src={`${import.meta.env.BASE_URL}product-mockups/${product.img}`}
                      alt={product.title}
                      className="max-w-full max-h-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <div className="px-4 py-3">
                    <p
                      className="font-bold leading-snug text-center"
                      style={{ fontSize: 'clamp(12px, 1.4vw, 15px)', color: '#1a1a1a' }}
                    >
                      {product.title}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* CTA after product grid */}
            <div className="max-w-[700px] mx-auto mt-14 md:mt-20 text-center">
              <p className="font-bold italic mb-1" style={{ fontSize: 'clamp(14px, 1.8vw, 18px)', color: '#d4a843' }}>
                Total Value: <span className="line-through">$19,781</span>
              </p>
              <p
                className="font-black mb-4"
                style={{ fontSize: 'clamp(20px, 3vw, 30px)', fontFamily: 'var(--app-font-display)', color: '#1a1a1a' }}
              >
                Special One-Time Deal
              </p>
              <div className="flex items-center justify-center gap-3 mb-6">
                <div className="flex items-baseline">
                  <span className="font-black" style={{ fontSize: 'clamp(18px, 2.5vw, 26px)', fontFamily: 'var(--app-font-display)', color: '#1a1a1a' }}>$</span>
                  <span
                    className="font-black"
                    style={{ fontSize: 'clamp(56px, 10vw, 96px)', fontFamily: 'var(--app-font-display)', color: '#1a1a1a', lineHeight: 1 }}
                  >
                    497
                  </span>
                </div>
                <div className="text-left">
                  <p className="font-bold" style={{ fontSize: 'clamp(14px, 2vw, 20px)', color: '#1a1a1a' }}>One-Payment</p>
                  <p className="font-bold" style={{ fontSize: 'clamp(14px, 2vw, 20px)', color: '#1a1a1a' }}>Lifetime Access!</p>
                </div>
              </div>
              <button
                onClick={handleUpgrade}
                disabled={processing}
                className="block w-full md:mx-auto md:max-w-[580px] py-5 md:py-6 rounded-xl font-black text-center cursor-pointer hover:scale-[1.02] transition-all duration-200 mb-2 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  fontSize: 'clamp(18px, 2.8vw, 26px)',
                  fontFamily: 'var(--app-font-display)',
                  background: '#93E360',
                  color: '#051408',
                  boxShadow: '0 0 30px -5px rgba(147,227,96,0.4)',
                }}
              >
                {processing ? 'Processing...' : 'YES! Upgrade My Order!'}
              </button>
              <p className="text-gray-400 text-xs mb-4">*Clicking this button will charge you $497</p>
              <p
                className="italic"
                style={{ fontSize: 'clamp(14px, 1.8vw, 17px)', color: '#555' }}
              >
                30 Days Money Back Guarantee
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============ TWO-COLUMN PRICING SECTION ============ */}
      <section className="w-full" style={{ background: '#0d3514' }}>
        <div className="max-w-[1100px] mx-auto px-4 md:px-8 py-14 md:py-20">
          <div className="flex flex-col md:flex-row items-center gap-6 md:gap-10">

            {/* Left - Product Mockup Image */}
            <div className="w-full md:w-[62%]">
              <img
                src={`${import.meta.env.BASE_URL}upsell3-mockup.png`}
                alt="Portfolio Expansion Package - 9X AI Influencers & 47+ Products"
                className="w-full h-auto"
              />
            </div>

            {/* Right - Pricing */}
            <div className="w-full md:w-[38%] text-center">
              <h3
                className="text-white font-black leading-tight mb-2"
                style={{ fontSize: 'clamp(22px, 3.2vw, 34px)', fontFamily: 'var(--app-font-display)' }}
              >
                Portfolio Expansion Package
              </h3>
              <p className="font-bold italic mb-1" style={{ fontSize: 'clamp(13px, 1.6vw, 16px)', color: '#d4a843' }}>
                Total Value: <span className="line-through">$19,781</span>
              </p>
              <p
                className="text-white font-black mb-3"
                style={{ fontSize: 'clamp(18px, 2.5vw, 26px)', fontFamily: 'var(--app-font-display)' }}
              >
                Special One-Time Deal
              </p>

              {/* Price */}
              <div className="flex items-center justify-center gap-3 mb-5">
                <div className="flex items-baseline">
                  <span className="text-white font-black" style={{ fontSize: 'clamp(16px, 2vw, 22px)', fontFamily: 'var(--app-font-display)' }}>$</span>
                  <span
                    className="text-white font-black"
                    style={{ fontSize: 'clamp(48px, 8vw, 80px)', fontFamily: 'var(--app-font-display)', lineHeight: 1 }}
                  >
                    497
                  </span>
                </div>
                <div className="text-left">
                  <p className="text-white font-bold" style={{ fontSize: 'clamp(13px, 1.8vw, 17px)' }}>One-Payment</p>
                  <p className="text-white font-bold" style={{ fontSize: 'clamp(13px, 1.8vw, 17px)' }}>Lifetime Access!</p>
                </div>
              </div>

              {/* CTA Button */}
              <div className="relative pt-2">
                <button
                  onClick={handleUpgrade}
                  disabled={processing}
                  className="w-full py-4 md:py-5 rounded-xl text-center cursor-pointer hover:scale-[1.02] transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{
                    background: '#93E360',
                    color: '#051408',
                    boxShadow: '0 0 30px -5px rgba(147,227,96,0.4)',
                  }}
                >
                  <span className="block font-black" style={{ fontSize: 'clamp(16px, 2.2vw, 24px)', fontFamily: 'var(--app-font-display)' }}>
                    {processing ? 'Processing...' : 'YES! Upgrade My Order!'}
                  </span>
                  <span className="block text-xs mt-0.5" style={{ color: 'rgba(5,20,8,0.6)' }}>*Clicking this button will charge you $497</span>
                </button>
              </div>
              <p className="text-white/70 italic mt-4" style={{ fontSize: 'clamp(14px, 1.8vw, 16px)' }}>
                30 Days Money Back Guarantee
              </p>
            </div>

          </div>

          {/* Horizontal Divider */}
          <div className="w-full h-px my-10 md:my-14" style={{ background: 'rgba(255,255,255,0.15)' }} />

          {/* Benefit Row - vertical on mobile, horizontal on desktop */}
          <div className="flex flex-col md:flex-row md:flex-nowrap md:justify-center gap-5 md:gap-6 mb-10 px-2 md:px-0">
            {[
              '50+ Ready-to-Sell Products',
              'One-Click Install in Under 60 Seconds',
              '6-Step Sales Funnel Per Product',
              '$19,781 value for $497',
            ].map((text, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-2 text-white font-black whitespace-nowrap"
                style={{ fontSize: 'clamp(13px, 1.3vw, 16px)', fontFamily: 'var(--app-font-display)' }}
              >
                <span className="w-6 h-6 md:w-5 md:h-5 rounded flex items-center justify-center text-[11px] text-white flex-shrink-0" style={{ background: '#22c55e' }}>✓</span>
                {text}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ============ DECLINE SECTION ============ */}
      <section className="w-full" style={{ background: '#051408' }}>
        <div className="max-w-[1000px] mx-auto px-4 py-8 md:py-12">
          {/* Decline Link */}
          <div
            className="flex items-center justify-center gap-4 max-w-[850px] mx-auto rounded-full px-6 py-4"
            style={{ border: '2px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)' }}
          >
            <span className="text-2xl flex-shrink-0">🚨</span>
            <button
              onClick={handleSkip}
              className="text-sm md:text-base text-white font-bold underline underline-offset-4 decoration-white/60 decoration-2 hover:text-white/80 transition-colors cursor-pointer text-center"
            >
              No Thanks - I don't want this exclusive offer...I understand it will never be available again
            </button>
            <span className="text-2xl flex-shrink-0">🚨</span>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="w-full py-8 text-center" style={{ background: '#000000' }}>
        <div className="flex justify-center mb-4">
          <ProLogo width={120} />
        </div>
      </footer>
    </div>
  );
}
