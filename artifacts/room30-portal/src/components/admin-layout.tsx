import { useUser, useClerk } from "@clerk/react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api, stopImpersonationBeforeSignOut } from "@/lib/api";
import {
  LayoutDashboard,
  Users,
  FileText,
  Mail,
  LogOut,
  ChevronRight,
  Shield,
  Menu,
  X,
  ArrowLeft,
  Settings,
  Bell,
  KeyRound,
  Package,
  LifeBuoy,
  Rocket,
} from "lucide-react";
import { useState, useEffect } from "react";
import {
  userCapabilities,
  type TeamCapability,
} from "@/lib/capabilities";

// Task #796: each nav item optionally declares the capability a non-admin
// team member needs to see it. Items WITHOUT a `cap` are admin-only (checkout
// conversion, analytics, knowledge base, etc.) and never render for team
// members. Admins / super-admins always hold every capability so they see
// everything.
type AdminNavItem = {
  href: string;
  label: string;
  icon: any;
  cap?: TeamCapability;
};

const adminNavItems: AdminNavItem[] = [
  { href: "/admin", label: "Analytics", icon: LayoutDashboard },
  { href: "/admin/setup", label: "Setup", icon: Rocket },
  { href: "/admin/users", label: "Users", icon: Users, cap: "users.view" },
  { href: "/admin/logs", label: "Access Logs", icon: FileText, cap: "logs.view" },
  { href: "/admin/invites", label: "Invites", icon: Mail, cap: "users.invite" },
  { href: "/admin/support-knowledge", label: "Alana Support Knowledge", icon: LifeBuoy },
  { href: "/admin/announcements", label: "Announcements", icon: Bell },
  { href: "/admin/api-webhooks", label: "API & Webhooks", icon: KeyRound },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/external-api", label: "External API", icon: KeyRound },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: api.getMe,
  });

  const isAdmin = me?.user?.role === "admin";
  // Task #796: resolve the caller's capability set. Admins hold everything;
  // team members hold their granted subset. getMe returns a flat
  // `capabilities` array which userCapabilities prefers.
  const caps = userCapabilities(me?.user, isAdmin);
  const visibleNavItems = adminNavItems.filter(
    (item) => isAdmin || (item.cap ? caps.has(item.cap) : false),
  );

  // Task #796: page-level guard. The nav already hides admin-only pages from
  // team members, but a team member could still reach one by typing the URL.
  // The backend 403s the underlying data either way, but we redirect so they
  // never land on a broken admin-only shell. We wait for `me` to load (so we
  // don't bounce an admin mid-fetch), then if the current admin route is one
  // the caller is not permitted to see, send them to their first allowed page
  // (or back to the portal dashboard if they have none).
  useEffect(() => {
    if (!me?.user) return;
    if (!location.startsWith("/admin")) return;
    // Find the most specific nav item matching the current location (exact
    // href or a detail sub-path like /admin/users/123).
    const match = adminNavItems
      .filter(
        (item) =>
          location === item.href || location.startsWith(item.href + "/"),
      )
      .sort((a, b) => b.href.length - a.href.length)[0];
    if (!match) return; // unknown admin route - leave it to the router
    const permitted = isAdmin || (match.cap ? caps.has(match.cap) : false);
    if (permitted) return;
    const fallback = visibleNavItems[0]?.href ?? "/dashboard";
    setLocation(fallback);
  }, [me, location, isAdmin, caps, visibleNavItems, setLocation]);

  const renderNavButton = (item: AdminNavItem) => {
    const active = location === item.href;
    return (
      <button
        key={item.href}
        onClick={() => {
          setLocation(item.href);
          setSidebarOpen(false);
        }}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
          active
            ? "bg-[#C9A44C]/15 text-[#C9A44C]"
            : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]"
        }`}
      >
        <item.icon className="w-4 h-4" />
        {item.label}
        {active && <ChevronRight className="w-3 h-3 ml-auto" />}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-background flex">
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[260px] bg-[#0a0a0a] border-r border-white/[0.06] flex flex-col transform transition-transform duration-200 md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-6 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-4 h-4 text-[#C9A44C]" />
            <span
              className="text-[16px] font-bold uppercase text-white tracking-wider"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              Admin Panel
            </span>
          </div>
          <p className="text-[11px] text-white/55">Manage your portal</p>
        </div>

        <div className="p-4">
          <button
            onClick={() => {
              setLocation("/dashboard");
              setSidebarOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-white/65 hover:text-white/70 hover:bg-white/[0.04] transition-colors mb-3"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Portal
          </button>
        </div>

        <nav className="flex-1 px-4 overflow-y-auto">
          <div className="space-y-1">
            {visibleNavItems.map(renderNavButton)}
          </div>
        </nav>

        <div className="p-4 border-t border-white/[0.06]">
          <div className="flex items-center gap-3 mb-3">
            {user?.imageUrl ? (
              <img
                src={user.imageUrl}
                alt={user?.firstName || "Profile"}
                className="w-8 h-8 rounded-full object-cover border border-white/10"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#C9A44C]/20 flex items-center justify-center text-[12px] font-bold text-[#C9A44C]">
                {user?.firstName?.[0] || user?.primaryEmailAddress?.emailAddress?.[0]?.toUpperCase() || "?"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-white truncate">
                {[user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.primaryEmailAddress?.emailAddress || "User"}
              </p>
              <p className="text-[11px] text-white/55 truncate">
                {user?.primaryEmailAddress?.emailAddress || ""}
              </p>
            </div>
          </div>
          <div className="space-y-1">
            <button
              onClick={() => {
                setLocation("/settings");
                setSidebarOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-white/65 hover:text-white/70 hover:bg-white/[0.04] transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              Settings
            </button>
            <button
              onClick={async () => {
                await stopImpersonationBeforeSignOut().catch(() => {});
                await signOut();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-white/65 hover:text-white/70 hover:bg-white/[0.04] transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-4 left-4 z-[60] md:hidden bg-[#0a0a0a] border border-white/[0.06] rounded-lg p-2"
      >
        {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="flex-1 md:ml-[260px] min-h-screen">{children}</main>
    </div>
  );
}
