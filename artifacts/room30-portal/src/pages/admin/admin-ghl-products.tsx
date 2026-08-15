import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { AdminLayout } from "@/components/admin-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import {
  Package,
  Plus,
  Pencil,
  Trash2,
  Copy,
  Check,
  Download,
  X,
  AlertTriangle,
} from "lucide-react";

type Product = {
  id: number;
  name: string;
  slug: string;
  kind: string;
  description: string | null;
  grantsFullPortal: boolean;
  entitlements: string[];
  active: boolean;
  ghlProductId: string | null;
  purchaseUrl: string | null;
  bonusInfluencerQty: number;
  activePurchases: number;
};

type EntitlementKey = { key: string; label: string };

type MissingPurchaseLink = { slug: string; label: string };

const API = {
  list: (): Promise<{
    products: Product[];
    entitlementKeys: EntitlementKey[];
    missingPurchaseLinks: MissingPurchaseLink[];
  }> => fetchApi("/admin/ghl/products"),
  create: (body: Partial<Product>): Promise<{ product: Product }> =>
    fetchApi("/admin/ghl/products", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, body: Partial<Product>): Promise<{ product: Product }> =>
    fetchApi(`/admin/ghl/products/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id: number): Promise<{ ok: true }> =>
    fetchApi(`/admin/ghl/products/${id}`, { method: "DELETE" }),
  importFromGhl: (): Promise<{ ok: true; imported: number; created: number; updated: number }> =>
    fetchApi("/admin/ghl/products/import-from-ghl", { method: "POST" }),
};

const KINDS = ["main", "bump", "upsell", "addon"] as const;

type FormState = {
  id: number | null;
  name: string;
  slug: string;
  kind: string;
  description: string;
  grantsFullPortal: boolean;
  entitlements: string[];
  active: boolean;
  ghlProductId: string;
  purchaseUrl: string;
  bonusInfluencerQty: number;
};

const emptyForm: FormState = {
  id: null,
  name: "",
  slug: "",
  kind: "main",
  description: "",
  grantsFullPortal: false,
  entitlements: [],
  active: true,
  ghlProductId: "",
  purchaseUrl: "",
  bonusInfluencerQty: 0,
};

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export function AdminGhlProducts() {
  const qc = useQueryClient();
  const listQ = useQuery({ queryKey: ["ghl-products"], queryFn: API.list });

  const [form, setForm] = useState<FormState | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["ghl-products"] });
  const saveMut = useMutation({
    mutationFn: (f: FormState) => {
      const body = {
        name: f.name.trim(),
        slug: f.slug.trim(),
        kind: f.kind,
        description: f.description.trim() || null,
        grantsFullPortal: f.grantsFullPortal,
        entitlements: f.entitlements,
        active: f.active,
        ghlProductId: f.ghlProductId.trim() || null,
        purchaseUrl: f.purchaseUrl.trim() || null,
        bonusInfluencerQty: Math.max(0, Math.trunc(f.bonusInfluencerQty || 0)),
      };
      return f.id == null ? API.create(body) : API.update(f.id, body);
    },
    onSuccess: () => {
      setForm(null);
      invalidate();
    },
  });
  const deleteMut = useMutation({ mutationFn: API.remove, onSuccess: invalidate });
  const importMut = useMutation({ mutationFn: API.importFromGhl, onSuccess: invalidate });

  const copyPayload = (p: Product) => {
    const payload = JSON.stringify(
      { email: "{{contact.email}}", name: "{{contact.name}}", product: p.slug, action: "grant" },
      null,
      2,
    );
    void navigator.clipboard.writeText(payload);
    setCopiedSlug(p.slug);
    setTimeout(() => setCopiedSlug(null), 1500);
  };

  const entKeys = listQ.data?.entitlementKeys ?? [];

  return (
    <AdminLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Package className="w-6 h-6 text-[#D4AF37]" /> Products
            </h1>
            <p className="text-white/50 text-sm mt-1">
              Each product maps a GoHighLevel purchase to portal access. GHL workflows reference the{" "}
              <span className="text-white/80">slug</span> in the webhook payload.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => importMut.mutate()}
              disabled={importMut.isPending}
              className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> {importMut.isPending ? "Importing…" : "Import from GHL"}
            </button>
            <button
              onClick={() => setForm({ ...emptyForm })}
              className="px-3 py-2 rounded-lg bg-[#D4AF37] text-black text-sm font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> New product
            </button>
          </div>
        </div>

        {importMut.isError && (
          <p className="mb-4 text-sm text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            {(importMut.error as Error)?.message || "Import failed"}
          </p>
        )}
        {importMut.isSuccess && (
          <p className="mb-4 text-sm text-emerald-400">
            Imported {importMut.data.imported} GHL products ({importMut.data.created} new,{" "}
            {importMut.data.updated} updated). New imports start inactive — configure what they grant, then activate.
          </p>
        )}

        {(listQ.data?.missingPurchaseLinks?.length ?? 0) > 0 && (
          <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
            <p className="text-sm font-semibold text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {listQ.data!.missingPurchaseLinks.length} upgrade
              {listQ.data!.missingPurchaseLinks.length === 1 ? " has" : "s have"} no purchase link
            </p>
            <p className="text-xs text-white/50 mt-1">
              The portal shows a checkout button on locked upgrade surfaces only when an{" "}
              <span className="text-white/70">active</span> product with the matching slug has a
              Purchase URL. Until then, buyers see a generic "contact hello@room30.ai" notice instead.
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {listQ.data!.missingPurchaseLinks.map((m) => (
                <li
                  key={m.slug}
                  className="px-2.5 py-1 rounded-lg bg-black/30 border border-amber-500/20 text-xs text-white/70"
                  title={m.label}
                >
                  <span className="font-mono">{m.slug}</span>
                  <span className="text-white/40"> — {m.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Editor */}
        {form && (
          <div className="rounded-xl border border-[#D4AF37]/30 bg-white/[0.04] p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">
                {form.id == null ? "New product" : `Edit: ${form.name}`}
              </h2>
              <button onClick={() => setForm(null)} className="text-white/40 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-white/60">
                Name
                <input
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) =>
                      f && {
                        ...f,
                        name: e.target.value,
                        slug: f.id == null && (!f.slug || f.slug === slugify(f.name)) ? slugify(e.target.value) : f.slug,
                      },
                    )
                  }
                  className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80"
                />
              </label>
              <label className="text-sm text-white/60">
                Slug (used in webhook payload)
                <input
                  value={form.slug}
                  onChange={(e) => setForm((f) => f && { ...f, slug: e.target.value })}
                  className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 font-mono"
                />
              </label>
              <label className="text-sm text-white/60">
                Kind
                <select
                  value={form.kind}
                  onChange={(e) => setForm((f) => f && { ...f, kind: e.target.value })}
                  className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80"
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-white/60">
                GHL product ID (optional)
                <input
                  value={form.ghlProductId}
                  onChange={(e) => setForm((f) => f && { ...f, ghlProductId: e.target.value })}
                  className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 font-mono"
                />
              </label>
              <label className="text-sm text-white/60 sm:col-span-2">
                Purchase URL (GHL sales page — locked upgrade surfaces open this in a new tab)
                <input
                  value={form.purchaseUrl}
                  onChange={(e) => setForm((f) => f && { ...f, purchaseUrl: e.target.value })}
                  placeholder="https://your-funnel.gohighlevel.com/upgrade"
                  className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 font-mono"
                />
              </label>
              <label className="text-sm text-white/60">
                Bonus influencer generations on purchase
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={form.bonusInfluencerQty}
                  onChange={(e) =>
                    setForm((f) => f && { ...f, bonusInfluencerQty: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })
                  }
                  className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80"
                />
                <span className="text-[11px] text-white/35 mt-0.5 block">
                  0 = no grant. Set to 5 for a "5 influencer credits" top-up.
                </span>
              </label>
              <label className="text-sm text-white/60 sm:col-span-2">
                Description
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => f && { ...f, description: e.target.value })}
                  rows={2}
                  className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={form.grantsFullPortal}
                  onChange={(e) => setForm((f) => f && { ...f, grantsFullPortal: e.target.checked })}
                />
                Grants full portal access (activates account + sends welcome email)
              </label>
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => f && { ...f, active: e.target.checked })}
                />
                Active
              </label>
            </div>
            <div className="mt-4">
              <div className="text-sm text-white/60 mb-2">Add-on entitlements</div>
              <div className="flex flex-wrap gap-2">
                {entKeys.map((ek) => {
                  const on = form.entitlements.includes(ek.key);
                  return (
                    <button
                      key={ek.key}
                      onClick={() =>
                        setForm(
                          (f) =>
                            f && {
                              ...f,
                              entitlements: on
                                ? f.entitlements.filter((k) => k !== ek.key)
                                : [...f.entitlements, ek.key],
                            },
                        )
                      }
                      className={`px-2.5 py-1.5 rounded-lg text-xs border ${
                        on
                          ? "bg-[#D4AF37]/20 border-[#D4AF37]/50 text-[#D4AF37]"
                          : "bg-white/5 border-white/10 text-white/50 hover:text-white/80"
                      }`}
                      title={ek.key}
                    >
                      {ek.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {saveMut.isError && (
              <p className="mt-3 text-sm text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                {(saveMut.error as Error)?.message || "Save failed"}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => form && saveMut.mutate(form)}
                disabled={saveMut.isPending || !form.name.trim() || !form.slug.trim()}
                className="px-4 py-2 rounded-lg bg-[#D4AF37] text-black text-sm font-semibold disabled:opacity-50"
              >
                {saveMut.isPending ? "Saving…" : "Save product"}
              </button>
              <button
                onClick={() => setForm(null)}
                className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* List */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/40 text-xs uppercase">
                <th className="py-3 px-4">Product</th>
                <th className="py-3 pr-4">Slug</th>
                <th className="py-3 pr-4">Grants</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Active buyers</th>
                <th className="py-3 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {(listQ.data?.products ?? []).map((p) => (
                <tr key={p.id} className="text-white/80">
                  <td className="py-3 px-4">
                    <div className="font-medium text-white">{p.name}</div>
                    <div className="text-xs text-white/40">
                      {p.kind}
                      {p.ghlProductId ? ` · GHL ${p.ghlProductId}` : ""}
                    </div>
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">{p.slug}</td>
                  <td className="py-3 pr-4 text-xs text-white/60">
                    {[
                      p.grantsFullPortal ? "full portal" : null,
                      ...p.entitlements,
                      p.bonusInfluencerQty > 0 ? `+${p.bonusInfluencerQty} influencer credits` : null,
                    ].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        p.active ? "bg-emerald-500/15 text-emerald-400" : "bg-white/10 text-white/50"
                      }`}
                    >
                      {p.active ? "active" : "inactive"}
                    </span>
                  </td>
                  <td className="py-3 pr-4">{p.activePurchases}</td>
                  <td className="py-3 pr-4">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => copyPayload(p)}
                        title="Copy GHL webhook payload"
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/15 text-white/70"
                      >
                        {copiedSlug === p.slug ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() =>
                          setForm({
                            id: p.id,
                            name: p.name,
                            slug: p.slug,
                            kind: p.kind,
                            description: p.description ?? "",
                            grantsFullPortal: p.grantsFullPortal,
                            entitlements: p.entitlements ?? [],
                            active: p.active,
                            ghlProductId: p.ghlProductId ?? "",
                            purchaseUrl: p.purchaseUrl ?? "",
                            bonusInfluencerQty: p.bonusInfluencerQty ?? 0,
                          })
                        }
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/15 text-white/70"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete product "${p.name}"? This cannot be undone.`))
                            deleteMut.mutate(p.id);
                        }}
                        className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {listQ.data && listQ.data.products.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-white/40">
                    No products yet. Create one or import from your connected GHL account.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {deleteMut.isError && (
          <p className="mt-3 text-sm text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            {(deleteMut.error as Error)?.message || "Delete failed"}
          </p>
        )}
      </div>
    </AdminLayout>
  );
}
