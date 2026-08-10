import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Crown,
  Calendar as CalendarIcon,
  Video,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Clock,
  ArrowLeft,
  PlayCircle,
  Link as LinkIcon,
  CheckCircle2,
  Users as UsersIcon,
  Download,
  FileText,
  FolderOpen,
  Music,
  FileArchive,
  Image as ImageIcon,
  CopyPlus,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
} from "lucide-react";
import { WistiaPlayer } from "@/components/wistia-player";
import { AdvertorialTemplateLibrary } from "@/pages/dfy/advertorial-template-library";
import type {
  WorkshopRecordingMember,
  PlatinumClubResource,
  PlatinumClubAdminResource,
  PlatinumClubBuild,
} from "@/lib/api";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const STRIPE_CUSTOMER_PORTAL_URL = "https://billing.stripe.com/p/login/9B6dR881G2rbgzAdd6cV200";

const DELIVERABLES: { name: string; value: string }[] = [
  { name: "A Brand New Custom Digital Product Built For You Every Month", value: "$997" },
  { name: "Niche Research & Validation", value: "$147" },
  { name: "Offer Creation", value: "$297" },
  { name: "Offer Tested & Validated With $1K Ad Spend", value: "$1,000" },
  { name: "1 X Full Custom Sales Page", value: "$497" },
  { name: "Full 7-Step Funnel + Sales Copy Plugged Straight Into Your System", value: "$597" },
  { name: "All Sales Copy Written", value: "Included" },
  { name: "2 X Order Bump Product Creation (DFY Video Courses, Templates & More)", value: "$197" },
  { name: "2 X Upsells Product Creation (DFY Video Courses, Templates & More)", value: "$297" },
  { name: "$1.5K Backend High Ticket Offers", value: "$1,500" },
  { name: "5+ Sales Email Sequence Written", value: "$197" },
  { name: "10+ Page Research Doc", value: "$97" },
  { name: "In-Depth Research Docs, Bridge Pages & Offer Breakdowns", value: "$147" },
  { name: "10+ Custom Graphics", value: "$147" },
  { name: "20+ DFY Meta Static Ad Creatives To Upload (Ones We Used To Validate Offer)", value: "$297" },
  { name: "15 X Google Ad Copy", value: "$97" },
  { name: "50 Ready-To-Use Ads Per Month - Full Scripts & Creative Assets Included, Ready To Plug Into Your Ad Account", value: "$297" },
  { name: "90 Done-For-You AI Avatar Video Script Per Month (3/Day) - Each One Tagged By Content Type (Podcast Clip, Green Screen, Hook + Demo, Selfie Yapping, Viral Carousel, Etc.) - Just Run Them Through Your AI Influencer", value: "$797" },
  { name: "Private 2-Hour Live Workshop With Your Coach Every Month", value: "$497" },
  { name: "Members-Only Custom Funnel For One Of Our Own AI Influencer Portfolio Products You Can Promote (Platinum Only - Not Available Anywhere Else)", value: "$1,997" },
  { name: "New Assets Stacking Into Your Portal Every Single Month", value: "Included" },
];

const BONUSES: { name: string; value: string }[] = [
  { name: "Our Top 20 Performing Ads Scripts From Our Own Ad Account, Delivered Into Your Portal Every Month (Recreate With Your Avatar)", value: "$497" },
  { name: "Every Ad Comes With The Full Script & Creative Assets We Used To Run It", value: "$197" },
  { name: "Ready To Recreate On Your Own AI Influencer For The Same Offers You Are Promoting", value: "Priceless" },
];

function getNextDropTarget(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
}

function computeCountdown(now: Date, target: Date) {
  const diffMs = Math.max(0, target.getTime() - now.getTime());
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds, done: diffMs === 0 };
}

function CountdownCell({ value, label }: { value: number; label: string }) {
  const padded = String(value).padStart(2, "0");
  return (
    <div className="flex flex-col items-center">
      <div
        className="min-w-[64px] md:min-w-[88px] px-3 md:px-5 py-3 md:py-4 rounded-xl bg-black/40 border border-[#C9A44C]/25 text-center"
        style={{ boxShadow: "inset 0 0 0 1px rgba(201,164,76,0.08)" }}
      >
        <span
          className="block font-bold text-white tabular-nums leading-none"
          style={{ fontSize: "clamp(28px, 5vw, 44px)", fontFamily: "var(--app-font-display)" }}
        >
          {padded}
        </span>
      </div>
      <span className="mt-2 text-[10px] md:text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">
        {label}
      </span>
    </div>
  );
}

type TabKey = "overview" | "blueprint" | "workshops" | "recordings" | "templates";
export default function PlatinumClub() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { data: me, isLoading: meLoading } = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const userFlags = me?.user as
    | { platinumPaid?: boolean; upsell3Paid?: boolean }
    | undefined;
  const paid = !!(userFlags?.platinumPaid || userFlags?.upsell3Paid);
  const isAdmin = me?.user?.role === "admin";
  const hasAccess = paid || isAdmin;

  useEffect(() => {
    if (!meLoading && !hasAccess) setLocation("/dashboard");
  }, [meLoading, hasAccess, setLocation]);

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const tabParam = params.get("tab");
  const tab: TabKey =
    tabParam === "blueprint"
      ? "blueprint"
      : tabParam === "workshops"
        ? "workshops"
        : tabParam === "recordings"
          ? "recordings"
          : tabParam === "templates"
            ? "templates"
            : "overview";
  const recordingIdParam = params.get("recording");
  const selectedRecordingId =
    recordingIdParam && /^\d+$/.test(recordingIdParam)
      ? Number(recordingIdParam)
      : null;

  const setTab = (next: TabKey) => {
    const sp = new URLSearchParams(search);
    if (next === "overview") sp.delete("tab");
    else sp.set("tab", next);
    const qs = sp.toString();
    setLocation(`/platinum-club${qs ? `?${qs}` : ""}`);
  };

  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const target = useMemo(() => getNextDropTarget(now), [now]);
  const { days, hours, minutes, seconds } = computeCountdown(now, target);

  const targetLabel = useMemo(() => {
    const lastDay = new Date(target.getTime() - 1);
    return lastDay.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }, [target]);

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
            Platinum Club
          </h1>
          <p className="text-[14.5px] text-white/55 leading-[1.65] max-w-[680px]">
            Inner-circle group with the highest-touch coaching and direct access to our team.
          </p>
          {paid && <ManageSubscriptionLink />}
        </div>

        {meLoading || !hasAccess ? (
          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
            <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="mb-6 border-b border-white/[0.08] flex items-center gap-1">
              <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
                Overview
              </TabButton>
              <TabButton active={tab === "blueprint"} onClick={() => setTab("blueprint")}>
                DFY Builds
              </TabButton>
              <TabButton active={tab === "workshops"} onClick={() => setTab("workshops")}>
                Workshops
              </TabButton>
              <TabButton active={tab === "recordings"} onClick={() => setTab("recordings")}>
                Recordings
              </TabButton>
              <TabButton active={tab === "templates"} onClick={() => setTab("templates")}>
                Templates
              </TabButton>
            </div>

            {tab === "overview" ? (
              <OverviewTab
                days={days}
                hours={hours}
                minutes={minutes}
                seconds={seconds}
                targetLabel={targetLabel}
              />
            ) : tab === "blueprint" ? (
              <BlueprintTab isAdmin={isAdmin} />
            ) : tab === "workshops" ? (
              <WorkshopsTab isAdmin={isAdmin} />
            ) : tab === "templates" ? (
              <TemplatesTab />
            ) : (
              <RecordingsTab
                selectedRecordingId={selectedRecordingId}
                onOpenRecording={(id) => {
                  const sp = new URLSearchParams(search);
                  sp.set("tab", "recordings");
                  sp.set("recording", String(id));
                  setLocation(`/platinum-club?${sp.toString()}`);
                }}
                onCloseRecording={() => {
                  const sp = new URLSearchParams(search);
                  sp.delete("recording");
                  sp.set("tab", "recordings");
                  setLocation(`/platinum-club?${sp.toString()}`);
                }}
              />
            )}
          </>
        )}
      </div>
    </PortalLayout>
  );
}

