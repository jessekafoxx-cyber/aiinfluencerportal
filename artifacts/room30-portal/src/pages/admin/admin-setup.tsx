import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { AdminLayout } from "@/components/admin-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { Link } from "wouter";
import {
  Rocket,
  Check,
  Circle,
  Copy,
  RefreshCw,
  Plug,
  Package,
  Webhook,
  KeyRound,
  ShieldCheck,
  Link as LinkIcon,
  ArrowRight,
} from "lucide-react";

type StepStatus = {
  ghlConnected: { done: boolean; locationId: string | null };
  productsConfigured: { done: boolean; totalProducts: number; activeProducts: number };
  purchaseLinksConfigured: {
    done: boolean;
    totalUpgradeSlugs: number;
    missing: { slug: string; label: string }[];
  };
  webhookReceived: {
    done: boolean;
    totalDeliveries: number;
    processedDeliveries: number;
    webhookUrl: string;
  };
  apiKeyCreated: { done: boolean; activeKeys: number };
  adminEmailsSet: { done: boolean };
};

const API = {
  getSetupStatus: (): Promise<{ steps: StepStatus }> => fetchApi("/admin/ghl/setup-status"),
};

function StatusIcon({ done }: { done: boolean }) {
  return done ? (
    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500/15 shrink-0">
      <Check className="w-4 h-4 text-emerald-400" />
    </span>
  ) : (
    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-white/5 border border-white/15 shrink-0">
      <Circle className="w-3 h-3 text-white/30" />
    </span>
  );
}

function StepCard({
  done,
  icon: Icon,
  title,
  optional,
  children,
  action,
}: {
  done: boolean;
  icon: any;
  title: string;
  optional?: boolean;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-5 flex gap-4 ${
        done ? "border-emerald-500/20 bg-emerald-500/[0.04]" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <StatusIcon done={done} />
      <div className="flex-1 min-w-0">
        <h2 className="text-base font-semibold text-white flex items-center gap-2 flex-wrap">
          <Icon className="w-4 h-4 text-[#D4AF37]" /> {title}
          {optional && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/10 text-white/50">
              Optional
            </span>
          )}
          {done && <span className="text-xs text-emerald-400 font-normal">Done</span>}
        </h2>
        <div className="text-sm text-white/50 mt-1">{children}</div>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

function DeepLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
    >
      {label} <ArrowRight className="w-3.5 h-3.5" />
    </Link>
  );
}

