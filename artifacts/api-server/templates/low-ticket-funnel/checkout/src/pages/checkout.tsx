import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useBrandedFunnel } from '@/contexts/branded-funnel';

function countryFlag(code: string) {
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 - 65 + c.charCodeAt(0)));
}

const COUNTRIES = [
  { code: 'US', name: 'United States', phone: '+1' },
  { code: 'GB', name: 'United Kingdom', phone: '+44' },
  { code: 'CA', name: 'Canada', phone: '+1' },
  { code: 'AU', name: 'Australia', phone: '+61' },
  { code: 'NZ', name: 'New Zealand', phone: '+64' },
  { code: 'IE', name: 'Ireland', phone: '+353' },
  { code: 'DE', name: 'Germany', phone: '+49' },
  { code: 'FR', name: 'France', phone: '+33' },
  { code: 'ES', name: 'Spain', phone: '+34' },
  { code: 'IT', name: 'Italy', phone: '+39' },
  { code: 'NL', name: 'Netherlands', phone: '+31' },
  { code: 'BE', name: 'Belgium', phone: '+32' },
  { code: 'AT', name: 'Austria', phone: '+43' },
  { code: 'CH', name: 'Switzerland', phone: '+41' },
  { code: 'SE', name: 'Sweden', phone: '+46' },
  { code: 'NO', name: 'Norway', phone: '+47' },
  { code: 'DK', name: 'Denmark', phone: '+45' },
  { code: 'FI', name: 'Finland', phone: '+358' },
  { code: 'PT', name: 'Portugal', phone: '+351' },
  { code: 'PL', name: 'Poland', phone: '+48' },
  { code: 'CZ', name: 'Czech Republic', phone: '+420' },
  { code: 'RO', name: 'Romania', phone: '+40' },
  { code: 'HU', name: 'Hungary', phone: '+36' },
  { code: 'GR', name: 'Greece', phone: '+30' },
  { code: 'HR', name: 'Croatia', phone: '+385' },
  { code: 'BG', name: 'Bulgaria', phone: '+359' },
  { code: 'SK', name: 'Slovakia', phone: '+421' },
  { code: 'SI', name: 'Slovenia', phone: '+386' },
  { code: 'LT', name: 'Lithuania', phone: '+370' },
  { code: 'LV', name: 'Latvia', phone: '+371' },
  { code: 'EE', name: 'Estonia', phone: '+372' },
  { code: 'JP', name: 'Japan', phone: '+81' },
  { code: 'KR', name: 'South Korea', phone: '+82' },
  { code: 'SG', name: 'Singapore', phone: '+65' },
  { code: 'HK', name: 'Hong Kong', phone: '+852' },
  { code: 'IN', name: 'India', phone: '+91' },
  { code: 'PH', name: 'Philippines', phone: '+63' },
  { code: 'TH', name: 'Thailand', phone: '+66' },
  { code: 'MY', name: 'Malaysia', phone: '+60' },
  { code: 'ID', name: 'Indonesia', phone: '+62' },
  { code: 'BR', name: 'Brazil', phone: '+55' },
  { code: 'MX', name: 'Mexico', phone: '+52' },
  { code: 'AR', name: 'Argentina', phone: '+54' },
  { code: 'CO', name: 'Colombia', phone: '+57' },
  { code: 'CL', name: 'Chile', phone: '+56' },
  { code: 'ZA', name: 'South Africa', phone: '+27' },
  { code: 'AE', name: 'United Arab Emirates', phone: '+971' },
  { code: 'SA', name: 'Saudi Arabia', phone: '+966' },
  { code: 'NG', name: 'Nigeria', phone: '+234' },
  { code: 'KE', name: 'Kenya', phone: '+254' },
  { code: 'EG', name: 'Egypt', phone: '+20' },
  { code: 'IL', name: 'Israel', phone: '+972' },
  { code: 'TR', name: 'Turkey', phone: '+90' },
];

