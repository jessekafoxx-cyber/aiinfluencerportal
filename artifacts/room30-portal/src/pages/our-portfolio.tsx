import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Copy, Check, ExternalLink, Sparkles, ArrowRight, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { PurchasingMovedNotice } from "@/components/purchasing-moved-notice";
import { usePurchaseLinks } from "@/hooks/use-purchase-links";
import {
  useUnlockCelebration,
  useRefetchOnRefocus,
} from "@/hooks/use-unlock-celebration";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  PRODUCT_CATEGORIES,
  getProductMockup,
  products,
  type Product,
  type ProductLink,
} from "@/data/product-data";

const ALL_FILTER = "All";

function LinkRow({ link }: { link: ProductLink }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  };
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:border-[#C9A44C]/30 transition-colors">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 min-w-0 flex items-center gap-2 text-[13px] text-white/85 hover:text-[#C9A44C] truncate"
      >
        <ExternalLink className="w-3.5 h-3.5 text-white/40 shrink-0" />
        <span className="truncate">{link.label}</span>
      </a>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold uppercase tracking-[0.12em] bg-white/[0.04] hover:bg-[#C9A44C]/15 text-white/55 hover:text-[#C9A44C] border border-white/[0.06] hover:border-[#C9A44C]/30 transition-colors"
        aria-label={`Copy ${link.label} link`}
      >
        {copied ? (
          <>
            <Check className="w-3 h-3" />
            Copied
          </>
        ) : (
          <>
            <Copy className="w-3 h-3" />
            Copy
          </>
        )}
      </button>
    </div>
  );
}

function LinkSection({ title, links }: { title: string; links: ProductLink[] }) {
  if (!links?.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#C9A44C]">
        {title}
      </h3>
      <div className="space-y-1.5">
        {links.map((l, i) => (
          <LinkRow key={`${l.label}-${i}`} link={l} />
        ))}
      </div>
    </section>
  );
}

function HighTicketBlock({ product }: { product: Product }) {
  if (!product.highTicket) return null;
  const { name, price, cost, profit, description } = product.highTicket;
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#C9A44C]">
        High-Ticket Offer
      </h3>
      <div className="rounded-xl border border-[#C9A44C]/30 bg-[#C9A44C]/[0.06] p-4 space-y-3">
        <div
          className="text-[16px] font-bold text-white leading-tight"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          {name}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Price", value: price },
            { label: "Cost", value: cost },
            { label: "Profit", value: profit },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg bg-black/30 border border-white/[0.06] px-3 py-2"
            >
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45 mb-0.5">
                {stat.label}
              </div>
              <div className="text-[13.5px] font-semibold text-white">
                {stat.value}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[13px] text-white/70 leading-[1.6]">{description}</p>
      </div>
    </section>
  );
}