export function AdminSetup() {
  const qc = useQueryClient();
  const statusQ = useQuery({ queryKey: ["ghl-setup-status"], queryFn: API.getSetupStatus });
  const [copied, setCopied] = useState(false);

  const s = statusQ.data?.steps;
  const copyUrl = () => {
    if (!s) return;
    void navigator.clipboard.writeText(s.webhookReceived.webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ADMIN_EMAILS is a nice-to-have hardening step, API key is optional — only
  // the three core steps gate the "ready to go live" banner.
  const coreSteps = s
    ? [s.ghlConnected.done, s.productsConfigured.done, s.webhookReceived.done]
    : [];
  const coreDone = coreSteps.filter(Boolean).length;
  const allCoreDone = s ? coreDone === coreSteps.length : false;

  return (
    <AdminLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Rocket className="w-6 h-6 text-[#D4AF37]" /> Setup
            </h1>
            <p className="text-white/50 text-sm mt-1">
              Everything a new client needs to go live with this template. Statuses update live —
              finish a step and hit Refresh.
            </p>
          </div>
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ["ghl-setup-status"] })}
            className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm flex items-center gap-1.5"
          >
            <RefreshCw className={`w-4 h-4 ${statusQ.isFetching ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {s && (
          <div
            className={`rounded-xl border p-4 mb-6 text-sm ${
              allCoreDone
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-[#D4AF37]/30 bg-[#D4AF37]/10 text-[#D4AF37]"
            }`}
          >
            {allCoreDone
              ? "All core steps complete — this portal is ready to take purchases."
              : `${coreDone} of ${coreSteps.length} core steps complete.`}
          </div>
        )}

        {statusQ.isLoading && <div className="text-white/40 text-sm">Loading setup status…</div>}
        {statusQ.isError && (
          <div className="text-red-400 text-sm">
            Couldn't load setup status: {(statusQ.error as Error)?.message}
          </div>
        )}

        {s && (
          <div className="space-y-4">
            <StepCard
              done={s.ghlConnected.done}
              icon={Plug}
              title="1. Connect GoHighLevel"
              action={<DeepLink href="/admin/api-webhooks" label="Open API & Webhooks" />}
            >
              {s.ghlConnected.done ? (
                <>
                  Connected to location{" "}
                  <span className="font-mono text-white/70">{s.ghlConnected.locationId}</span>.
                </>
              ) : (
                <>
                  Add a Private Integration token (with the <em>View Products</em> scope) and
                  Location ID so you can import products straight from GHL.
                </>
              )}
            </StepCard>

            <StepCard
              done={s.productsConfigured.done}
              icon={Package}
              title="2. Create or import products"
              action={<DeepLink href="/admin/products" label="Open Products" />}
            >
              {s.productsConfigured.done ? (
                <>
                  {s.productsConfigured.activeProducts} active product
                  {s.productsConfigured.activeProducts === 1 ? "" : "s"} (of{" "}
                  {s.productsConfigured.totalProducts} total).
                </>
              ) : s.productsConfigured.totalProducts > 0 ? (
                <>
                  You have {s.productsConfigured.totalProducts} product
                  {s.productsConfigured.totalProducts === 1 ? "" : "s"}, but none are active yet.
                  Configure entitlements and activate at least one.
                </>
              ) : (
                <>
                  Create products manually or import them from your connected GHL account. Each
                  product's slug is what your GHL workflow sends in the webhook.
                </>
              )}
            </StepCard>

            <StepCard
              done={s.purchaseLinksConfigured.done}
              icon={LinkIcon}
              title="3. Add purchase links for upgrades"
              action={<DeepLink href="/admin/products" label="Open Products" />}
            >
              {s.purchaseLinksConfigured.done ? (
                <>
                  All {s.purchaseLinksConfigured.totalUpgradeSlugs} upgrade slugs have an active
                  product with a purchase link.
                </>
              ) : (
                <>
                  {s.purchaseLinksConfigured.missing.length} of{" "}
                  {s.purchaseLinksConfigured.totalUpgradeSlugs} upgrade slugs have no active product
                  with a Purchase URL — their locked surfaces show a generic "contact
                  hello@room30.ai" notice instead of a checkout button:
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {s.purchaseLinksConfigured.missing.map((m) => (
                      <li
                        key={m.slug}
                        className="px-2 py-0.5 rounded bg-black/40 border border-white/10 font-mono text-xs text-white/70"
                        title={m.label}
                      >
                        {m.slug}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </StepCard>

            <StepCard
              done={s.webhookReceived.done}
              icon={Webhook}
              title="4. Wire the purchase webhook into GHL"
              action={
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={copyUrl}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                    Copy webhook URL
                  </button>
                  <DeepLink href="/admin/api-webhooks" label="View deliveries" />
                </div>
              }
            >
              {s.webhookReceived.done ? (
                <>
                  {s.webhookReceived.processedDeliveries} processed deliver
                  {s.webhookReceived.processedDeliveries === 1 ? "y" : "ies"} received.
                </>
              ) : (
                <>
                  In your GHL workflow, add a Webhook action that POSTs to the URL below on
                  purchase. This step turns green after the first successfully processed delivery
                  {s.webhookReceived.totalDeliveries > 0 && (
                    <>
                      {" "}
                      ({s.webhookReceived.totalDeliveries} deliver
                      {s.webhookReceived.totalDeliveries === 1 ? "y" : "ies"} received so far, none
                      processed — check the delivery log)
                    </>
                  )}
                  .
                  <div className="mt-2 font-mono text-xs text-white/60 bg-black/40 border border-white/10 rounded-lg px-3 py-2 break-all">
                    {s.webhookReceived.webhookUrl}
                  </div>
                </>
              )}
            </StepCard>

            <StepCard
              done={s.apiKeyCreated.done}
              icon={KeyRound}
              title="5. Create an external API key"
              optional
              action={<DeepLink href="/admin/external-api" label="Open External API" />}
            >
              {s.apiKeyCreated.done ? (
                <>
                  {s.apiKeyCreated.activeKeys} active key
                  {s.apiKeyCreated.activeKeys === 1 ? "" : "s"}.
                </>
              ) : (
                <>
                  Only needed if other systems will call the portal's REST API (
                  <code className="text-xs bg-black/40 px-1 py-0.5 rounded">/api/v1/…</code>). Keys
                  are shown once at creation.
                </>
              )}
            </StepCard>

            <StepCard
              done={s.adminEmailsSet.done}
              icon={ShieldCheck}
              title="6. Set ADMIN_EMAILS"
            >
              {s.adminEmailsSet.done ? (
                <>
                  The <code className="text-xs bg-black/40 px-1 py-0.5 rounded">ADMIN_EMAILS</code>{" "}
                  environment variable is configured.
                </>
              ) : (
                <>
                  Set the{" "}
                  <code className="text-xs bg-black/40 px-1 py-0.5 rounded">ADMIN_EMAILS</code>{" "}
                  environment variable (comma-separated list) to control who gets super-admin
                  access. Without it, the template falls back to its built-in default — replace it
                  with your own email before going live.
                </>
              )}
            </StepCard>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