function ManageSubscriptionLink() {
  return (
    <a
      href={STRIPE_CUSTOMER_PORTAL_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-[0.14em] text-[#C9A44C] border border-[#C9A44C]/35 hover:border-[#C9A44C] hover:bg-[#C9A44C]/10 transition-colors"
      style={{ fontFamily: "var(--app-font-display)" }}
    >
      <ExternalLink className="w-3.5 h-3.5" />
      Manage subscription
    </a>
  );
}
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 md:px-5 py-3 text-[13px] font-bold uppercase tracking-[0.14em] transition-colors border-b-2 -mb-px ${
        active
          ? "text-[#C9A44C] border-[#C9A44C]"
          : "text-white/55 border-transparent hover:text-white/80"
      }`}
      style={{ fontFamily: "var(--app-font-display)" }}
    >
      {children}
    </button>
  );
}

function OverviewTab({
  days,
  hours,
  minutes,
  seconds,
  targetLabel,
}: {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  targetLabel: string;
}) {
  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl p-7 md:p-10 text-center"
        style={{
          background:
            "linear-gradient(180deg, rgba(201,164,76,0.10) 0%, rgba(201,164,76,0.03) 100%)",
          border: "1px solid rgba(201,164,76,0.30)",
          boxShadow: "0 0 60px rgba(201,164,76,0.10)",
        }}
      >
        <Crown className="w-8 h-8 text-[#C9A44C] mx-auto mb-3 opacity-90" />
        <p className="text-[10px] md:text-[11px] font-bold uppercase tracking-[0.22em] text-[#C9A44C] mb-2">
          Next Drop
        </p>
        <h2
          className="text-white font-bold uppercase leading-[1.15] mb-2"
          style={{ fontSize: "clamp(20px, 3vw, 28px)", fontFamily: "var(--app-font-display)" }}
        >
          Next Platinum Club Drop
        </h2>
        <p className="text-[13.5px] md:text-[14.5px] text-white/65 leading-[1.6] max-w-[560px] mx-auto mb-6">
          Next Platinum Club being released inside the portal at midnight on the last day of each month.
        </p>

        <div className="flex items-center justify-center gap-3 md:gap-5 mb-5">
          <CountdownCell value={days} label="Days" />
          <CountdownCell value={hours} label="Hours" />
          <CountdownCell value={minutes} label="Minutes" />
          <CountdownCell value={seconds} label="Seconds" />
        </div>

        <p className="text-[12px] md:text-[12.5px] text-white/45">
          Drops at midnight on {targetLabel} (your local time)
        </p>
      </div>

      <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="px-6 md:px-8 py-5 border-b border-white/[0.06] flex items-center gap-3">
          <span className="w-7 h-7 rounded-full flex items-center justify-center bg-[#C9A44C]/15 border border-[#C9A44C]/30">
            <Crown className="w-4 h-4 text-[#C9A44C]" />
          </span>
          <h3
            className="text-white font-bold uppercase tracking-[0.04em]"
            style={{ fontSize: "clamp(15px, 2vw, 18px)", fontFamily: "var(--app-font-display)" }}
          >
            What You Get Every Month
          </h3>
        </div>
        <ul className="divide-y divide-white/[0.06]">
          {DELIVERABLES.map((item) => (
            <li
              key={item.name}
              className="px-6 md:px-8 py-3.5 flex items-start md:items-center justify-between gap-4"
            >
              <div className="flex items-start gap-3 min-w-0">
                <span className="mt-0.5 w-5 h-5 rounded flex items-center justify-center bg-[#C9A44C]/15 border border-[#C9A44C]/30 flex-shrink-0">
                  <Check className="w-3 h-3 text-[#C9A44C]" strokeWidth={3} />
                </span>
                <span className="text-[13.5px] md:text-[14px] text-white/85 leading-[1.55]">
                  {item.name}
                </span>
              </div>
              <span className="text-[12.5px] md:text-[13px] font-bold text-[#C9A44C] whitespace-nowrap">
                Value: {item.value}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="px-6 md:px-8 py-5 border-b border-white/[0.06] flex items-center gap-3">
          <span className="w-7 h-7 rounded-full flex items-center justify-center bg-[#C9A44C]/15 border border-[#C9A44C]/30">
            <Crown className="w-4 h-4 text-[#C9A44C]" />
          </span>
          <h3
            className="text-white font-bold uppercase tracking-[0.04em]"
            style={{ fontSize: "clamp(15px, 2vw, 18px)", fontFamily: "var(--app-font-display)" }}
          >
            Plus Member Bonuses
          </h3>
        </div>
        <ul className="divide-y divide-white/[0.06]">
          {BONUSES.map((item) => (
            <li
              key={item.name}
              className="px-6 md:px-8 py-3.5 flex items-start md:items-center justify-between gap-4"
            >
              <div className="flex items-start gap-3 min-w-0">
                <span className="mt-0.5 w-5 h-5 rounded flex items-center justify-center bg-[#C9A44C]/15 border border-[#C9A44C]/30 flex-shrink-0">
                  <Check className="w-3 h-3 text-[#C9A44C]" strokeWidth={3} />
                </span>
                <span className="text-[13.5px] md:text-[14px] text-white/85 leading-[1.55]">
                  {item.name}
                </span>
              </div>
              <span className="text-[12.5px] md:text-[13px] font-bold text-[#C9A44C] whitespace-nowrap">
                Value: {item.value}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type BlueprintSectionDef = { key: string; label: string };
type BlueprintBuildDef = { key: string; label: string; sections: BlueprintSectionDef[] };

// DFY Builds: the Blueprint tab is organized into time-stamped "builds", each
// a self-contained done-for-you library. May 2026 is the original Agency
// Growth Blueprint. Later builds (e.g. the June 2026 Launchpad) use distinct
// section keys (prefixed) so a resource is never ambiguous about which build it
// belongs to. Admins assign a resource to a build by picking one of that
// build's sections in the Add/Edit Resource form - no code change needed.
const BLUEPRINT_BUILDS: BlueprintBuildDef[] = [
  {
    key: "may_2026",
    label: "May 2026 - Agency Growth Blueprint",
    sections: [
      { key: "main_offer", label: "Main Offer" },
      { key: "bonuses", label: "Bonuses" },
      { key: "bumps", label: "Order Bumps" },
      { key: "upsells", label: "Upsells" },
      { key: "creation_assets", label: "Creation Assets" },
      { key: "content_scripts", label: "Content Scripts" },
      { key: "ads", label: "Ads Library" },
      { key: "sales_assets", label: "Sales Assets" },
      { key: "top_ads", label: "Top 20 Ads" },
      { key: "custom_graphics", label: "Custom Graphics" },
    ],
  },
  {
    key: "june_2026",
    label: "June 2026 - The First-Time Entrepreneur Launchpad",
    sections: [
      { key: "launchpad_main_offer", label: "Main Offer" },
      { key: "launchpad_bonuses", label: "Bonuses" },
      { key: "launchpad_bumps", label: "Order Bumps" },
      { key: "launchpad_upsells", label: "Upsells" },
      { key: "launchpad_creation_assets", label: "Creation Assets" },
      { key: "launchpad_content_scripts", label: "Content Scripts" },
      { key: "launchpad_ads", label: "Ads Library" },
      { key: "launchpad_sales_assets", label: "Sales Assets" },
      { key: "launchpad_top_ads", label: "Top 20 Ads" },
      { key: "launchpad_custom_graphics", label: "Custom Graphics" },
    ],
  },
];

// Flattened section list - preserves the existing label-lookup and known-key
// behaviour the rest of the tab relies on.
const BLUEPRINT_SECTION_ORDER: BlueprintSectionDef[] = BLUEPRINT_BUILDS.flatMap(
  (b) => b.sections,
);

function blueprintResourceIcon(type: string) {
  switch (type) {
    case "video":
      return PlayCircle;
    case "audio":
      return Music;
    case "link":
      return LinkIcon;
    case "image":
      return ImageIcon;
    case "archive":
      return FileArchive;
    case "folder":
      return FolderOpen;
    case "one_click_install":
      return CopyPlus;
    default:
      return FileText;
  }
}

function BlueprintResourceCard({ resource }: { resource: PlatinumClubResource }) {
  const Icon = blueprintResourceIcon(resource.resourceType);
  const hasDownload = !!resource.downloadUrl;
  const hasExternal = !!resource.externalUrl;
  const isOneClickInstall = resource.resourceType === "one_click_install";
  return (
    <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl overflow-hidden flex flex-col hover:border-[#C9A44C]/30 transition-colors">
      <div className="relative aspect-[16/10] bg-black/40 flex items-center justify-center overflow-hidden">
        {resource.coverUrl ? (
          <img
            src={resource.coverUrl}
            alt={resource.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <Icon className="w-9 h-9 text-[#C9A44C]/50" />
        )}
      </div>
      <div className="p-4 md:p-5 flex flex-col flex-1">
        <h4 className="text-white font-bold text-[14px] md:text-[15px] leading-[1.3] mb-1.5">
          {resource.title}
        </h4>
        {resource.description && (
          <p className="text-[12.5px] md:text-[13px] text-white/55 leading-[1.55] mb-4 flex-1">
            {resource.description}
          </p>
        )}
        <div className="mt-auto flex flex-wrap gap-2">
          {hasDownload && (
            <a
              href={resource.downloadUrl!}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[11px] font-bold uppercase tracking-[0.12em] text-black bg-[#C9A44C] hover:bg-[#d8b65e] transition-colors"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
          )}
          {hasExternal &&
            (isOneClickInstall ? (
              <a
                href={resource.externalUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[11px] font-bold uppercase tracking-[0.12em] text-black bg-[#C9A44C] hover:bg-[#d8b65e] transition-colors"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                <CopyPlus className="w-3.5 h-3.5" />
                Install in GHL
              </a>
            ) : (
              <a
                href={resource.externalUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[11px] font-bold uppercase tracking-[0.12em] text-[#C9A44C] border border-[#C9A44C]/35 hover:border-[#C9A44C] hover:bg-[#C9A44C]/10 transition-colors"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open
              </a>
            ))}
        </div>
      </div>
    </div>
  );
}

function BlueprintTab({ isAdmin }: { isAdmin: boolean }) {
  if (isAdmin) return <BlueprintAdmin />;
  return <BlueprintMemberView />;
}

// Templates tab: reuses the same ready-to-use advertorial template library
// that ships with the DFY Pack, listed identically.
function TemplatesTab() {
  return (
    <div>
      <div className="mb-8">
        <h2
          className="text-[22px] md:text-[26px] font-bold uppercase tracking-[0.01em] text-white leading-[1.1] mb-2"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          Advertorial Templates
        </h2>
        <p className="text-[13.5px] text-white/60 leading-[1.65] max-w-[680px]">
          Ready-to-use advertorial page templates pre-built to warm cold traffic
          before your offer. Preview any template, copy or download the
          self-contained HTML, then swap the bracket placeholders for your own
          copy, links and images.
        </p>
      </div>
      <AdvertorialTemplateLibrary />
    </div>
  );
}

function BlueprintMemberView() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["platinum-club-resources"],
    queryFn: api.getPlatinumClubResources,
  });

  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Collapsible build state. Builds with content default to expanded; empty
  // builds (e.g. a future build with nothing added yet) default collapsed.
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
  const isBuildOpen = (key: string, hasItems: boolean) =>
    openOverrides[key] ?? hasItems;
  const toggleBuild = (key: string, hasItems: boolean) =>
    setOpenOverrides((o) => ({ ...o, [key]: !(o[key] ?? hasItems) }));

  if (isLoading) {
    return (
      <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
        <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
        <p className="text-[14px] text-white/60">
          We could not load the DFY Builds right now. Please refresh and try again.
        </p>
      </div>
    );
  }

  const { isLive, canPreview, resources, dropAtIso } = data;

  // Server-driven builds are the source of truth; fall back to the hardcoded
  // BLUEPRINT_BUILDS only if the API returned none (e.g. older API build).
  const buildDefs: BlueprintBuildDef[] =
    data.builds && data.builds.length > 0
      ? data.builds.map((b) => ({
          key: b.slug,
          label: b.label,
          sections: b.sections,
        }))
      : BLUEPRINT_BUILDS;
  const sectionOrder: BlueprintSectionDef[] = buildDefs.flatMap((b) => b.sections);

  if (!isLive && !canPreview) {
    const target = new Date(dropAtIso);
    const { days, hours, minutes, seconds } = computeCountdown(now, target);
    const targetLabel = target.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    return (
      <div
        className="rounded-2xl p-7 md:p-10 text-center"
        style={{
          background:
            "linear-gradient(180deg, rgba(201,164,76,0.10) 0%, rgba(201,164,76,0.03) 100%)",
          border: "1px solid rgba(201,164,76,0.30)",
          boxShadow: "0 0 60px rgba(201,164,76,0.10)",
        }}
      >
        <Crown className="w-8 h-8 text-[#C9A44C] mx-auto mb-3 opacity-90" />
        <p className="text-[10px] md:text-[11px] font-bold uppercase tracking-[0.22em] text-[#C9A44C] mb-2">
          Dropping Soon
        </p>
        <h2
          className="text-white font-bold uppercase leading-[1.15] mb-2"
          style={{ fontSize: "clamp(20px, 3vw, 28px)", fontFamily: "var(--app-font-display)" }}
        >
          DFY Builds
        </h2>
        <p className="text-[13.5px] md:text-[14.5px] text-white/65 leading-[1.6] max-w-[560px] mx-auto mb-6">
          The full DFY Builds library unlocks here on launch. Everything you need to
          build, fill, and scale your offer.
        </p>
        <div className="flex items-center justify-center gap-3 md:gap-5 mb-5">
          <CountdownCell value={days} label="Days" />
          <CountdownCell value={hours} label="Hours" />
          <CountdownCell value={minutes} label="Minutes" />
          <CountdownCell value={seconds} label="Seconds" />
        </div>
        <p className="text-[12px] md:text-[12.5px] text-white/45">
          Unlocks at midnight on {targetLabel} (your local time)
        </p>
      </div>
    );
  }

  // Group resources into builds, then into the build's sections. Empty
  // sections are hidden; a build with no resources still renders (collapsed)
  // so members can see it's coming.
  const buildGroups = buildDefs.map((build) => {
    const sections = build.sections
      .map((s) => ({
        key: s.key,
        label: s.label,
        items: resources.filter((r) => r.section === s.key),
      }))
      .filter((s) => s.items.length > 0);
    return {
      key: build.key,
      label: build.label,
      sections,
      total: sections.reduce((n, s) => n + s.items.length, 0),
    };
  });

  // Any resource on an unknown section key (e.g. a legacy/manual section)
  // still surfaces under an "Other" build so nothing is silently hidden.
  const knownKeys = new Set(sectionOrder.map((s) => s.key));
  const extras = resources.filter((r) => !knownKeys.has(r.section));
  if (extras.length > 0) {
    const extraKeys = Array.from(new Set(extras.map((r) => r.section)));
    buildGroups.push({
      key: "other",
      label: "Other",
      sections: extraKeys.map((key) => ({
        key,
        label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        items: extras.filter((r) => r.section === key),
      })),
      total: extras.length,
    });
  }

  const hasAnything = buildGroups.some((b) => b.total > 0);

  return (
    <div className="space-y-6">
      {canPreview && (
        <div className="rounded-xl px-5 py-3.5 bg-[#C9A44C]/10 border border-[#C9A44C]/30 text-[12.5px] md:text-[13px] text-[#C9A44C] font-bold uppercase tracking-[0.06em]">
          Admin preview - this library is not yet live for members.
        </div>
      )}
      <div
        className="rounded-2xl p-6 md:p-8"
        style={{
          background:
            "linear-gradient(180deg, rgba(201,164,76,0.10) 0%, rgba(201,164,76,0.03) 100%)",
          border: "1px solid rgba(201,164,76,0.30)",
        }}
      >
        <Crown className="w-7 h-7 text-[#C9A44C] mb-3 opacity-90" />
        <h2
          className="text-white font-bold uppercase leading-[1.15] mb-2"
          style={{ fontSize: "clamp(20px, 3vw, 28px)", fontFamily: "var(--app-font-display)" }}
        >
          DFY Builds
        </h2>
        <p className="text-[13.5px] md:text-[14.5px] text-white/65 leading-[1.6] max-w-[680px]">
          Complete done-for-you build libraries - each a full system you can deploy. Expand a
          build below to download everything: offers, bonuses, ad creative, scripts, and sales
          assets.
        </p>
      </div>

      {!hasAnything ? (
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
          <p className="text-[14px] text-white/60">
            The DFY Builds library is being prepared. Check back shortly.
          </p>
        </div>
      ) : (
        buildGroups.map((build) => {
          const open = isBuildOpen(build.key, build.total > 0);
          return (
            <div
              key={build.key}
              className="rounded-2xl border border-white/[0.08] bg-[#0f0f0f] overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggleBuild(build.key, build.total > 0)}
                className="w-full flex items-center gap-3 px-5 md:px-6 py-4 text-left hover:bg-white/[0.02] transition-colors"
                aria-expanded={open}
              >
                <span className="w-8 h-8 rounded-full flex items-center justify-center bg-[#C9A44C]/15 border border-[#C9A44C]/30 flex-shrink-0">
                  <Crown className="w-4 h-4 text-[#C9A44C]" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3
                    className="text-white font-bold uppercase tracking-[0.03em] leading-tight"
                    style={{
                      fontSize: "clamp(14px, 2vw, 18px)",
                      fontFamily: "var(--app-font-display)",
                    }}
                  >
                    {build.label}
                  </h3>
                  <p className="text-[11.5px] text-white/40 mt-0.5">
                    {build.total} resource{build.total === 1 ? "" : "s"}
                  </p>
                </div>
                <ChevronDown
                  className={cn(
                    "w-5 h-5 text-white/40 flex-shrink-0 transition-transform",
                    open && "rotate-180",
                  )}
                />
              </button>

              {open && (
                <div className="px-5 md:px-6 pb-6 pt-2 space-y-7 border-t border-white/[0.06]">
                  {build.sections.length === 0 ? (
                    <p className="text-[13px] text-white/45 py-2">
                      This build is being prepared. Check back shortly.
                    </p>
                  ) : (
                    build.sections.map((section) => (
                      <div key={section.key}>
                        <div className="flex items-center gap-3 mb-4">
                          <h4
                            className="text-white font-bold uppercase tracking-[0.04em]"
                            style={{
                              fontSize: "clamp(13px, 1.8vw, 16px)",
                              fontFamily: "var(--app-font-display)",
                            }}
                          >
                            {section.label}
                          </h4>
                          <span className="text-[12px] text-white/40">
                            {section.items.length}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {section.items.map((resource) => (
                            <BlueprintResourceCard key={resource.id} resource={resource} />
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

const BLUEPRINT_RESOURCE_TYPES: { value: string; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "Word doc (DOCX)" },
  { value: "audio", label: "Audio" },
  { value: "zip", label: "ZIP bundle" },
  { value: "google_doc", label: "Google Doc" },
  { value: "drive_folder", label: "Drive folder" },
  { value: "link", label: "Link / page" },
  { value: "image", label: "Image" },
  { value: "one_click_install", label: "1-Click Install (GHL Snapshot)" },
];

function blueprintTypeLabel(type: string): string {
  return BLUEPRINT_RESOURCE_TYPES.find((t) => t.value === type)?.label ?? type;
}

// Admin view of the Blueprint library: add / edit / reorder / delete resources
// with no code change. Backed by the /platinum-club/admin/resources endpoints.
function BlueprintAdmin() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["platinum-club-admin-resources"],
    queryFn: api.adminListPlatinumClubResources,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PlatinumClubAdminResource | null>(null);
  const [createSection, setCreateSection] = useState<string>("main_offer");
  const [buildDialogOpen, setBuildDialogOpen] = useState(false);
  const [editingBuild, setEditingBuild] = useState<PlatinumClubBuild | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["platinum-club-admin-resources"] });
    qc.invalidateQueries({ queryKey: ["platinum-club-resources"] });
  };

  // Server builds (all, incl. hidden) drive the admin taxonomy + the section
  // dropdown. Falls back to the hardcoded list only if the API returned none.
  const serverBuilds = data?.builds ?? [];

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.adminDeletePlatinumClubResource(id),
    onSuccess: () => {
      invalidate();
      toast({ title: "Resource deleted" });
    },
    onError: (e: unknown) =>
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const reorderMut = useMutation({
    mutationFn: (vars: { section: string; orderedIds: number[] }) =>
      api.adminReorderPlatinumClubResources(vars.section, vars.orderedIds),
    onSuccess: () => invalidate(),
    onError: (e: unknown) =>
      toast({
        title: "Reorder failed",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const toggleActiveMut = useMutation({
    mutationFn: (vars: { id: number; isActive: boolean }) =>
      api.adminUpdatePlatinumClubResource(vars.id, { isActive: vars.isActive }),
    onSuccess: () => invalidate(),
    onError: (e: unknown) =>
      toast({
        title: "Update failed",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const buildReorderMut = useMutation({
    mutationFn: (orderedIds: number[]) =>
      api.adminReorderPlatinumClubBuilds(orderedIds),
    onSuccess: () => invalidate(),
    onError: (e: unknown) =>
      toast({
        title: "Reorder failed",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const buildToggleActiveMut = useMutation({
    mutationFn: (vars: { id: number; isActive: boolean }) =>
      api.adminUpdatePlatinumClubBuild(vars.id, { isActive: vars.isActive }),
    onSuccess: () => invalidate(),
    onError: (e: unknown) =>
      toast({
        title: "Update failed",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const buildDeleteMut = useMutation({
    mutationFn: (id: number) => api.adminDeletePlatinumClubBuild(id),
    onSuccess: () => {
      invalidate();
      toast({ title: "Build deleted" });
    },
    onError: (e: unknown) =>
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const resources = data?.resources ?? [];

  // Admin taxonomy: server builds (incl. hidden) carry id/isActive so they can
  // be managed inline. Each build keeps a `buildId` (null for the synthetic
  // "Other" bucket + the hardcoded fallback, which are not editable).
  const buildGroups = useMemo(() => {
    const buildDefs =
      serverBuilds.length > 0
        ? serverBuilds.map((b) => ({
            key: b.slug,
            label: b.label,
            buildId: b.id,
            isActive: b.isActive,
            sections: b.sections,
          }))
        : BLUEPRINT_BUILDS.map((b) => ({
            key: b.key,
            label: b.label,
            buildId: null as number | null,
            isActive: true,
            sections: b.sections,
          }));
    const known = new Set(buildDefs.flatMap((b) => b.sections.map((s) => s.key)));
    const groups = buildDefs.map((build) => ({
      key: build.key,
      label: build.label,
      buildId: build.buildId,
      isActive: build.isActive,
      sections: build.sections.map((s) => ({
        key: s.key,
        label: s.label,
        items: resources
          .filter((r) => r.section === s.key)
          .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id),
      })),
    }));
    const extras = resources.filter((r) => !known.has(r.section));
    if (extras.length > 0) {
      const extraKeys = Array.from(new Set(extras.map((r) => r.section)));
      groups.push({
        key: "other",
        label: "Other",
        buildId: null,
        isActive: true,
        sections: extraKeys.map((key) => ({
          key,
          label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          items: extras
            .filter((r) => r.section === key)
            .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id),
        })),
      });
    }
    return groups;
  }, [resources, serverBuilds]);

  // Build reorder helper - swaps two server builds and persists the new order.
  const moveBuild = (index: number, dir: -1 | 1) => {
    const ids = serverBuilds.map((b) => b.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    buildReorderMut.mutate(ids);
  };

  const move = (
    section: string,
    items: PlatinumClubAdminResource[],
    index: number,
    dir: -1 | 1,
  ) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const ids = items.map((i) => i.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderMut.mutate({ section, orderedIds: ids });
  };

  const onCreate = (section: string) => {
    setEditing(null);
    setCreateSection(section);
    setDialogOpen(true);
  };
  const onEdit = (r: PlatinumClubAdminResource) => {
    setEditing(r);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl px-5 py-3.5 bg-[#C9A44C]/10 border border-[#C9A44C]/30 text-[12.5px] md:text-[13px] text-[#C9A44C]">
        <span className="font-bold uppercase tracking-[0.06em]">Admin - Manage Library.</span>{" "}
        Add, edit, reorder, and hide DFY Build resources here. A resource belongs to whichever
        build its section is under - pick the matching build's section in the form. Changes go
        live for members instantly (no deploy). Hidden resources stay invisible to members.
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h2
            className="text-white font-bold uppercase leading-[1.15]"
            style={{ fontSize: "clamp(18px, 2.5vw, 24px)", fontFamily: "var(--app-font-display)" }}
          >
            DFY Builds
          </h2>
          <p className="text-[12.5px] text-white/50 mt-1">
            {resources.length} resource{resources.length === 1 ? "" : "s"} across the library.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="outline"
            onClick={() => {
              setEditingBuild(null);
              setBuildDialogOpen(true);
            }}
            className="border-[#C9A44C]/40 text-[#C9A44C] hover:bg-[#C9A44C]/10 hover:text-[#C9A44C] gap-2 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add Build
          </Button>
          <Button
            onClick={() => onCreate(buildGroups[0]?.sections[0]?.key ?? "main_offer")}
            className="bg-[#C9A44C] text-black hover:bg-[#d8b566] gap-2 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add Resource
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
          <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
        </div>
      ) : error ? (
        <div className="bg-[#0f0f0f] border border-red-500/30 rounded-2xl p-6 text-center text-[13px] text-red-300">
          Failed to load the library. Refresh and try again.
        </div>
      ) : (
        <div className="space-y-10">
          {buildGroups.map((build) => {
            const buildTotal = build.sections.reduce((n, s) => n + s.items.length, 0);
            const serverIdx = serverBuilds.findIndex((b) => b.id === build.buildId);
            const manageable = build.buildId != null && serverIdx >= 0;
            return (
              <div key={build.key} className="space-y-7">
                <div
                  className={cn(
                    "flex items-center gap-3 pb-2 border-b border-[#C9A44C]/20",
                    !build.isActive && "opacity-60",
                  )}
                >
                  <Crown className="w-4 h-4 text-[#C9A44C] flex-shrink-0" />
                  <h3
                    className="text-[#C9A44C] font-bold uppercase tracking-[0.06em] leading-tight"
                    style={{
                      fontSize: "clamp(13px, 2vw, 16px)",
                      fontFamily: "var(--app-font-display)",
                    }}
                  >
                    {build.label}
                  </h3>
                  {!build.isActive && (
                    <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-white/45 border border-white/15 rounded-full px-2 py-0.5">
                      Hidden
                    </span>
                  )}
                  <span className="text-[11.5px] text-white/40">
                    {buildTotal} resource{buildTotal === 1 ? "" : "s"}
                  </span>

                  {manageable && (
                    <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => moveBuild(serverIdx, -1)}
                        disabled={serverIdx === 0 || buildReorderMut.isPending}
                        className="p-1.5 rounded-lg text-white/45 hover:text-[#C9A44C] hover:bg-white/[0.04] transition-colors disabled:opacity-25"
                        title="Move build up"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => moveBuild(serverIdx, 1)}
                        disabled={
                          serverIdx === serverBuilds.length - 1 || buildReorderMut.isPending
                        }
                        className="p-1.5 rounded-lg text-white/45 hover:text-[#C9A44C] hover:bg-white/[0.04] transition-colors disabled:opacity-25"
                        title="Move build down"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() =>
                          buildToggleActiveMut.mutate({
                            id: build.buildId as number,
                            isActive: !build.isActive,
                          })
                        }
                        disabled={buildToggleActiveMut.isPending}
                        className="p-1.5 rounded-lg text-white/55 hover:text-[#C9A44C] hover:bg-white/[0.04] transition-colors disabled:opacity-40"
                        title={build.isActive ? "Hide build from members" : "Show build to members"}
                      >
                        {build.isActive ? (
                          <Eye className="w-4 h-4" />
                        ) : (
                          <EyeOff className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          const sb = serverBuilds[serverIdx];
                          if (sb) {
                            setEditingBuild(sb);
                            setBuildDialogOpen(true);
                          }
                        }}
                        className="p-1.5 rounded-lg text-white/55 hover:text-[#C9A44C] hover:bg-white/[0.04] transition-colors"
                        title="Rename build"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (buildTotal > 0) {
                            toast({
                              title: "Build not empty",
                              description:
                                "Move or delete this build's resources before deleting the build.",
                              variant: "destructive",
                            });
                            return;
                          }
                          if (
                            confirm(
                              `Delete the build "${build.label}"? This cannot be undone.`,
                            )
                          )
                            buildDeleteMut.mutate(build.buildId as number);
                        }}
                        disabled={buildDeleteMut.isPending}
                        className="p-1.5 rounded-lg text-white/55 hover:text-red-400 hover:bg-white/[0.04] transition-colors disabled:opacity-40"
                        title="Delete build"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {build.sections.map((section) => (
                  <div key={section.key}>
                    <div className="flex items-center gap-3 mb-3">
                      <h4
                        className="text-white font-bold uppercase tracking-[0.04em]"
                        style={{
                          fontSize: "clamp(13px, 1.8vw, 16px)",
                          fontFamily: "var(--app-font-display)",
                        }}
                      >
                        {section.label}
                      </h4>
                      <span className="text-[12px] text-white/40">{section.items.length}</span>
                      <button
                        onClick={() => onCreate(section.key)}
                        className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#C9A44C] border border-[#C9A44C]/35 hover:border-[#C9A44C] hover:bg-[#C9A44C]/10 transition-colors"
                        style={{ fontFamily: "var(--app-font-display)" }}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add
                      </button>
                    </div>

                    {section.items.length === 0 ? (
                      <p className="text-[12.5px] text-white/35 italic px-1 py-2">
                        No resources in this section yet.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {section.items.map((r, idx) => (
                    <li
                      key={r.id}
                      className={cn(
                        "flex items-center gap-3 bg-[#0f0f0f] border border-white/[0.06] rounded-xl px-3 py-2.5",
                        !r.isActive && "opacity-60",
                      )}
                    >
                      <div className="flex flex-col">
                        <button
                          onClick={() => move(section.key, section.items, idx, -1)}
                          disabled={idx === 0 || reorderMut.isPending}
                          className="text-white/40 hover:text-[#C9A44C] disabled:opacity-25 disabled:hover:text-white/40"
                          aria-label="Move up"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => move(section.key, section.items, idx, 1)}
                          disabled={idx === section.items.length - 1 || reorderMut.isPending}
                          className="text-white/40 hover:text-[#C9A44C] disabled:opacity-25 disabled:hover:text-white/40"
                          aria-label="Move down"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-white font-semibold text-[13.5px] leading-tight truncate">
                            {r.title}
                          </span>
                          {!r.isActive && (
                            <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-white/45 border border-white/15 rounded-full px-2 py-0.5">
                              Hidden
                            </span>
                          )}
                        </div>
                        <span className="text-[11.5px] text-white/40">
                          {blueprintTypeLabel(r.resourceType)}
                          {r.driveFileId ? " - Drive file" : r.externalUrl ? " - external link" : ""}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() =>
                            toggleActiveMut.mutate({ id: r.id, isActive: !r.isActive })
                          }
                          disabled={toggleActiveMut.isPending}
                          className="p-2 rounded-lg text-white/55 hover:text-[#C9A44C] hover:bg-white/[0.04] transition-colors disabled:opacity-40"
                          title={r.isActive ? "Hide from members" : "Show to members"}
                        >
                          {r.isActive ? (
                            <Eye className="w-4 h-4" />
                          ) : (
                            <EyeOff className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => onEdit(r)}
                          className="p-2 rounded-lg text-white/55 hover:text-[#C9A44C] hover:bg-white/[0.04] transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete "${r.title}"? This cannot be undone.`))
                              deleteMut.mutate(r.id);
                          }}
                          disabled={deleteMut.isPending}
                          className="p-2 rounded-lg text-white/55 hover:text-red-400 hover:bg-white/[0.04] transition-colors disabled:opacity-40"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                        </li>
                      ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <BlueprintResourceFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        defaultSection={createSection}
        builds={buildGroups
          .filter((b) => b.buildId != null)
          .map((b) => ({
            label: b.label,
            sections: b.sections.map((s) => ({ key: s.key, label: s.label })),
          }))}
        onSaved={() => {
          invalidate();
          setDialogOpen(false);
        }}
      />

      <BlueprintBuildFormDialog
        open={buildDialogOpen}
        onOpenChange={setBuildDialogOpen}
        editing={editingBuild}
        onSaved={() => {
          invalidate();
          setBuildDialogOpen(false);
        }}
      />
    </div>
  );
}