function ProductCard({
  product,
  onOpen,
}: {
  product: Product;
  onOpen: (p: Product) => void;
}) {
  const mockup = getProductMockup(product.title);
  return (
    <button
      type="button"
      onClick={() => onOpen(product)}
      className="group text-left rounded-2xl overflow-hidden bg-[#0f0f0f] border border-white/[0.06] hover:border-[#C9A44C]/40 transition-all hover:-translate-y-0.5"
    >
      <div className="aspect-[4/3] bg-black/60 overflow-hidden flex items-center justify-center p-4">
        {mockup ? (
          <img
            src={mockup}
            alt={product.title}
            loading="lazy"
            className="max-w-full max-h-full w-auto h-auto object-contain group-hover:scale-[1.03] transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/25 text-[12px]">
            No image
          </div>
        )}
      </div>
      <div className="p-4 space-y-2">
        <div>
          <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-[0.18em] px-2 py-0.5 rounded-full bg-[#C9A44C]/10 text-[#C9A44C] border border-[#C9A44C]/20">
            {product.category}
          </span>
        </div>
        <h3 className="text-[14px] font-semibold text-white leading-snug line-clamp-3 group-hover:text-[#C9A44C] transition-colors">
          {product.title}
        </h3>
      </div>
    </button>
  );
}

export default function OurPortfolio() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["me"],
    queryFn: api.getMe,
  });
  // Our Portfolio ships as two catalog SKUs that deliver the SAME page:
  // the funnel upsell2 ("Our Portfolio - 47 digital products + 5 unique AI
  // Influencers", flips upsell2Paid) and the portal sidebar add-on
  // ("portfolio", flips portfolioPaid). Either purchase must unlock this
  // page - exactly like Platinum Club gates on platinumPaid || upsell3Paid.
  // Gating on portfolioPaid alone locked funnel-upsell buyers (e.g. anyone
  // who bought upsell2 at checkout) out of content they paid for.
  const paid =
    !!(me?.user as any)?.portfolioPaid || !!(me?.user as any)?.upsell2Paid;
  const isAdmin = me?.user?.role === "admin";
  const hasAccess = paid || isAdmin;

  // Task #730: previously this page silently redirected un-entitled
  // users to /dashboard, which buyers were reading as a 404. Now we
  // render a purchase CTA + inline Stripe Elements pay block in place
  // of the gallery, matching the locked-state pattern used by the
  // other portal add-on pages.
  const [buyError, setBuyError] = useState("");
  const [showPay, setShowPay] = useState(false);
  const { links: purchaseLinks } = usePurchaseLinks();

  const [filter, setFilter] = useState<string>(ALL_FILTER);
  const [active, setActive] = useState<Product | null>(null);

  // Task #9: while the GHL purchase CTA is showing, force a fresh /portal/me
  // pull when the buyer tabs back from the external checkout (React Query's
  // focus refetch respects the 30s staleTime), and celebrate the entitlement
  // flip: the CTA collapses and the gallery renders in its place.
  useRefetchOnRefocus(showPay && !hasAccess, () => {
    void queryClient.refetchQueries({ queryKey: ["me"] });
  });
  useUnlockCelebration({
    active: showPay,
    unlocked: hasAccess,
    label: "Our Portfolio",
    description:
      "Our Portfolio is now unlocked. Your 5 bonus AI influencer builds are on your account too.",
    onUnlocked: () => {
      setShowPay(false);
      setBuyError("");
    },
  });

  const visible = useMemo(() => {
    if (filter === ALL_FILTER) return products;
    return products.filter((p) => p.category === filter);
  }, [filter]);

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="mb-7">
          <p className="text-[11px] text-[#C9A44C] font-bold uppercase tracking-[0.22em] mb-3">
            Premium Add-On
          </p>
          <h1
            className="text-[30px] md:text-[40px] font-bold uppercase tracking-[0.01em] text-white leading-[1.05] mb-3"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Our Portfolio
          </h1>
          <p className="text-[14.5px] text-white/55 leading-[1.65] max-w-[680px]">
            Behind-the-scenes look at the offers, funnels and ads we've built
            and run.
          </p>
        </div>

        {hasAccess && (
        <button
          type="button"
          onClick={() => setLocation("/your-influencers")}
          className="group w-full mb-7 flex items-center gap-4 rounded-2xl border border-[#C9A44C]/30 bg-gradient-to-r from-[#C9A44C]/[0.10] via-[#C9A44C]/[0.05] to-transparent hover:from-[#C9A44C]/[0.16] hover:border-[#C9A44C]/55 transition-colors px-5 py-4 text-left"
          aria-label="Go to My Influencers to build 5 more AI influencers"
        >
          <span className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#C9A44C]/15 border border-[#C9A44C]/30 text-[#C9A44C]">
            <Sparkles className="w-5 h-5" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[10.5px] font-bold uppercase tracking-[0.22em] text-[#C9A44C] mb-1">
              Bonus unlocked
            </span>
            <span className="block text-[14.5px] font-semibold text-white leading-snug">
              You also get 5 extra AI influencer builds.
              <span className="text-white/65 font-normal"> Build them inside the My Influencers tab.</span>
            </span>
          </span>
          <span className="shrink-0 hidden sm:inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.18em] text-[#C9A44C] group-hover:translate-x-0.5 transition-transform">
            Open My Influencers
            <ArrowRight className="w-4 h-4" />
          </span>
        </button>
        )}

        {meLoading ? (
          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
            <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
          </div>
        ) : !hasAccess ? (
          <div className="bg-[#0f0f0f] border border-white/[0.08] rounded-2xl p-7 md:p-9 max-w-[680px]">
            <div className="flex items-center gap-2 mb-3">
              <Lock className="w-4 h-4 text-[#C9A44C]" />
              <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#C9A44C]">
                Locked
              </span>
            </div>
            <h2
              className="text-[22px] md:text-[26px] font-bold uppercase tracking-[0.01em] text-white leading-tight mb-3"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              Unlock Our Portfolio
            </h2>
            <p className="text-[13.5px] text-white/65 leading-[1.65] mb-5">
              47 digital products and 5 unique AI influencers - the full
              behind-the-scenes portfolio of offers, funnels and ads we've
              built and run. Includes 5 bonus AI influencer builds added to
              your account.
            </p>
            {buyError && (
              <div className="text-[12px] text-red-400 bg-red-500/[0.06] border border-red-500/20 rounded-md px-3 py-2 mb-4">
                {buyError}
              </div>
            )}
            {!showPay ? (
              <button
                type="button"
                onClick={() => {
                  setBuyError("");
                  setShowPay(true);
                }}
                className="inline-flex items-center justify-center px-6 py-3.5 rounded-full text-[13.5px] font-bold uppercase tracking-[0.14em] text-white transition-transform hover:scale-[1.02]"
                style={{
                  background:
                    "linear-gradient(135deg, #1F0A2E 0%, #3A0F4D 25%, #5A1370 50%, #8B1A8C 80%, #A8228F 100%)",
                  boxShadow:
                    "0 12px 32px rgba(168,34,143,0.45), 0 0 30px rgba(168,34,143,0.35)",
                  fontFamily: "var(--app-font-display)",
                }}
              >
                Purchase Our Portfolio - $297
              </button>
            ) : (
              <PurchasingMovedNotice
                label="Our Portfolio"
                // Configured link wins; default matches the sidebar row's
                // standalone funnel page fallback.
                purchaseUrl={purchaseLinks["our-portfolio"] ?? "https://room30.ai/our-portfolio"}
                onCancel={() => {
                  setBuyError("");
                  setShowPay(false);
                }}
              />
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-6">
              {[ALL_FILTER, ...PRODUCT_CATEGORIES].map((cat) => {
                const isActive = filter === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setFilter(cat)}
                    className={`px-3 py-1.5 rounded-full text-[11.5px] font-bold uppercase tracking-[0.16em] border transition-colors ${
                      isActive
                        ? "bg-[#C9A44C] text-black border-[#C9A44C]"
                        : "bg-white/[0.03] text-white/60 border-white/[0.08] hover:text-white hover:border-[#C9A44C]/40"
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            {visible.length === 0 ? (
              <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center text-[13px] text-white/55">
                No products in this category yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {visible.map((p) => (
                  <ProductCard key={p.id} product={p} onOpen={setActive} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0a0a0a] border-white/[0.08] text-white">
          {active && (
            <>
              <DialogHeader className="space-y-3 text-left">
                <span className="inline-flex w-fit items-center text-[10px] font-bold uppercase tracking-[0.18em] px-2 py-0.5 rounded-full bg-[#C9A44C]/10 text-[#C9A44C] border border-[#C9A44C]/20">
                  {active.category}
                </span>
                <DialogTitle
                  className="text-[20px] md:text-[24px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
                  style={{ fontFamily: "var(--app-font-display)" }}
                >
                  {active.title}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Funnel, asset and product links for {active.title}.
                </DialogDescription>
              </DialogHeader>

              {getProductMockup(active.title) && (
                <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-black/60 flex items-center justify-center p-4">
                  <img
                    src={getProductMockup(active.title)}
                    alt={active.title}
                    className="max-w-full max-h-[60vh] w-auto h-auto object-contain"
                  />
                </div>
              )}

              <div className="space-y-5 mt-2">
                <LinkSection title="Funnel Links" links={active.funnelLinks} />
                <LinkSection
                  title="Creation Assets"
                  links={active.creationAssets}
                />
                <LinkSection
                  title="Product Links"
                  links={active.productLinks}
                />
                <HighTicketBlock product={active} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}