const API_BASE = `${import.meta.env.BASE_URL}api`;

let stripePromise: ReturnType<typeof loadStripe> | null = null;

function getStripePromise() {
  if (!stripePromise) {
    stripePromise = fetch(`${API_BASE}/stripe/config`)
      .then((r) => r.json())
      .then((data) => loadStripe(data.publishableKey));
  }
  return stripePromise;
}

const TERMS_CHECKBOX_TEXT = "I agree to the Terms of Service, Privacy Policy, and Refund Policy. I understand this is a digital product delivered within 24 hours and I have 7 days to request a refund.";

interface CheckoutFormProps {
  firstName: string;
  email: string;
  phone: string;
  country: string;
  total: number;
  items: { name: string; qty: number; price: number }[];
  onSuccess: () => void;
}

function CheckoutForm({ firstName, email, phone, country, total, items, onSuccess }: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError] = useState('');

  const recordTermsAcceptance = async () => {
    try {
      const sid = sessionStorage.getItem('aip_session_id') || crypto.randomUUID();
      if (!sessionStorage.getItem('aip_session_id')) sessionStorage.setItem('aip_session_id', sid);
      await fetch(`${API_BASE}/terms-acceptance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          checkboxText: TERMS_CHECKBOX_TEXT,
          pageUrl: window.location.href,
          termsVersion: '1.0',
          refundPolicyVersion: '1.0',
          sessionId: sid,
          brandTheme: (window as any).__AIP_BRAND_THEME || null,
        }),
      });
    } catch {}
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    if (!termsAccepted) {
      setTermsError('You must agree to the Terms of Service to continue.');
      return;
    }
    setTermsError('');

    setProcessing(true);
    setError('');

    await recordTermsAcceptance();

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message || 'Payment failed');
      setProcessing(false);
      return;
    }

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}${import.meta.env.BASE_URL}upsell-1`,
        payment_method_data: {
          billing_details: {
            name: firstName,
            email,
            phone,
            address: { country },
          },
        },
      },
    });

    if (confirmError) {
      setError(confirmError.message || 'Payment failed');
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-5">
        <PaymentElement
          options={{
            layout: 'tabs',
            business: { name: 'AI Influencers Portfolio' },
          }}
        />
      </div>

      <div className="mb-4">
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => { setTermsAccepted(e.target.checked); if (e.target.checked) setTermsError(''); }}
            className="mt-1 w-4 h-4 rounded border-gray-300 accent-[#93E360] flex-shrink-0"
          />
          <span className="text-xs leading-relaxed" style={{ color: '#999' }}>
            I agree to the{' '}
            <a href={`${import.meta.env.BASE_URL}terms`} target="_blank" rel="noopener noreferrer" style={{ color: '#93E360', textDecoration: 'underline' }} onClick={(e) => e.stopPropagation()}>Terms of Service</a>,{' '}
            <a href={`${import.meta.env.BASE_URL}privacy`} target="_blank" rel="noopener noreferrer" style={{ color: '#93E360', textDecoration: 'underline' }} onClick={(e) => e.stopPropagation()}>Privacy Policy</a>, and{' '}
            <a href={`${import.meta.env.BASE_URL}refund-policy`} target="_blank" rel="noopener noreferrer" style={{ color: '#93E360', textDecoration: 'underline' }} onClick={(e) => e.stopPropagation()}>Refund Policy</a>.
            I understand this is a digital product delivered within 24 hours and I have 7 days to request a refund.
          </span>
        </label>
        {termsError && (
          <p className="text-xs mt-1.5 ml-7" style={{ color: '#ef4444' }}>{termsError}</p>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg text-sm text-red-700" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || processing}
        className="w-full py-4 md:py-5 px-6 md:px-10 rounded-2xl text-base md:text-lg font-extrabold uppercase tracking-wider cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed flex flex-col items-center justify-center"
        style={{ background: '#93E360', color: '#051408', boxShadow: '0 4px 20px rgba(147,227,96,0.3)' }}
      >
        <span className="flex items-center gap-2">{processing ? 'Processing...' : <>YES - BUILD MY AI PORTFOLIO <span className="text-xl">&#8594;</span></>}</span>
        {!processing && <span className="block text-[10px] md:text-[11px] font-semibold mt-1 uppercase tracking-wider opacity-70">Done For You In 24 Hours, 7-Day Refund Guarantee</span>}
      </button>
    </form>
  );
}

export default function Checkout() {
  const [, setLocation] = useLocation();
  const branded = useBrandedFunnel();
  const brandedLogo = branded.isBranded && branded.logoDarkUrl ? branded.logoDarkUrl : null;
  const [bumps, setBumps] = useState({
    bump1: true,
    bump2: true,
    bump3: true,
  });
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('US');
  const [clientSecret, setClientSecret] = useState('');
  const [loadingPayment, setLoadingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [emailStatus, setEmailStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [emailError, setEmailError] = useState('');
  const [trackingCode, setTrackingCode] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && ref.startsWith("tk_")) {
      setTrackingCode(ref);
      try { sessionStorage.setItem("aip_ref", ref); } catch {}
    } else {
      try {
        const stored = sessionStorage.getItem("aip_ref");
        if (stored && stored.startsWith("tk_")) {
          setTrackingCode(stored);
        }
      } catch {}
    }

    const path = window.location.pathname;
    const brandMatch = path.match(/\/(blue|pink|red|black|gold)\//);
    if (brandMatch) {
      (window as any).__AIP_BRAND_THEME = brandMatch[1];
      try { sessionStorage.setItem("aip_brand_theme", brandMatch[1]); } catch {}
    } else {
      (window as any).__AIP_BRAND_THEME = "green";
      try { sessionStorage.setItem("aip_brand_theme", "green"); } catch {}
    }
  }, []);

  useEffect(() => {
    fetch('https://ipapi.co/json/')
      .then((r) => r.json())
      .then((data) => {
        if (data.country_code) {
          const found = COUNTRIES.find((c) => c.code === data.country_code);
          if (found) setCountry(found.code);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const basicEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !basicEmailRegex.test(email)) {
      setEmailStatus('idle');
      setEmailError('');
      return;
    }

    setEmailStatus('checking');
    setEmailError('');

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/email/validate?email=${encodeURIComponent(email)}`);
        const data = await res.json();
        if (data.valid) {
          setEmailStatus('valid');
          setEmailError('');
        } else {
          setEmailStatus('invalid');
          const msg = data.status === 'invalid' ? 'This email address appears to be invalid. Please check and try again.'
            : data.status === 'do_not_mail' ? 'This email cannot receive mail. Please use a different email.'
            : data.status === 'spamtrap' ? 'This email has been flagged. Please use a different email.'
            : data.status === 'abuse' ? 'This email has been flagged. Please use a different email.'
            : data.status === 'catch-all' ? '' 
            : 'Please check your email address and try again.';
          setEmailError(msg);
          if (data.status === 'catch-all') {
            setEmailStatus('valid');
          }
        }
      } catch {
        setEmailStatus('valid');
        setEmailError('');
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [email]);

  const MAIN_PRODUCT_PRICE = 27;
  const BUMP_PRICES = {
    bump1: 37,
    bump2: 17,
    bump3: 27,
  };

  const total = MAIN_PRODUCT_PRICE
    + (bumps.bump1 ? BUMP_PRICES.bump1 : 0)
    + (bumps.bump2 ? BUMP_PRICES.bump2 : 0)
    + (bumps.bump3 ? BUMP_PRICES.bump3 : 0);

  const orderItems = [
    { name: 'DFY AI Influencer, Custom Build Sales Funnel & Masterclass', qty: 1, price: MAIN_PRODUCT_PRICE },
    ...(bumps.bump1 ? [{ name: 'TikTok Slide Show Masterclass, Prompts & Automation', qty: 1, price: BUMP_PRICES.bump1 }] : []),
    ...(bumps.bump2 ? [{ name: 'Hook + Demo Library', qty: 1, price: BUMP_PRICES.bump2 }] : []),
    ...(bumps.bump3 ? [{ name: 'AI Static Ad Generator - 100+ Unique Ads In 90 Seconds', qty: 1, price: BUMP_PRICES.bump3 }] : []),
  ];

  const productSlugs = [
    'main-product',
    ...(bumps.bump1 ? ['order-bump-1'] : []),
    ...(bumps.bump2 ? ['order-bump-2'] : []),
    ...(bumps.bump3 ? ['order-bump-3'] : []),
  ];

  const createPaymentIntent = async () => {
    if (!firstName.trim() || !email.trim() || emailStatus === 'invalid') return;
    setLoadingPayment(true);
    setPaymentError('');
    try {
      const res = await fetch(`${API_BASE}/stripe/create-payment-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: total, email, name: firstName, phone, items: orderItems, productSlugs, trackingCode, brandTheme: (window as any).__AIP_BRAND_THEME || null, visitorId: localStorage.getItem('aip_visitor_id') || null, splitTestId: sessionStorage.getItem('aip_split_test_id') || null }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setClientSecret(data.clientSecret);
      if (data.customerId) {
        try {
          sessionStorage.setItem('aip_customer_id', data.customerId);
          sessionStorage.setItem('aip_customer_email', email);
          sessionStorage.setItem('aip_customer_name', firstName);
        } catch {}
      }
    } catch (err: any) {
      setPaymentError(err.message || 'Failed to initialize payment');
    } finally {
      setLoadingPayment(false);
    }
  };

  useEffect(() => {
    if (firstName.trim() && email.trim()) {
      const timer = setTimeout(() => createPaymentIntent(), 500);
      return () => clearTimeout(timer);
    }
  }, [total, firstName, email]);

  const selectedCountry = COUNTRIES.find((c) => c.code === country);

  return (
    <div className="min-h-screen" style={{ background: '#0a0a0a', color: '#fff' }}>

      {/* ===== MOBILE HEADER (visible < lg) ===== */}
      <div className="lg:hidden">
        <div className="py-8 px-6 text-center" style={{ background: '#051408' }}>
          <div className="flex items-center justify-center mb-2">
            <img src={brandedLogo || `${import.meta.env.BASE_URL}logo.png`} alt="AI Influencers Portfolio" className="h-8 w-auto" />
          </div>
          <p className="text-sm mb-3" style={{ color: 'rgba(255,255,255,0.6)' }}>AI Influencer Portfolio Done For You Build (Delivered In 24 Hours)</p>
          <div className="flex items-center justify-center gap-3">
            <span className="text-3xl font-black" style={{ color: '#93E360' }}>$27.00</span>
            <span className="text-xl line-through" style={{ color: 'rgba(255,255,255,0.4)' }}>$147.00</span>
          </div>
        </div>
      </div>

      {/* ===== MAIN TWO-COLUMN LAYOUT ===== */}
      <div className="lg:grid min-h-screen" style={{ gridTemplateColumns: '2fr 3fr' }}>

        {/* ===== LEFT SIDEBAR (sticky on desktop, hidden on mobile) ===== */}
        <div className="hidden lg:block relative" style={{ background: '#051408' }}>
          <div className="sticky top-0 h-screen flex">
          <div className="p-8 lg:p-10 xl:p-12 w-full max-w-[480px]">
            <div className="mb-6">
              <img src={brandedLogo || `${import.meta.env.BASE_URL}logo.png`} alt="AI Influencers Portfolio" className="h-10 w-auto" />
            </div>

            <p className="text-sm mb-2" style={{ color: 'rgba(255,255,255,0.6)' }}>AI Influencer Portfolio Done For You Build (Delivered In 24 Hours)</p>
            <div className="flex items-center gap-3 mb-8">
              <span className="text-3xl font-black" style={{ color: '#93E360' }}>$27.00</span>
              <span className="text-xl line-through" style={{ color: 'rgba(255,255,255,0.4)' }}>$147.00</span>
            </div>

            <p className="text-sm font-semibold text-white mb-4">Recommended upgrades:</p>

            {/* Bump Preview 1 - $37 TikTok Slideshow */}
            <div className="flex items-center gap-3 mb-4 cursor-pointer" onClick={() => setBumps(b => ({ ...b, bump1: !b.bump1 }))}>
              <img src={`${import.meta.env.BASE_URL}bump-tiktok-slideshow-mockup.png`} alt="TikTok Slideshow" className="w-16 h-12 shrink-0 object-cover" />
              <div>
                <p className="text-sm font-semibold text-white leading-tight">TikTok Slide Show Masterclass</p>
                <p className="text-xs">
                  <span className="line-through" style={{ color: 'rgba(255,255,255,0.4)' }}>$97</span>{' '}
                  <span className="font-bold" style={{ color: '#93E360' }}>$37</span>
                </p>
              </div>
            </div>

            {/* Bump Preview 2 - $17 Hook + Demo Library */}
            <div className="flex items-center gap-3 mb-4 cursor-pointer" onClick={() => setBumps(b => ({ ...b, bump2: !b.bump2 }))}>
              <img src={`${import.meta.env.BASE_URL}bump-prompt-masterclass.png`} alt="Hook + Demo Library" className="w-16 h-12 shrink-0 object-cover" />
              <div>
                <p className="text-sm font-semibold text-white leading-tight">Hook + Demo Library</p>
                <p className="text-xs">
                  <span className="line-through" style={{ color: 'rgba(255,255,255,0.4)' }}>$67</span>{' '}
                  <span className="font-bold" style={{ color: '#93E360' }}>$17</span>
                </p>
              </div>
            </div>

            {/* Bump Preview 3 - $27 Static Ad Generator */}
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => setBumps(b => ({ ...b, bump3: !b.bump3 }))}>
              <img src={`${import.meta.env.BASE_URL}bump-static-ads-mockup.png`} alt="Static Ad Generator" className="w-16 h-12 shrink-0 object-cover" />
              <div>
                <p className="text-sm font-semibold text-white leading-tight">AI Static Ad Generator</p>
                <p className="text-xs">
                  <span className="line-through" style={{ color: 'rgba(255,255,255,0.4)' }}>$67</span>{' '}
                  <span className="font-bold" style={{ color: '#93E360' }}>$27</span>
                </p>
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* ===== RIGHT COLUMN: CHECKOUT FORM ===== */}
        <div className="px-6 py-8 lg:px-12 lg:py-10" style={{ background: '#FFFFFF', color: '#051408' }}>
          <div className="w-full max-w-[560px]">

          {/* Contact Information */}
          <h2 className="text-2xl font-bold mb-4 uppercase" style={{ fontFamily: 'var(--app-font-display)', color: '#051408' }}>
            Contact Information
          </h2>

          <div className="space-y-2.5 mb-4">
            <div>
              <label className="text-sm font-medium mb-1 block" style={{ color: '#333' }}>First name</label>
              <input
                type="text"
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                className="w-full px-3.5 py-3 rounded-md text-[15px] outline-none transition-all focus:ring-2 focus:ring-[#93E360]"
                style={{ background: '#FFFFFF', border: '1px solid #d1d5db', color: '#051408' }}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block" style={{ color: '#333' }}>Email</label>
              <div className="relative">
                <input
                  type="email"
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-3.5 py-3 pr-10 rounded-md text-[15px] outline-none transition-all focus:ring-2 focus:ring-[#93E360]"
                  style={{
                    background: '#FFFFFF',
                    border: `1px solid ${emailStatus === 'invalid' ? '#ef4444' : emailStatus === 'valid' ? '#22c55e' : '#d1d5db'}`,
                    color: '#051408',
                  }}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {emailStatus === 'checking' && (
                    <svg className="animate-spin h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  )}
                  {emailStatus === 'valid' && (
                    <svg className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                  )}
                  {emailStatus === 'invalid' && (
                    <svg className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  )}
                </div>
              </div>
              {emailError && (
                <p className="text-xs mt-1" style={{ color: '#ef4444' }}>{emailError}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block" style={{ color: '#333' }}>Phone</label>
              <div className="flex">
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="shrink-0 px-2.5 py-3 rounded-l-md text-[14px] outline-none transition-all focus:ring-2 focus:ring-[#93E360] appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23333%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_6px_center]"
                  style={{ background: '#f9fafb', border: '1px solid #d1d5db', borderRight: 'none', color: '#051408', paddingRight: '22px', minWidth: '110px' }}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{countryFlag(c.code)} {c.phone} {c.code}</option>
                  ))}
                </select>
                <input
                  type="tel"
                  placeholder="Phone number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3.5 py-3 rounded-r-md text-[15px] outline-none transition-all focus:ring-2 focus:ring-[#93E360]"
                  style={{ background: '#FFFFFF', border: '1px solid #d1d5db', color: '#051408' }}
                />
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="mb-6" style={{ borderBottom: '1px solid #e5e7eb' }} />

          {/* PAYMENT Section */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-4 pb-2" style={{ color: '#676F68', borderBottom: '1px solid #eee' }}>
              PAYMENT
            </p>

            {/* Order Line Items */}
            <div className="mb-4">
              <div className="grid grid-cols-[1fr_auto_auto] gap-4 text-xs font-bold uppercase tracking-wider pb-2 mb-2" style={{ color: '#676F68', borderBottom: '1px solid #eee' }}>
                <span>Item</span>
                <span>Quantity</span>
                <span className="text-right">Price</span>
              </div>

              <div className="flex items-center gap-3 py-2">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ background: '#93E360' }} />
                <span className="text-sm flex-1" style={{ color: '#051408' }}>AI Influencer Portfolio Done For You Build (Delivered In 24 Hours)</span>
                <span className="text-sm text-center w-16">1</span>
                <span className="text-sm font-semibold text-right w-16" style={{ color: '#051408' }}>${MAIN_PRODUCT_PRICE}.00</span>
              </div>
            </div>

            {/* Bump 1 ($37): TikTok Slide Show Masterclass */}
            <div className="rounded-xl p-4 mb-4" style={{ border: '2px dashed #93E360', background: 'rgba(147,227,96,0.04)' }}>
              <label className="flex items-start gap-3 cursor-pointer">
                <span className="text-lg mt-0.5" style={{ color: '#93E360' }}>&#10140;</span>
                <input
                  type="checkbox"
                  checked={bumps.bump1}
                  onChange={() => setBumps(b => ({ ...b, bump1: !b.bump1 }))}
                  className="mt-1.5 w-5 h-5 accent-green-500"
                />
                <div className="flex-1">
                  <p className="font-bold text-[15px] mb-1" style={{ color: '#051408' }}>
                    YES! I Want The TikTok Slide Show Masterclass, Prompts & Automation To Go Viral On TikTok!
                  </p>
                  <p className="text-[13px] leading-relaxed" style={{ color: '#555' }}>
                    <strong style={{ color: '#93E360' }}>Recommended Add-On:</strong> Get The Complete TikTok Slideshow System - Step-By-Step Masterclass, Done-For-You Prompts & Full Automation Setup To Create Viral Slideshows That Drive Traffic And Sales On Autopilot. (Normally $97 - Today Just $37!)
                  </p>
                </div>
              </label>
              <div className="mt-3 rounded-xl overflow-hidden">
                <img src={`${import.meta.env.BASE_URL}bump-tiktok-slideshow-mockup.png`} alt="TikTok Slide Show Masterclass" className="w-full h-auto" />
              </div>
            </div>

            {/* Bump 2 ($17): Hook + Demo Library */}
            <div className="rounded-xl p-4 mb-4" style={{ border: '2px dashed #93E360', background: 'rgba(147,227,96,0.04)' }}>
              <label className="flex items-start gap-3 cursor-pointer">
                <span className="text-lg mt-0.5" style={{ color: '#93E360' }}>&#10140;</span>
                <input
                  type="checkbox"
                  checked={bumps.bump2}
                  onChange={() => setBumps(b => ({ ...b, bump2: !b.bump2 }))}
                  className="mt-1.5 w-5 h-5 accent-green-500"
                />
                <div className="flex-1">
                  <p className="font-bold text-[15px] mb-1" style={{ color: '#051408' }}>
                    YES! I Want The Complete Hook + Demo Library To Create Content That Converts!
                  </p>
                  <p className="text-[13px] leading-relaxed" style={{ color: '#555' }}>
                    <strong style={{ color: '#93E360' }}>Bonus Add-On:</strong> Access Our Proven Library Of High-Converting Hooks And Demo Content. Copy The Exact Formulas That Stop The Scroll And Turn Viewers Into Buyers. (Normally $67 - Today Just $17!)
                  </p>
                </div>
              </label>
              <div className="mt-3 rounded-xl overflow-hidden">
                <img src={`${import.meta.env.BASE_URL}bump-prompt-masterclass.png`} alt="Hook + Demo Library" className="w-full h-auto" />
              </div>
            </div>

            {/* Bump 3 ($27): AI Static Ad Generator */}
            <div className="rounded-xl p-4 mb-4" style={{ border: '2px dashed #93E360', background: 'rgba(147,227,96,0.04)' }}>
              <label className="flex items-start gap-3 cursor-pointer">
                <span className="text-lg mt-0.5" style={{ color: '#93E360' }}>&#10140;</span>
                <input
                  type="checkbox"
                  checked={bumps.bump3}
                  onChange={() => setBumps(b => ({ ...b, bump3: !b.bump3 }))}
                  className="mt-1.5 w-5 h-5 accent-green-500"
                />
                <div className="flex-1">
                  <p className="font-bold text-[15px] mb-1" style={{ color: '#051408' }}>
                    YES! I Want The AI Static Ad Generator That Creates 100+ Unique Ads In 90 Seconds!
                  </p>
                  <p className="text-[13px] leading-relaxed" style={{ color: '#555' }}>
                    <strong style={{ color: '#93E360' }}>Special Offer:</strong> Generate Over 100 Unique, Scroll-Stopping Static Ads In Under 90 Seconds Using Our AI Ad Generator. No Design Skills Needed - Just Upload Your Product And Let AI Do The Rest. (Normally $67 - Today Just $27!)
                  </p>
                </div>
              </label>
              <div className="mt-3 rounded-xl overflow-hidden">
                <img src={`${import.meta.env.BASE_URL}bump-static-ads-mockup.png`} alt="AI Static Ad Generator" className="w-full h-auto" />
              </div>
            </div>

            {/* Order Summary Table */}
            <div className="mt-6 mb-4">
              <p className="text-center text-sm font-bold uppercase tracking-wider mb-3 pb-2" style={{ color: '#676F68', borderBottom: '1px solid #eee' }}>
                Order Summary
              </p>
              <div className="grid grid-cols-[1fr_auto_auto] gap-4 text-xs font-bold uppercase tracking-wider pb-2 mb-2" style={{ color: '#676F68', borderBottom: '1px solid #eee' }}>
                <span>Item</span>
                <span className="text-center">Quantity</span>
                <span className="text-right">Amount</span>
              </div>
              {orderItems.map((item, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-4 py-2 text-sm" style={{ borderBottom: '1px solid #f5f5f5' }}>
                  <span style={{ color: '#333' }}>{item.name}</span>
                  <span className="text-center w-16">{item.qty}</span>
                  <span className="text-right font-semibold w-20" style={{ color: '#051408' }}>$ {item.price}.00</span>
                </div>
              ))}
              <div className="grid grid-cols-[1fr_auto_auto] gap-4 py-3 text-sm font-bold" style={{ borderTop: '2px solid #eee' }}>
                <span style={{ color: '#051408' }}>Order Total</span>
                <span></span>
                <span className="text-right w-20" style={{ color: '#051408' }}>${total}.00</span>
              </div>
            </div>

            {/* Stripe Payment Element */}
            {clientSecret ? (
              <Elements
                stripe={getStripePromise()}
                options={{
                  clientSecret,
                  appearance: {
                    theme: 'stripe',
                    variables: {
                      colorPrimary: '#93E360',
                      colorBackground: '#ffffff',
                      colorText: '#051408',
                      colorDanger: '#dc2626',
                      fontFamily: 'Inter, system-ui, sans-serif',
                      spacingUnit: '4px',
                      borderRadius: '8px',
                      fontSizeBase: '15px',
                    },
                    rules: {
                      '.Input': {
                        border: '1px solid #d1d5db',
                        boxShadow: 'none',
                        padding: '12px 14px',
                      },
                      '.Input:focus': {
                        border: '1px solid #93E360',
                        boxShadow: '0 0 0 2px rgba(147,227,96,0.2)',
                      },
                      '.Tab': {
                        border: '1px solid #d1d5db',
                        boxShadow: 'none',
                      },
                      '.Tab--selected': {
                        border: '2px solid #93E360',
                        backgroundColor: 'rgba(147,227,96,0.05)',
                      },
                      '.Label': {
                        fontWeight: '500',
                        fontSize: '14px',
                        marginBottom: '6px',
                      },
                    },
                  },
                }}
              >
                <CheckoutForm
                  firstName={firstName}
                  email={email}
                  phone={phone}
                  country={country}
                  total={total}
                  items={orderItems}
                  onSuccess={() => setLocation('/thank-you')}
                />
              </Elements>
            ) : (
              <div>
                {paymentError && (
                  <div className="mb-4 p-3 rounded-lg text-sm text-red-700" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                    {paymentError}
                  </div>
                )}
                {loadingPayment ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-6 h-6 border-2 border-[#93E360] border-t-transparent rounded-full animate-spin" />
                    <span className="ml-3 text-sm" style={{ color: '#666' }}>Initializing secure payment...</span>
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <p className="text-sm mb-1" style={{ color: '#666' }}>Enter your contact information above to proceed to payment</p>
                  </div>
                )}
                <button
                  type="button"
                  disabled
                  className="w-full py-4 md:py-5 px-6 md:px-10 rounded-2xl text-base md:text-lg font-extrabold uppercase tracking-wider opacity-50 cursor-not-allowed flex flex-col items-center justify-center"
                  style={{ background: '#93E360', color: '#051408', boxShadow: '0 4px 20px rgba(147,227,96,0.3)' }}
                >
                  <span className="flex items-center gap-2">YES - BUILD MY AI PORTFOLIO <span className="text-xl">&#8594;</span></span>
                  <span className="block text-[10px] md:text-[11px] font-semibold mt-1 uppercase tracking-wider opacity-70">Done For You In 24 Hours, 7-Day Refund Guarantee</span>
                </button>
              </div>
            )}
          </div>

          {/* Trust Badges */}
          <div className="mt-6">
            <img src={`${import.meta.env.BASE_URL}trust-badges-checkout.avif`} alt="Guaranteed safe and secure checkout" className="w-full max-w-[420px] mx-auto" />

            <div className="flex items-center justify-center gap-3 mt-5 text-xs" style={{ color: '#999' }}>
              <a href="#" className="hover:underline">Terms</a>
              <span>|</span>
              <a href="#" className="hover:underline">Privacy</a>
              <span>|</span>
              <a href="#" className="hover:underline">Earnings Disclaimer</a>
            </div>
          </div>

          </div>
        </div>

      </div>
    </div>
  );
}