function BlueprintResourceFormDialog({
  open,
  onOpenChange,
  editing,
  defaultSection,
  builds,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: PlatinumClubAdminResource | null;
  defaultSection: string;
  builds: { label: string; sections: { key: string; label: string }[] }[];
  onSaved: () => void;
}) {
  const [section, setSection] = useState<string>(defaultSection);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resourceType, setResourceType] = useState<string>("pdf");
  const [driveFileId, setDriveFileId] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [coverDriveFileId, setCoverDriveFileId] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (open) {
      setSection(editing?.section ?? defaultSection);
      setTitle(editing?.title ?? "");
      setDescription(editing?.description ?? "");
      setResourceType(editing?.resourceType ?? "pdf");
      setDriveFileId(editing?.driveFileId ?? "");
      setExternalUrl(editing?.externalUrl ?? "");
      setCoverDriveFileId(editing?.coverDriveFileId ?? "");
      setIsActive(editing?.isActive ?? true);
    }
  }, [open, editing, defaultSection]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const t = title.trim();
      if (!t) throw new Error("Title is required.");
      if (!driveFileId.trim() && !externalUrl.trim()) {
        throw new Error("Provide either a Drive file id/link or an external URL.");
      }
      const payload = {
        section,
        title: t,
        description: description.trim() || null,
        resourceType,
        driveFileId: driveFileId.trim() || null,
        externalUrl: externalUrl.trim() || null,
        coverDriveFileId: coverDriveFileId.trim() || null,
        isActive,
      };
      if (editing) return api.adminUpdatePlatinumClubResource(editing.id, payload);
      return api.adminCreatePlatinumClubResource(payload);
    },
    onSuccess: () => {
      toast({ title: editing ? "Resource updated" : "Resource added" });
      onSaved();
    },
    onError: (e: unknown) =>
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Resource" : "Add Resource"}</DialogTitle>
          <DialogDescription>
            Drive-hosted files stream securely to members. External URLs open in a new tab.
            Paste a Drive share link or a raw file id - either works.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Section</Label>
            <Select value={section} onValueChange={setSection}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[90]">
                {(builds.length > 0 ? builds : BLUEPRINT_BUILDS).map((build, i) => (
                  <SelectGroup key={build.label + i}>
                    <SelectLabel>{build.label}</SelectLabel>
                    {build.sections.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Agency Growth Blueprint - Ebook (PDF)"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Short summary shown on the resource card."
            />
          </div>

          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={resourceType} onValueChange={setResourceType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[90]">
                {BLUEPRINT_RESOURCE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Drive file id or share link (optional)</Label>
            <Input
              value={driveFileId}
              onChange={(e) => setDriveFileId(e.target.value)}
              placeholder="1AbC... or https://drive.google.com/file/d/..."
            />
            <p className="text-[11px] text-white/40">
              Use this for downloadable files (PDF, DOCX, audio). Streamed securely to members.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>External URL (optional)</Label>
            <Input
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder="https://docs.google.com/... or https://..."
            />
            <p className="text-[11px] text-white/40">
              Use this for Google Docs, Drive folders, page previews, or large ZIP bundles.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Cover image - Drive file id or link (optional)</Label>
            <Input
              value={coverDriveFileId}
              onChange={(e) => setCoverDriveFileId(e.target.value)}
              placeholder="Drive id/link of a cover image"
            />
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 accent-[#C9A44C]"
            />
            <span className="text-[13px] text-white/80">
              Visible to members {isActive ? "" : "(currently hidden)"}
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="bg-[#C9A44C] text-black hover:bg-[#d8b566] gap-2"
          >
            {saveMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {editing ? "Save changes" : "Add resource"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BlueprintBuildFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: PlatinumClubBuild | null;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (open) setLabel(editing?.label ?? "");
  }, [open, editing]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const l = label.trim();
      if (!l) throw new Error("Build name is required.");
      if (editing) {
        await api.adminUpdatePlatinumClubBuild(editing.id, { label: l });
      } else {
        await api.adminCreatePlatinumClubBuild(l);
      }
    },
    onSuccess: () => {
      toast({ title: editing ? "Build renamed" : "Build created" });
      onSaved();
    },
    onError: (e: unknown) =>
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0f0f0f] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle
            className="text-white uppercase"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            {editing ? "Rename Build" : "Add Build"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Build name</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. July 2026 - Scaling Sprint"
              className="bg-[#1a1a1a] border-white/10 text-white"
            />
            {!editing && (
              <p className="text-[11.5px] text-white/40">
                A fresh build starts with the standard set of empty sections. Add
                resources to it from the Add Resource form.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-white/15 text-white/70 hover:bg-white/5 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="bg-[#C9A44C] text-black hover:bg-[#d8b566] gap-2"
          >
            {saveMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {editing ? "Save" : "Create build"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Workshop = {
  id: number;
  title: string;
  description: string | null;
  startsAt: string;
  durationMinutes: number;
  meetingUrl: string;
  recordingUrl: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

// Live workshops are run on the host's UK clock and every reminder email
// renders the time in "Europe/London ... UK time". We anchor the portal
// to the same timezone (NOT the viewer's browser zone) so the schedule a
// member sees here always matches the email to the minute, regardless of
// where they're logging in from. The " UK time" suffix makes the anchor
// explicit for overseas members.
const WORKSHOP_TZ = "Europe/London";

function formatWorkshopDate(iso: string) {
  const d = new Date(iso);
  const londonDay = new Intl.DateTimeFormat("en-GB", {
    timeZone: WORKSHOP_TZ,
    day: "numeric",
  }).format(d);
  const fullNoTz = d.toLocaleString("en-GB", {
    timeZone: WORKSHOP_TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return {
    weekday: d.toLocaleDateString("en-GB", { timeZone: WORKSHOP_TZ, weekday: "short" }),
    month: d.toLocaleDateString("en-GB", { timeZone: WORKSHOP_TZ, month: "short" }),
    day: Number(londonDay),
    time: `${d.toLocaleTimeString("en-GB", { timeZone: WORKSHOP_TZ, hour: "numeric", minute: "2-digit" })} UK time`,
    full: `${fullNoTz} UK time`,
  };
}

function workshopStatus(startsAt: string, durationMinutes: number, now: number) {
  const start = new Date(startsAt).getTime();
  const end = start + durationMinutes * 60_000;
  if (now >= start && now < end) return "live" as const;
  const diffMin = (start - now) / 60_000;
  if (diffMin > 0 && diffMin <= 60) return "soon" as const;
  if (now >= end) return "past" as const;
  return "upcoming" as const;
}

function WorkshopsTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["workshops"],
    queryFn: api.listWorkshops,
  });

  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Workshop | null>(null);

  const workshops = (data?.workshops ?? []) as Workshop[];

  const { upcoming, past } = useMemo(() => {
    const upcoming: Workshop[] = [];
    const past: Workshop[] = [];
    for (const w of workshops) {
      const end = new Date(w.startsAt).getTime() + w.durationMinutes * 60_000;
      if (end >= now) upcoming.push(w);
      else past.push(w);
    }
    upcoming.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    past.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
    return { upcoming, past };
  }, [workshops, now]);

  const next = upcoming[0] ?? null;
  const restUpcoming = upcoming.slice(1);

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteWorkshop(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workshops"] });
      toast({ title: "Workshop deleted" });
    },
    onError: (e: unknown) =>
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const onEdit = (w: Workshop) => {
    setEditing(w);
    setDialogOpen(true);
  };
  const onCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[14px] text-white/65 leading-[1.6] max-w-[640px]">
          Your private 2-hour live workshops with your coach. Join the next call from the link below.
        </p>
        {isAdmin && (
          <Button
            onClick={onCreate}
            className="bg-[#C9A44C] text-black hover:bg-[#d8b566] gap-2 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Schedule Workshop
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
          <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
        </div>
      ) : error ? (
        <div className="bg-[#0f0f0f] border border-red-500/30 rounded-2xl p-6 text-center text-[13px] text-red-300">
          Failed to load workshops.
        </div>
      ) : !next && past.length === 0 ? (
        <div
          className="rounded-2xl p-10 text-center"
          style={{
            background:
              "linear-gradient(180deg, rgba(201,164,76,0.06) 0%, rgba(201,164,76,0.02) 100%)",
            border: "1px solid rgba(201,164,76,0.20)",
          }}
        >
          <CalendarIcon className="w-8 h-8 text-[#C9A44C]/80 mx-auto mb-3" />
          <h3
            className="text-white font-bold uppercase mb-2"
            style={{ fontSize: "18px", fontFamily: "var(--app-font-display)" }}
          >
            No workshops scheduled yet
          </h3>
          <p className="text-[13.5px] text-white/55 max-w-[420px] mx-auto leading-[1.6]">
            The next live call will be posted here. Check back soon.
          </p>
        </div>
      ) : (
        <>
          {next && (
            <NextWorkshopCard
              workshop={next}
              now={now}
              isAdmin={isAdmin}
              onEdit={() => onEdit(next)}
              onDelete={() => {
                if (confirm("Delete this workshop?")) deleteMut.mutate(next.id);
              }}
            />
          )}

          {restUpcoming.length > 0 && (
            <Section title="More Upcoming">
              <ul className="space-y-3">
                {restUpcoming.map((w) => (
                  <WorkshopRow
                    key={w.id}
                    workshop={w}
                    now={now}
                    isAdmin={isAdmin}
                    onEdit={() => onEdit(w)}
                    onDelete={() => {
                      if (confirm("Delete this workshop?")) deleteMut.mutate(w.id);
                    }}
                  />
                ))}
              </ul>
            </Section>
          )}

          {past.length > 0 && (
            <Section title="Past Workshops">
              <ul className="space-y-3">
                {past.map((w) => (
                  <WorkshopRow
                    key={w.id}
                    workshop={w}
                    now={now}
                    isAdmin={isAdmin}
                    onEdit={() => onEdit(w)}
                    onDelete={() => {
                      if (confirm("Delete this workshop?")) deleteMut.mutate(w.id);
                    }}
                  />
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      {isAdmin && (
        <WorkshopFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editing={editing}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["workshops"] });
            setDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3
        className="text-[12px] text-white/55 font-bold uppercase tracking-[0.22em] mb-3"
        style={{ fontFamily: "var(--app-font-display)" }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: ReturnType<typeof workshopStatus> }) {
  if (status === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/15 border border-red-500/40 text-[10.5px] font-bold uppercase tracking-[0.16em] text-red-300">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
        Live now
      </span>
    );
  }
  if (status === "soon") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#C9A44C]/15 border border-[#C9A44C]/40 text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#C9A44C]">
        Starts soon
      </span>
    );
  }
  return null;
}

function DateBlock({ iso }: { iso: string }) {
  const f = formatWorkshopDate(iso);
  return (
    <div
      className="flex flex-col items-center justify-center w-[68px] h-[72px] rounded-xl border border-[#C9A44C]/30 bg-[#C9A44C]/[0.06] flex-shrink-0"
      title={f.full}
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#C9A44C]">
        {f.month}
      </span>
      <span
        className="text-white font-bold leading-none"
        style={{ fontSize: "26px", fontFamily: "var(--app-font-display)" }}
      >
        {f.day}
      </span>
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/55 mt-0.5">
        {f.weekday}
      </span>
    </div>
  );
}

function NextWorkshopCard({
  workshop,
  now,
  isAdmin,
  onEdit,
  onDelete,
}: {
  workshop: Workshop;
  now: number;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const status = workshopStatus(workshop.startsAt, workshop.durationMinutes, now);
  const f = formatWorkshopDate(workshop.startsAt);
  const isPast = status === "past";

  return (
    <div
      className="rounded-2xl p-6 md:p-8"
      style={{
        background:
          "linear-gradient(180deg, rgba(201,164,76,0.10) 0%, rgba(201,164,76,0.03) 100%)",
        border: "1px solid rgba(201,164,76,0.30)",
        boxShadow: "0 0 60px rgba(201,164,76,0.10)",
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <p className="text-[10px] md:text-[11px] font-bold uppercase tracking-[0.22em] text-[#C9A44C]">
          Next Live Workshop
        </p>
        <StatusBadge status={status} />
      </div>

      <div className="flex flex-col md:flex-row gap-5 md:items-center">
        <DateBlock iso={workshop.startsAt} />
        <div className="flex-1 min-w-0">
          <h2
            className="text-white font-bold uppercase leading-[1.15] mb-2"
            style={{ fontSize: "clamp(20px, 2.6vw, 26px)", fontFamily: "var(--app-font-display)" }}
          >
            {workshop.title}
          </h2>
          <div className="flex items-center gap-3 text-[12.5px] text-white/65 mb-2">
            <span className="inline-flex items-center gap-1.5">
              <CalendarIcon className="w-3.5 h-3.5 text-[#C9A44C]" />
              {f.full}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#C9A44C]" />
              {workshop.durationMinutes} min
            </span>
          </div>
          {workshop.description && (
            <p className="text-[13.5px] text-white/70 leading-[1.6] max-w-[640px] whitespace-pre-wrap">
              {workshop.description}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 md:items-end">
          {!isPast && (
            <a
              href={workshop.meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#C9A44C] text-black font-bold text-[13px] uppercase tracking-[0.14em] hover:bg-[#d8b566] transition-colors whitespace-nowrap"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              <Video className="w-4 h-4" />
              Join Live Call
            </a>
          )}
          {workshop.recordingUrl && (
            <a
              href={workshop.recordingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.06] border border-white/[0.10] text-white/85 text-[12.5px] font-medium hover:bg-white/[0.10] transition-colors whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Watch recording
            </a>
          )}
          {isAdmin && (
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={onEdit}
                className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors"
                title="Edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onDelete}
                className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkshopRow({
  workshop,
  now,
  isAdmin,
  onEdit,
  onDelete,
}: {
  workshop: Workshop;
  now: number;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const status = workshopStatus(workshop.startsAt, workshop.durationMinutes, now);
  const f = formatWorkshopDate(workshop.startsAt);
  const isPast = status === "past";

  return (
    <li className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-4 md:p-5 flex items-center gap-4">
      <DateBlock iso={workshop.startsAt} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <h4 className="text-[15px] font-bold text-white truncate">{workshop.title}</h4>
          <StatusBadge status={status} />
        </div>
        <p className="text-[12.5px] text-white/55">
          {f.full} · {workshop.durationMinutes} min
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {!isPast ? (
          <a
            href={workshop.meetingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#C9A44C]/15 border border-[#C9A44C]/40 text-[#C9A44C] text-[12px] font-bold uppercase tracking-[0.14em] hover:bg-[#C9A44C]/25 transition-colors"
          >
            <Video className="w-3.5 h-3.5" />
            Join
          </a>
        ) : workshop.recordingUrl ? (
          <a
            href={workshop.recordingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.10] text-white/85 text-[12px] font-medium hover:bg-white/[0.10] transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Recording
          </a>
        ) : null}
        {isAdmin && (
          <>
            <button
              onClick={onEdit}
              className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors"
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onDelete}
              className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-red-300 hover:bg-red-500/10 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

// Decompose an existing UTC ISO into the wall-clock components a user
// would see in the given IANA timezone. Used to pre-fill the form when
// editing an existing workshop.
function utcIsoToZonedParts(
  iso: string | null,
  timeZone: string,
): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

// Convert a wall-clock date+time in a given IANA timezone to a UTC
// Date. The naive single-pass "offset trick" lands on the wrong side
// of DST near spring-forward / fall-back transitions because the
// initial guess is interpreted with the wrong offset. We resolve
// iteratively: format the candidate back into the target zone, compare
// to the requested wall time, and shift by the residual. Two passes
// are enough to settle every legal local time. For nonexistent
// (spring-forward gap) and ambiguous (fall-back overlap) wall times we
// return a reasonable canonical instant rather than failing.
function zonedWallTimeToUtc(
  date: string, // YYYY-MM-DD
  time: string, // HH:MM
  timeZone: string,
): Date | null {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  if (![y, mo, d, h, mi].every(Number.isFinite)) return null;
  const targetMs = Date.UTC(y, mo - 1, d, h, mi, 0);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const wallMsAt = (utcMs: number): number => {
    const parts = Object.fromEntries(
      fmt
        .formatToParts(new Date(utcMs))
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, p.value]),
    ) as Record<string, string>;
    return Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
  };
  let utcMs = targetMs;
  for (let i = 0; i < 3; i++) {
    const wall = wallMsAt(utcMs);
    const diff = wall - targetMs;
    if (diff === 0) return new Date(utcMs);
    utcMs -= diff;
  }
  // No exact match (typically a DST spring-forward gap). Fall through
  // with the closest candidate; the preview line will show the actual
  // wall time the admin will get, so any residual is visible.
  return new Date(utcMs);
}

// 96 quarter-hour time slots, formatted in 12-hour locale-friendly
// form (e.g. "9:00 AM"). Stored value stays in 24h "HH:MM" so it
// round-trips cleanly through the timezone math above.
const TIME_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const hour12 = ((h + 11) % 12) + 1;
      const ampm = h < 12 ? "AM" : "PM";
      const label = `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
      out.push({ value, label });
    }
  }
  return out;
})();

// Curated list of common IANA timezones. We use Intl.supportedValuesOf
// when the runtime exposes it (modern browsers) so admins can pick any
// zone, and fall back to this curated list otherwise. The curated list
// is also used as the "Common" group so the typical pick is one click
// away even when the full list is available.
const COMMON_TIMEZONES: string[] = [
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Atlantic/Reykjavik",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Athens",
  "Europe/Istanbul",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

function allTimeZones(): string[] {
  // Modern browsers expose Intl.supportedValuesOf("timeZone") (~430
  // zones). When unavailable we fall back to the curated list above.
  try {
    const v = (Intl as unknown as {
      supportedValuesOf?: (key: string) => string[];
    }).supportedValuesOf?.("timeZone");
    if (Array.isArray(v) && v.length) return v;
  } catch {
    /* ignore */
  }
  return COMMON_TIMEZONES;
}

// "GMT-5" style abbreviation for a given IANA tz, computed for "now".
// Used in the picker rows so users can recognise a zone at a glance.
function tzOffsetLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    const o = parts.find((p) => p.type === "timeZoneName");
    return o?.value ?? "";
  } catch {
    return "";
  }
}

function prettyTzLabel(timeZone: string): string {
  // Trim the IANA prefix so the picker is scannable: "America/New_York"
  // becomes "New York", "Europe/London" becomes "London", etc.
  const tail = timeZone.split("/").pop() ?? timeZone;
  return tail.replace(/_/g, " ");
}

function WorkshopFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Workshop | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  // Default the scheduler to UK time (the canonical zone every workshop
  // is run in and every reminder email renders), NOT the admin's browser
  // zone. This prevents a misconfigured device clock from silently
  // storing the wrong instant - the failure mode that made a 3pm UK
  // workshop fire a "4pm UK time" reminder. The admin can still switch
  // zones with the picker below.
  const [timeZone, setTimeZone] = useState<string>(WORKSHOP_TZ);
  const [tzPickerOpen, setTzPickerOpen] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [meetingUrl, setMeetingUrl] = useState("");
  const [recordingUrl, setRecordingUrl] = useState("");
  // Track the originally-loaded UTC instant + whether the admin has
  // explicitly edited date or time. While wall time is "clean" we
  // treat a timezone switch as a viewer-rebase: we recompute date/time
  // from originalStartsAtUtc in the new tz so the saved instant is
  // preserved. Once the admin types a new date/time we stop rebasing.
  const [originalStartsAtUtc, setOriginalStartsAtUtc] = useState<string | null>(null);
  const [wallTimeDirty, setWallTimeDirty] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? "");
      setDescription(editing?.description ?? "");
      const tz = WORKSHOP_TZ;
      setTimeZone(tz);
      const iso = editing?.startsAt ?? null;
      const parts = utcIsoToZonedParts(iso, tz);
      setDate(parts.date);
      setTime(parts.time);
      setOriginalStartsAtUtc(iso);
      setWallTimeDirty(false);
      setDurationMinutes(editing?.durationMinutes ?? 120);
      setMeetingUrl(editing?.meetingUrl ?? "");
      setRecordingUrl(editing?.recordingUrl ?? "");
    }
  }, [open, editing]);

  // Timezone switch handler: while the admin hasn't edited the wall
  // time we treat the change as "show the same instant in this zone"
  // (preserves the saved meeting time). Once they've started editing
  // date/time, switching zones keeps the displayed wall time and lets
  // the absolute instant shift, which is the expected behaviour for
  // someone actively re-scheduling.
  function handleTimeZoneChange(nextTz: string) {
    if (!wallTimeDirty && originalStartsAtUtc) {
      const parts = utcIsoToZonedParts(originalStartsAtUtc, nextTz);
      setDate(parts.date);
      setTime(parts.time);
    }
    setTimeZone(nextTz);
  }

  // Live preview of the absolute instant we will save, expressed in
  // the chosen timezone. Helps the admin sanity-check the conversion
  // before clicking Schedule.
  const startsAtUtc = useMemo(
    () => (date && time ? zonedWallTimeToUtc(date, time, timeZone) : null),
    [date, time, timeZone],
  );
  const previewLine = useMemo(() => {
    if (!startsAtUtc) return "";
    try {
      const fmt = new Intl.DateTimeFormat(undefined, {
        timeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
      return fmt.format(startsAtUtc);
    } catch {
      return startsAtUtc.toISOString();
    }
  }, [startsAtUtc, timeZone]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!startsAtUtc) {
        throw new Error("Pick a date and time before scheduling.");
      }
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        startsAt: startsAtUtc.toISOString(),
        durationMinutes,
        meetingUrl: meetingUrl.trim(),
        recordingUrl: recordingUrl.trim() || undefined,
      };
      if (editing) {
        return api.updateWorkshop(editing.id, {
          ...payload,
          recordingUrl: recordingUrl.trim() ? recordingUrl.trim() : null,
        });
      }
      return api.createWorkshop(payload);
    },
    onSuccess: () => {
      toast({ title: editing ? "Workshop updated" : "Workshop scheduled" });
      onSaved();
    },
    onError: (e: unknown) => {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    },
  });

  const canSubmit = !!title.trim() && !!startsAtUtc && !!meetingUrl.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit workshop" : "Schedule workshop"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the live workshop details."
              : "Add the next live workshop with date, time, and meeting link."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="ws-title">Title</Label>
            <Input
              id="ws-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Monthly Platinum Workshop"
            />
          </div>
          <div>
            <Label htmlFor="ws-desc">Description (optional)</Label>
            <Textarea
              id="ws-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What we'll cover this month"
              rows={3}
            />
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3">
              <div>
                <Label htmlFor="ws-date">Date</Label>
                <Input
                  id="ws-date"
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setWallTimeDirty(true);
                  }}
                />
              </div>
              <div>
                <Label htmlFor="ws-time">Time</Label>
                <Select
                  value={time}
                  onValueChange={(v) => {
                    setTime(v);
                    setWallTimeDirty(true);
                  }}
                >
                  <SelectTrigger id="ws-time" data-testid="select-workshop-time">
                    <SelectValue placeholder="Pick a time" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {TIME_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ws-dur">Duration</Label>
                <Select
                  value={String(durationMinutes)}
                  onValueChange={(v) => setDurationMinutes(Number(v) || 120)}
                >
                  <SelectTrigger id="ws-dur" className="min-w-[110px]" data-testid="select-workshop-duration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[30, 45, 60, 75, 90, 120, 150, 180, 240].map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m < 60
                          ? `${m} min`
                          : m % 60 === 0
                            ? `${m / 60} hr`
                            : `${Math.floor(m / 60)} hr ${m % 60} min`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="ws-tz">Time zone</Label>
              <Popover open={tzPickerOpen} onOpenChange={setTzPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="ws-tz"
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={tzPickerOpen}
                    className="w-full justify-between font-normal"
                    data-testid="button-workshop-timezone"
                  >
                    <span className="truncate text-left">
                      <span>{prettyTzLabel(timeZone)}</span>
                      <span className="text-muted-foreground ml-2 text-xs">
                        {tzOffsetLabel(timeZone)}
                      </span>
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search time zone..." />
                    <CommandList className="max-h-72">
                      <CommandEmpty>No matching time zone.</CommandEmpty>
                      <CommandGroup heading="Common">
                        {COMMON_TIMEZONES.map((tz) => (
                          <CommandItem
                            key={`common-${tz}`}
                            value={`${prettyTzLabel(tz)} ${tz} ${tzOffsetLabel(tz)}`}
                            onSelect={() => {
                              handleTimeZoneChange(tz);
                              setTzPickerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                timeZone === tz ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <span className="flex-1 truncate">{prettyTzLabel(tz)}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {tzOffsetLabel(tz)}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                      <CommandGroup heading="All time zones">
                        {allTimeZones().map((tz) => (
                          <CommandItem
                            key={`all-${tz}`}
                            value={`${prettyTzLabel(tz)} ${tz} ${tzOffsetLabel(tz)}`}
                            onSelect={() => {
                              handleTimeZoneChange(tz);
                              setTzPickerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                timeZone === tz ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <span className="flex-1 truncate">{tz.replace(/_/g, " ")}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {tzOffsetLabel(tz)}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            {previewLine && (
              <div
                className="text-xs text-muted-foreground flex items-start gap-2 pt-1"
                data-testid="workshop-preview"
              >
                <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  Starts <span className="text-foreground">{previewLine}</span>
                </span>
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="ws-url">Meeting URL (Zoom / Meet)</Label>
            <Input
              id="ws-url"
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              placeholder="https://zoom.us/j/..."
            />
          </div>
          <div>
            <Label htmlFor="ws-rec">Recording URL (optional)</Label>
            <Input
              id="ws-rec"
              value={recordingUrl}
              onChange={(e) => setRecordingUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit || saveMut.isPending}
            onClick={() => saveMut.mutate()}
            className="bg-[#C9A44C] text-black hover:bg-[#d8b566]"
          >
            {saveMut.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : editing ? (
              "Save changes"
            ) : (
              "Schedule"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Recordings tab (Platinum Club library of past workshop replays)
// ---------------------------------------------------------------------------

function formatRecordedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function RecordingsTab({
  selectedRecordingId,
  onOpenRecording,
  onCloseRecording,
}: {
  selectedRecordingId: number | null;
  onOpenRecording: (id: number) => void;
  onCloseRecording: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["workshop-recordings"],
    queryFn: api.listWorkshopRecordings,
  });
  const recordings = (data?.recordings ?? []) as WorkshopRecordingMember[];

  if (selectedRecordingId != null) {
    return (
      <RecordingDetail
        id={selectedRecordingId}
        onBack={onCloseRecording}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-6 md:p-8">
        <div className="flex items-center gap-3 mb-2">
          <span className="w-8 h-8 rounded-full flex items-center justify-center bg-[#C9A44C]/15 border border-[#C9A44C]/30">
            <Video className="w-4 h-4 text-[#C9A44C]" />
          </span>
          <h3
            className="text-white font-bold uppercase tracking-[0.04em]"
            style={{ fontSize: "clamp(15px, 2vw, 18px)", fontFamily: "var(--app-font-display)" }}
          >
            Workshop Recordings
          </h3>
        </div>
        <p className="text-[14px] text-white/55 leading-[1.6]">
          Replays of every Platinum Club live workshop, with summaries, links, mentions, and action points.
        </p>
      </div>

      {isLoading ? (
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-12 text-center">
          <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
        </div>
      ) : error ? (
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-8 text-center">
          <Video className="w-8 h-8 text-white/20 mx-auto mb-3" />
          <p className="text-[14px] text-white/70 mb-1">We couldn't load the workshop recordings right now.</p>
          <p className="text-[13px] text-white/45">This is usually temporary - please refresh the page in a moment.</p>
        </div>
      ) : recordings.length === 0 ? (
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-12 text-center">
          <Video className="w-8 h-8 text-white/20 mx-auto mb-3" />
          <p className="text-[14px] text-white/50">No recordings published yet. Check back after the next workshop.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {recordings.map((r) => (
            <button
              key={r.id}
              onClick={() => onOpenRecording(r.id)}
              className="text-left bg-[#0f0f0f] border border-white/[0.06] hover:border-[#C9A44C]/40 rounded-2xl p-5 transition-colors group"
            >
              <div className="flex items-start gap-3 mb-3">
                <span className="w-10 h-10 rounded-full flex items-center justify-center bg-[#C9A44C]/10 border border-[#C9A44C]/25 shrink-0">
                  <PlayCircle className="w-5 h-5 text-[#C9A44C]" />
                </span>
                <div className="min-w-0 flex-1">
                  <h4
                    className="text-white font-bold tracking-[0.01em] leading-[1.3] group-hover:text-[#C9A44C] transition-colors"
                    style={{ fontSize: "16px", fontFamily: "var(--app-font-display)" }}
                  >
                    {r.title}
                  </h4>
                  <p className="text-[12px] text-white/45 mt-1 flex items-center gap-1.5">
                    <CalendarIcon className="w-3 h-3" />
                    {formatRecordedAt(r.recordedAt)}
                    {r.durationMinutes ? (
                      <>
                        <span className="text-white/25 mx-1">·</span>
                        <Clock className="w-3 h-3" />
                        {r.durationMinutes} min
                      </>
                    ) : null}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-white/40 mt-2">
                {r.actionPoints.length > 0 && (
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    {r.actionPoints.length} action{r.actionPoints.length === 1 ? "" : "s"}
                  </span>
                )}
                {r.links.length > 0 && (
                  <span className="flex items-center gap-1">
                    <LinkIcon className="w-3 h-3" />
                    {r.links.length} link{r.links.length === 1 ? "" : "s"}
                  </span>
                )}
                {r.keyMentions.length > 0 && (
                  <span className="flex items-center gap-1">
                    <UsersIcon className="w-3 h-3" />
                    {r.keyMentions.length} mention{r.keyMentions.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type RecordingSubTab = "summary" | "links" | "notes" | "actions";

function RecordingDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const [sub, setSub] = useState<RecordingSubTab>("summary");
  const { data, isLoading, error } = useQuery({
    queryKey: ["workshop-recording", id],
    queryFn: () => api.getWorkshopRecording(id),
  });
  const r = data?.recording;

  if (isLoading) {
    return (
      <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-12 text-center">
        <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
      </div>
    );
  }
  if (error || !r) {
    return (
      <div className="space-y-4">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-[12px] text-white/60 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" /> Back to recordings
        </button>
        <div className="bg-red-500/[0.05] border border-red-500/30 rounded-2xl p-6 text-[13.5px] text-red-300">
          Recording not found.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.14em] text-white/60 hover:text-[#C9A44C] transition-colors"
        style={{ fontFamily: "var(--app-font-display)" }}
      >
        <ArrowLeft className="w-4 h-4" /> All recordings
      </button>

      <div>
        <h2
          className="text-white font-bold uppercase tracking-[0.01em] leading-[1.1] mb-2"
          style={{ fontSize: "clamp(22px, 3vw, 30px)", fontFamily: "var(--app-font-display)" }}
        >
          {r.title}
        </h2>
        <p className="text-[13px] text-white/50 flex items-center gap-2 flex-wrap">
          <CalendarIcon className="w-3.5 h-3.5" />
          {formatRecordedAt(r.recordedAt)}
          {r.durationMinutes ? (
            <>
              <span className="text-white/25">·</span>
              <Clock className="w-3.5 h-3.5" />
              {r.durationMinutes} min
            </>
          ) : null}
        </p>
      </div>

      <div className="rounded-2xl overflow-hidden border border-white/[0.06] bg-black">
        <WistiaPlayer mediaId={r.wistiaMediaId} aspect={16 / 9} title={r.title} />
      </div>

      <div className="border-b border-white/[0.08] flex items-center gap-1 overflow-x-auto">
        <SubTabButton active={sub === "summary"} onClick={() => setSub("summary")}>
          Summary
        </SubTabButton>
        <SubTabButton active={sub === "links"} onClick={() => setSub("links")}>
          Links & Mentions
        </SubTabButton>
        <SubTabButton active={sub === "actions"} onClick={() => setSub("actions")}>
          Action Points
        </SubTabButton>
        <SubTabButton active={sub === "notes"} onClick={() => setSub("notes")}>
          Additional Notes
        </SubTabButton>
      </div>

      <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-6 md:p-8">
        {sub === "summary" ? (
          r.summary ? (
            <div
              className="text-[14.5px] text-white/75 leading-[1.7] space-y-3 [&_strong]:text-white [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_a]:text-[#C9A44C] [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: r.summary }}
            />
          ) : (
            <p className="text-[14px] text-white/40 italic">No summary yet.</p>
          )
        ) : sub === "links" ? (
          <div className="space-y-6">
            <div>
              <h4
                className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#C9A44C] mb-3"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                Links mentioned
              </h4>
              {r.links.length === 0 ? (
                <p className="text-[13.5px] text-white/40 italic">No links mentioned in this workshop.</p>
              ) : (
                <ul className="space-y-3">
                  {r.links.map((l, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <LinkIcon className="w-4 h-4 text-[#C9A44C] mt-1 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[14px] text-[#C9A44C] hover:underline break-all"
                        >
                          {l.label || l.url}
                        </a>
                        {l.context ? (
                          <p className="text-[13px] text-white/55 mt-0.5 leading-[1.5]">{l.context}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h4
                className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#C9A44C] mb-3"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                Key mentions
              </h4>
              {r.keyMentions.length === 0 ? (
                <p className="text-[13.5px] text-white/40 italic">No notable mentions in this workshop.</p>
              ) : (
                <ul className="space-y-2.5">
                  {r.keyMentions.map((m, i) => (
                    <li key={i} className="text-[14px] text-white/75 leading-[1.55]">
                      <span className="font-semibold text-white">{m.name}</span>
                      {m.context ? <span className="text-white/55"> - {m.context}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : sub === "actions" ? (
          r.actionPoints.length === 0 ? (
            <p className="text-[14px] text-white/40 italic">No action points for this workshop.</p>
          ) : (
            <ul className="space-y-3">
              {r.actionPoints.map((a, i) => (
                <li key={i} className="flex items-start gap-3 text-[14.5px] text-white/80 leading-[1.6]">
                  <CheckCircle2 className="w-4.5 h-4.5 text-[#C9A44C] mt-0.5 shrink-0" />
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
          )
        ) : r.additionalNotes ? (
          <div
            className="text-[14.5px] text-white/75 leading-[1.7] whitespace-pre-wrap"
          >
            {r.additionalNotes}
          </div>
        ) : (
          <p className="text-[14px] text-white/40 italic">No additional notes.</p>
        )}
      </div>
    </div>
  );
}

function SubTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 md:px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.14em] transition-colors border-b-2 -mb-px whitespace-nowrap ${
        active
          ? "text-[#C9A44C] border-[#C9A44C]"
          : "text-white/55 border-transparent hover:text-white/80"
      }`}
      style={{ fontFamily: "var(--app-font-display)" }}
    >
      {children}
    </button>
  );
}
