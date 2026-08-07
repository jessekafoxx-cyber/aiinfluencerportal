import React, { useState, useEffect, useRef } from 'react';
import { GuestSupportChat } from '../components/support-chat-guest';
import { useBrandedFunnel } from '@/contexts/branded-funnel';

const API_BASE = `${import.meta.env.BASE_URL}api`;

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

type PurchasedProduct = { name: string; priceInCents: number; category: string };

export default function ThankYou() {
  const branded = useBrandedFunnel();
  const brandedLogo = branded.isBranded && branded.logoDarkUrl ? branded.logoDarkUrl : null;
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSet, setPasswordSet] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [purchaseToken, setPurchaseToken] = useState('');
  const [purchaseInfo, setPurchaseInfo] = useState<{
    email: string;
    name: string;
    purchasedProducts: PurchasedProduct[];
  } | null>(null);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [manualEmail, setManualEmail] = useState('');
  const [manualLookupError, setManualLookupError] = useState('');
  const [manualLookupLoading, setManualLookupLoading] = useState(false);
  const [showManualLookup, setShowManualLookup] = useState(false);

  const [accessEmailSent, setAccessEmailSent] = useState(false);

  const fetchByEmail = async (email: string, customerId?: string) => {
    try {
      let url = `${API_BASE}/purchase/find-by-email?email=${encodeURIComponent(email)}`;
      if (customerId) url += `&customerId=${encodeURIComponent(customerId)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          setPurchaseToken(data.token);
          setPurchaseInfo({
            email: data.email,
            name: data.name,
            purchasedProducts: data.purchasedProducts || [],
          });
          setPasswordSet(data.passwordSet);
          setShowManualLookup(false);
          return true;
        }
        if (data.found) {
          setPurchaseInfo({
            email: data.email,
            name: data.name,
            purchasedProducts: data.purchasedProducts || [],
          });
          setPasswordSet(data.passwordSet);
          return 'found-no-token' as any;
        }
      }
    } catch {}
    return false;
  };

  const handleManualLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualLookupError('');
    if (!manualEmail.trim()) return;
    setManualLookupLoading(true);
    try {
      const res = await fetch(`${API_BASE}/purchase/request-access-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: manualEmail.trim() }),
      });
      const data = await res.json();
      if (data.error) {
        setManualLookupError(data.error);
      } else if (data.alreadySetUp) {
        setManualLookupError('Your account is already set up. You can log in to the portal directly.');
      } else {
        setAccessEmailSent(true);
      }
    } catch {
      setManualLookupError('Something went wrong. Please try again.');
    }
    setManualLookupLoading(false);
  };

  useEffect(() => {
    const findToken = async () => {
      setTokenLoading(true);

      const email = sessionStorage.getItem('aip_customer_email') || '';
      const customerId = sessionStorage.getItem('aip_customer_id') || '';
      if (!email) {
        setShowManualLookup(true);
        setTokenLoading(false);
        return;
      }

      let attempts = 0;
      const maxAttempts = 15;

      const found = await fetchByEmail(email, customerId);
      if (found === true) {
        setTokenLoading(false);
        return;
      }

      if (!found) {
        const interval = setInterval(async () => {
          attempts++;
          const result = await fetchByEmail(email, customerId);
          if (result === true || attempts >= maxAttempts) {
            clearInterval(interval);
            if (result !== true) setShowManualLookup(true);
            setTokenLoading(false);
          }
        }, 2000);
      } else {
        setTokenLoading(false);
      }
    };

    findToken();
  }, []);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!purchaseToken) {
      setError('Unable to find your purchase. Please contact support.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/purchase/set-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: purchaseToken, password }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setPasswordSet(true);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to set password');
    } finally {
      setLoading(false);
    }
  };

  const portalUrl = window.location.origin + '/portal';

  const totalCents = purchaseInfo?.purchasedProducts?.reduce((sum, p) => sum + p.priceInCents, 0) ?? 0;

  return (
    <div className="w-full min-h-screen" style={{ background: '#0f1117', fontFamily: 'Inter, sans-serif' }}>

      <nav className="w-full max-w-[900px] mx-auto px-4 py-6 flex items-center justify-center">
        <img
          src={brandedLogo || `${import.meta.env.BASE_URL}logo.png`}
          alt="AI Influencer Portfolio"
          className="h-10 w-auto"
        />
      </nav>

      <section className="w-full">
        <div className="max-w-[760px] mx-auto px-4 pt-6 pb-10 text-center">
          <p
            className="font-bold tracking-wider uppercase mb-4"
            style={{ color: '#93E360', fontSize: 'clamp(13px, 1.6vw, 15px)', letterSpacing: '0.15em' }}
          >
            CONGRATULATIONS!
          </p>

          <h1
            className="text-white font-black leading-[1.1] mb-5 uppercase"
            style={{ fontSize: 'clamp(36px, 6.5vw, 62px)', fontFamily: 'Oswald, var(--app-font-display), sans-serif' }}
          >
            Thank You For Your<br />Order & Welcome!
          </h1>

          <p
            className="text-white/70 mb-10 max-w-[720px] mx-auto leading-relaxed"
            style={{ fontSize: 'clamp(14px, 1.8vw, 17px)' }}
          >
            As promised, here's your access to AI Influencer Portfolio Pro, bonuses, and any upgrades you purchased. We've also sent the link to your email, so please check your spam folder if you don't see it in your inbox. First, though, watch the video below.
          </p>

          <div
            className="w-full max-w-[820px] mx-auto rounded-xl overflow-hidden mb-4"
            style={{
              background: 'linear-gradient(135deg, #93E360, #6bc73e)',
              padding: '3px',
              borderRadius: '14px',
            }}
          >
            <div className="rounded-xl overflow-hidden" style={{ background: '#0f1117' }}>
              <div
                className="flex items-center justify-center gap-2 py-3"
                style={{ background: 'linear-gradient(90deg, #93E360, #6bc73e)' }}
              >
                <span style={{ fontSize: '18px' }}>&#9888;&#65039;</span>
                <span className="font-black text-sm md:text-base tracking-wide" style={{ color: '#051408', fontFamily: 'Oswald, var(--app-font-display), sans-serif' }}>
                  IMPORTANT:
                </span>
                <span className="font-bold text-sm md:text-base" style={{ color: '#051408' }}>
                  PLEASE WATCH THIS FIRST
                </span>
              </div>
              <div className="w-full">
                <div
                  className="relative w-full"
                  style={{ aspectRatio: '16/9', background: '#1a1a2e' }}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center cursor-pointer hover:scale-105 transition-transform" style={{ background: '#93E360' }}>
                      <div className="w-0 h-0 border-t-[10px] border-t-transparent border-l-[18px] border-b-[10px] border-b-transparent ml-1" style={{ borderLeftColor: '#051408' }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="w-full">
        <div className="max-w-[760px] mx-auto px-4 pb-10">
          <div className="space-y-4">

            <div
              className="rounded-2xl p-6 md:p-8 flex flex-col md:flex-row md:items-center gap-5"
              style={{ background: '#1a1d23', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <div className="flex items-start gap-4 flex-1">
                <div
                  className="flex-shrink-0 font-black text-2xl md:text-3xl leading-none"
                  style={{ color: '#93E360', fontFamily: 'Oswald, var(--app-font-display), sans-serif', minWidth: '40px' }}
                >
                  01
                </div>
                <div className="flex-1">
                  {tokenLoading ? (
                    <div className="flex items-center gap-3 py-2">
                      <div className="w-5 h-5 border-2 border-[#93E360] border-t-transparent rounded-full animate-spin" />
                      <span className="text-white/60 text-sm">Setting up your account...</span>
                    </div>
                  ) : showManualLookup && !purchaseToken ? (
                    <div>
                      {accessEmailSent ? (
                        <>
                          <p className="text-white/80 text-sm md:text-base leading-relaxed mb-2">
                            We've sent an access link to <strong className="text-white">{manualEmail}</strong>.
                          </p>
                          <p className="text-white/50 text-sm">
                            Check your inbox (and spam folder) for an email with a button to set up your account.
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-white/80 text-sm md:text-base leading-relaxed mb-3">
                            Enter the email you used during checkout and we'll send you a secure access link.
                          </p>
                          <form onSubmit={handleManualLookup} className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="email"
                              value={manualEmail}
                              onChange={(e) => setManualEmail(e.target.value)}
                              placeholder="Your purchase email"
                              className="flex-1 px-4 py-3 rounded-lg text-white text-sm placeholder-white/30 outline-none focus:ring-2 focus:ring-[#93E360]"
                              style={{
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.12)',
                              }}
                            />
                            <button
                              type="submit"
                              disabled={manualLookupLoading}
                              className="px-6 py-3 rounded-lg font-bold text-sm cursor-pointer hover:opacity-90 transition-all disabled:opacity-50 whitespace-nowrap"
                              style={{ background: '#93E360', color: '#051408' }}
                            >
                              {manualLookupLoading ? 'Sending...' : 'Send Access Link'}
                            </button>
                          </form>
                          {manualLookupError && <p className="text-red-400 text-xs mt-2">{manualLookupError}</p>}
                        </>
                      )}
                    </div>
                  ) : !passwordSet ? (
                    <>
                      <p className="text-white/80 text-sm md:text-base leading-relaxed mb-4">
                        Set up your password below to access the client portal. You'll use your purchase email
                        {purchaseInfo?.email && <> (<strong className="text-white">{purchaseInfo.email}</strong>)</>} and this password to log in.
                      </p>
                      <form onSubmit={handleSetPassword} className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="New password (min 8 chars)"
                            className="w-full px-4 py-3 rounded-lg text-white text-sm placeholder-white/30 outline-none focus:ring-2 focus:ring-[#93E360]"
                            style={{
                              background: 'rgba(255,255,255,0.06)',
                              border: '1px solid rgba(255,255,255,0.12)',
                            }}
                          />
                          <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Confirm password"
                            className="w-full px-4 py-3 rounded-lg text-white text-sm placeholder-white/30 outline-none focus:ring-2 focus:ring-[#93E360]"
                            style={{
                              background: 'rgba(255,255,255,0.06)',
                              border: '1px solid rgba(255,255,255,0.12)',
                            }}
                          />
                        </div>
                        {error && <p className="text-red-400 text-xs">{error}</p>}
                        <button
                          type="submit"
                          disabled={loading}
                          className="w-full md:w-auto px-8 py-3 rounded-lg font-bold text-sm cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
                          style={{ background: '#93E360', color: '#051408' }}
                        >
                          {loading ? 'Setting Password...' : 'Set Password'}
                        </button>
                      </form>
                    </>
                  ) : (
                    <p className="text-white/80 text-sm md:text-base leading-relaxed">
                      Your password is set. You can now access the client portal with your email and password.
                    </p>
                  )}
                </div>
              </div>
              {passwordSet && (
                <a
                  href={portalUrl}
                  className="flex-shrink-0 inline-flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-sm whitespace-nowrap hover:opacity-90 transition-all"
                  style={{ background: '#93E360', color: '#051408' }}
                >
                  Access The Portal <span>&rarr;</span>
                </a>
              )}
            </div>

            <div
              className="rounded-2xl p-6 md:p-8 flex flex-col md:flex-row md:items-center gap-5"
              style={{
                background: '#1a1d23',
                border: '1px solid rgba(255,255,255,0.08)',
                opacity: passwordSet ? 1 : 0.4,
                pointerEvents: passwordSet ? 'auto' : 'none',
              }}
            >
              <div className="flex items-start gap-4 flex-1">
                <div
                  className="flex-shrink-0 font-black text-2xl md:text-3xl leading-none"
                  style={{ color: '#93E360', fontFamily: 'Oswald, var(--app-font-display), sans-serif', minWidth: '40px' }}
                >
                  02
                </div>
                <div>
                  <p className="text-white/80 text-sm md:text-base leading-relaxed">
                    Complete the 2 minute onboarding so we can customize your build, AI influencer and everything exactly how you wish.
                  </p>
                  {!passwordSet && (
                    <p className="text-white/40 text-xs mt-2 flex items-center gap-1.5">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                      Set your password above to unlock this step
                    </p>
                  )}
                </div>
              </div>
              <a
                href={portalUrl}
                className="flex-shrink-0 inline-flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-sm whitespace-nowrap hover:opacity-90 transition-all"
                style={{ background: '#93E360', color: '#051408' }}
              >
                Start Onboarding <span>&rarr;</span>
              </a>
            </div>

            <div
              className="rounded-2xl p-6 md:p-8 flex flex-col md:flex-row md:items-center gap-5"
              style={{
                background: '#1a1d23',
                border: '1px solid rgba(255,255,255,0.08)',
                opacity: passwordSet ? 1 : 0.4,
                pointerEvents: passwordSet ? 'auto' : 'none',
              }}
            >
              <div className="flex items-start gap-4 flex-1">
                <div
                  className="flex-shrink-0 font-black text-2xl md:text-3xl leading-none"
                  style={{ color: '#93E360', fontFamily: 'Oswald, var(--app-font-display), sans-serif', minWidth: '40px' }}
                >
                  03
                </div>
                <div>
                  <p className="text-white/80 text-sm md:text-base leading-relaxed">
                    Consume the masterclass whilst we are building out your sales page and creating your AI influencer (delivered within 24 hours).
                  </p>
                  {!passwordSet && (
                    <p className="text-white/40 text-xs mt-2 flex items-center gap-1.5">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                      Set your password above to unlock this step
                    </p>
                  )}
                </div>
              </div>
              <a
                href={portalUrl}
                className="flex-shrink-0 inline-flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-sm whitespace-nowrap hover:opacity-90 transition-all"
                style={{ background: '#93E360', color: '#051408' }}
              >
                Watch Masterclass <span>&rarr;</span>
              </a>
            </div>

          </div>
        </div>
      </section>

      <section className="w-full">
        <div className="max-w-[760px] mx-auto px-4 pt-6 pb-14">
          <h2
            className="text-white font-black text-center mb-8"
            style={{ fontSize: 'clamp(22px, 4vw, 34px)', fontFamily: 'Oswald, var(--app-font-display), sans-serif' }}
          >
            Here's a summary of what you've ordered
          </h2>

          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: '#1a1d23', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div className="px-6 md:px-8 py-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <h3
                className="text-white font-bold"
                style={{ fontSize: 'clamp(16px, 2vw, 20px)', fontFamily: 'Oswald, var(--app-font-display), sans-serif' }}
              >
                Order Confirmation
              </h3>
            </div>

            <div className="px-6 md:px-8">
              <div
                className="grid grid-cols-[1fr_auto_auto] gap-4 py-3 text-white/50 text-xs font-bold uppercase tracking-wider"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
              >
                <span>Product</span>
                <span className="text-right">Quantity</span>
                <span className="text-right">Price</span>
              </div>

              {tokenLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-[#93E360] border-t-transparent rounded-full animate-spin" />
                  <span className="ml-3 text-white/40 text-sm">Loading your order...</span>
                </div>
              ) : purchaseInfo?.purchasedProducts && purchaseInfo.purchasedProducts.length > 0 ? (
                <>
                  {purchaseInfo.purchasedProducts.map((product, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-[1fr_auto_auto] gap-4 py-4 items-center"
                      style={{ borderBottom: idx < purchaseInfo.purchasedProducts.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
                    >
                      <span className="text-white text-sm">{product.name}</span>
                      <span className="text-white/70 text-sm text-right">1</span>
                      <span className="text-white text-sm text-right font-semibold">
                        ${(product.priceInCents / 100).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                <div className="py-6 text-center text-white/40 text-sm">
                  No products found. Please contact support if you believe this is an error.
                </div>
              )}
            </div>

            {purchaseInfo?.purchasedProducts && purchaseInfo.purchasedProducts.length > 0 && (
              <div
                className="px-6 md:px-8 py-4 grid grid-cols-[1fr_auto] gap-4"
                style={{ borderTop: '1px solid rgba(255,255,255,0.1)', background: 'rgba(147,227,96,0.04)' }}
              >
                <span className="text-white font-bold text-sm">Total</span>
                <span className="text-white font-bold text-sm">
                  ${(totalCents / 100).toFixed(2)}
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      <footer className="w-full py-10 text-center" style={{ background: '#0a0c10', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="max-w-[700px] mx-auto px-4">
          <div className="flex justify-center mb-4">
            <img
              src={brandedLogo || `${import.meta.env.BASE_URL}logo.png`}
              alt="AI Influencer Portfolio"
              className="h-8 w-auto"
            />
          </div>
          <div className="flex items-center justify-center gap-3 text-white/40 text-xs mb-3">
            <a href="#" className="hover:text-white/60 transition-colors">Terms Of Use</a>
            <span>|</span>
            <a href="#" className="hover:text-white/60 transition-colors">Privacy Policy</a>
            <span>|</span>
            <a href="#" className="hover:text-white/60 transition-colors">Earnings Disclaimer</a>
          </div>
          <p className="text-white/30 text-xs mb-6">
            All rights reserved AI Influencer Portfolio Pro
          </p>
          <p className="text-white/20 text-[10px] leading-relaxed max-w-[600px] mx-auto">
            This site is not a part of the Facebook website or Facebook Inc. Additionally, This site is NOT endorsed by Facebook in any way. FACEBOOK is a trademark of FACEBOOK, Inc.
          </p>
          <p className="text-white/20 text-[10px] leading-relaxed max-w-[600px] mx-auto mt-2">
            Please note: When buying any of our education and training programs, please ensure you are 18+ over to buy and that all training and education is purely that and not a guarantee to earn income or a get-rich-quick method. If you are unsure about anything, please kindly do NOT move forward. We want to work with committed people who understand success is a long-term commitment.
          </p>
        </div>
      </footer>
      <GuestSupportChat />
    </div>
  );
}
