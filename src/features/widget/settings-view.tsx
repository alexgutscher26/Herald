"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BookOpen,
  Camera,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  ExternalLink,
  House,
  KeyRound,
  Lock,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  Monitor,
  Moon,
  Paperclip,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sun,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { toastActionFailure } from "@/components/shared/action-toast";

import { SettingsSection } from "@/components/shared/settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { accessibleAccent, foregroundFor } from "@/features/branding/schema";
import type { PublicReleaseCover } from "@/features/public/types";
import { cn } from "@/lib/utils";

import {
  type ConfiguredWidgetTheme,
  type WidgetOriginOverride,
  type WidgetPosition,
  type WidgetSection,
} from "./policy";
import { saveWidgetSettingsAction } from "./settings-actions";
import type { WidgetSettingsView } from "./settings";
import {
  WidgetFeedbackView,
  type WidgetFeedbackLabels,
  type WidgetFeedbackRow,
} from "./feedback-view";
import {
  WidgetHelpView,
  type WidgetHelpCollectionView,
  type WidgetHelpLabels,
} from "./help-view";
import {
  WidgetFeedbackDetailView,
  type WidgetFeedbackDetailComment,
} from "./feedback-detail-view";
import { WidgetHomeView, type WidgetHomeAction } from "./home-view";
import { WidgetMessagesListView } from "./messages-list-view";
import { WidgetWhatsNewView } from "./whats-new-view";

type Check = { label: string; ok: boolean; detail: string };

export type WidgetPreviewEntry = {
  id: string;
  title: string;
  summary: string;
  category: "feature" | "improvement" | "fix";
  cover: PublicReleaseCover;
  publishedLabel: string;
};

export type WidgetPreviewData = {
  brandName: string;
  productName: string;
  workspaceSlug: string;
  accentColor: string;
  logoUrl: string | null;
  entries: WidgetPreviewEntry[];
  showAttribution: boolean;
  sections: WidgetSection[];
};

const POSITION_OPTIONS: { value: WidgetPosition; label: string }[] = [
  { value: "bottom-right", label: "Bottom right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "top-right", label: "Top right" },
  { value: "top-left", label: "Top left" },
];

const THEME_OPTIONS: {
  value: ConfiguredWidgetTheme;
  label: string;
  icon: LucideIcon;
}[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "auto", label: "Auto", icon: Monitor },
];

const SECTION_OPTIONS: {
  value: WidgetSection;
  label: string;
  description: string;
}[] = [
  {
    value: "feedback",
    label: "Feedback board",
    description: "Browse requests, vote and submit new ones from the widget.",
  },
  {
    value: "roadmap",
    label: "Roadmap",
    description: "Show what is planned, in progress and shipped.",
  },
  {
    value: "messages",
    label: "Messages",
    description: "Let customers start a direct conversation with your team.",
  },
  {
    value: "help",
    label: "Help center",
    description: "Show published collections and answers in the widget.",
  },
];

const POSITION_DOT: Record<WidgetPosition, string> = {
  "bottom-right": "bottom-1 right-1",
  "bottom-left": "bottom-1 left-1",
  "top-right": "top-1 right-1",
  "top-left": "top-1 left-1",
};

const PREVIEW_POSITION: Record<WidgetPosition, string> = {
  "bottom-right": "bottom-3 right-3",
  "bottom-left": "bottom-3 left-3",
  "top-right": "top-14 right-3",
  "top-left": "top-14 left-3",
};

const POSITION_LABELS = Object.fromEntries(
  POSITION_OPTIONS.map((option) => [option.value, option.label]),
) as Record<WidgetPosition, string>;

const THEME_LABELS = Object.fromEntries(
  THEME_OPTIONS.map((option) => [option.value, option.label]),
) as Record<ConfiguredWidgetTheme, string>;

type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
};

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  stretch = false,
  className,
}: {
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  stretch?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex rounded-[8px] border border-border/80 bg-muted/60 p-0.5",
        stretch && "flex w-full",
        className,
      )}
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            disabled={disabled}
            className={cn(
              "inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] px-2.5 text-[11.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              active
                ? "bg-card text-foreground shadow-[0_1px_2px_rgba(23,22,20,0.08)] ring-1 ring-border/70"
                : "text-muted-foreground hover:text-foreground",
              stretch && "flex-1",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            {Icon ? (
              <Icon className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

type PreviewTab = "home" | "messages" | "help" | "feedback" | "updates";

type PreviewTabItem = {
  key: PreviewTab;
  label: string;
  icon: LucideIcon;
};

const PREVIEW_FEEDBACK_ROWS: WidgetFeedbackRow[] = [
  {
    id: "preview-linear",
    title: "Linear Integration",
    body: "Integrate directly with linear for creating / updating requests and the product roadmap.",
    authorName: "Shayan Taslim",
    status: "planned",
    voteCount: 147,
    votesAria: "147 votes",
    createdAt: "2025-11-22T10:00:00.000Z",
    href: "#request",
  },
  {
    id: "preview-csv",
    title: "Add CSV export to reports",
    body: "Let me share report data with finance without copying it by hand.",
    authorName: "Maya Chen",
    status: "open",
    voteCount: 12,
    votesAria: "12 votes",
    createdAt: "2026-11-22T10:00:00.000Z",
    href: "#request",
  },
  {
    id: "preview-dark-mode",
    title: "Dark mode for the dashboard",
    body: "Easier on the eyes when working late.",
    authorName: "Leo Martins",
    status: "planned",
    voteCount: 8,
    votesAria: "8 votes",
    createdAt: "2026-11-20T10:00:00.000Z",
    href: "#request",
  },
  {
    id: "preview-custom-fields",
    title: "Custom fields on requests",
    body: "Capture plan and region on every request.",
    authorName: "Priya Shah",
    status: "shipped",
    voteCount: 5,
    votesAria: "5 votes",
    createdAt: "2026-11-18T10:00:00.000Z",
    href: "#request",
  },
];

const PREVIEW_FEEDBACK_LABELS: WidgetFeedbackLabels = {
  title: "Feedback",
  search: "Search feedback",
  noResults: "No feedback matches your search.",
  noMatches: "No feedback matches these filters.",
  searchHint: "Try another word or submit your own feedback.",
  filterHint: "Try another search or status.",
  filters: "Filter feedback",
  sortSection: "Sort",
  statusSection: "Status",
  sortTop: "Top",
  sortNew: "New",
  sortTrending: "Trending",
  statuses: {
    open: "Open",
    under_review: "Under review",
    planned: "Planned",
    in_progress: "In progress",
    shipped: "Shipped",
    closed: "Closed",
  },
  submit: "Submit feedback",
  list: "Feedback requests",
  emptyTitle: "No feedback yet",
  emptyBody: "Submit the first request to get started.",
};

const PREVIEW_REQUEST_VOTERS = [
  "Shayan Taslim",
  "Ian Hunter",
  "Jeffrey Zang",
  "Maya Chen",
];

const PREVIEW_REQUEST_COMMENTS: WidgetFeedbackDetailComment[] = [
  {
    id: "preview-comment-ian",
    authorName: "Ian Hunter",
    body: "This would be insanely helpful.",
    ageLabel: "1y",
    voteCount: 7,
  },
  {
    id: "preview-comment-jeffrey-one",
    authorName: "Jeffrey Zang",
    body: "+1",
    ageLabel: "1y",
    voteCount: 2,
  },
  {
    id: "preview-comment-jeffrey-sync",
    authorName: "Jeffrey Zang",
    body: "Sync with GitHub Issues would be amazing as well",
    ageLabel: "1y",
    voteCount: 6,
  },
];

const PREVIEW_HELP_COLLECTIONS: WidgetHelpCollectionView[] = [
  {
    id: "preview-start",
    slug: "getting-started",
    name: "Getting started",
    description: "Set up your workspace and first board.",
    articles: [
      { id: "preview-start-1", title: "Create your first board", href: "#" },
      { id: "preview-start-2", title: "Invite your team", href: "#" },
      { id: "preview-start-3", title: "Publish your first update", href: "#" },
    ],
  },
  {
    id: "preview-feedback",
    slug: "feedback-roadmap",
    name: "Feedback & roadmap",
    description: "Collect requests and show what is planned.",
    articles: [
      { id: "preview-feedback-1", title: "Review incoming requests", href: "#" },
      { id: "preview-feedback-2", title: "Move a request across the roadmap", href: "#" },
      { id: "preview-feedback-3", title: "Merge duplicate feedback", href: "#" },
    ],
  },
  {
    id: "preview-widget",
    slug: "widget-install",
    name: "Widget & install",
    description: "Put Herald inside your product.",
    articles: [
      { id: "preview-widget-1", title: "Install the widget", href: "#" },
      { id: "preview-widget-2", title: "Theme and position", href: "#" },
    ],
  },
];

const PREVIEW_HELP_LABELS: WidgetHelpLabels = {
  title: "Help & Support",
  search: "Search help",
  noResults: "No help articles match your search.",
  searchHint: "Try a shorter phrase or browse a collection.",
  back: "Back to help",
  articles: "articles",
  articleOne: "article",
  emptyTitle: "No help articles yet",
  emptyBody: "No help articles have been published yet.",
  noArticles: "No articles have been published in this collection yet.",
};

function previewCategoryLabel(
  category: WidgetPreviewEntry["category"],
): string {
  return category === "feature"
    ? "Feature"
    : category === "improvement"
      ? "Improvement"
      : "Fix";
}

function initialPreviewTab(sections: WidgetSection[]): PreviewTab {
  if (sections.includes("feedback")) return "feedback";
  if (sections.includes("help")) return "help";
  if (sections.includes("messages")) return "messages";
  return "home";
}

/** Preview links stay inert; hash links route to an in-preview tab. */
function PreviewLinkGuard({
  children,
  onNavigate,
}: {
  children: ReactNode;
  onNavigate?: (target: string) => void;
}) {
  return (
    <div
      className="flex min-h-full flex-col"
      onClickCapture={(event) => {
        const anchor = (event.target as HTMLElement).closest("a");
        if (!anchor) return;
        event.preventDefault();
        const href = anchor.getAttribute("href");
        if (href?.startsWith("#")) onNavigate?.(href.slice(1));
      }}
    >
      {children}
    </div>
  );
}

function PreviewHeader({
  preview,
  onClose,
}: {
  preview: WidgetPreviewData;
  onClose: () => void;
}) {
  const initial = preview.productName.trim().charAt(0).toUpperCase() || "H";

  return (
    <header className="flex shrink-0 items-center justify-between gap-3 px-4 pb-1.5 pt-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
          style={{
            backgroundColor: preview.accentColor,
            color: foregroundFor(preview.accentColor),
          }}
        >
          {initial}
        </span>
        <p className="truncate text-[15px] font-semibold tracking-tight">
          {preview.productName}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <span
          aria-hidden="true"
          className="relative inline-flex size-8 items-center justify-center rounded-full text-muted-foreground"
        >
          <Bell className="size-4" strokeWidth={1.8} />
          {preview.entries.length > 0 ? (
            <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary ring-2 ring-background" />
          ) : null}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close widget preview"
          className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function PreviewTabBar({
  tabs,
  active,
  onSelect,
}: {
  tabs: PreviewTabItem[];
  active: PreviewTab;
  onSelect: (tab: PreviewTab) => void;
}) {
  return (
    <nav
      aria-label="Widget sections preview"
      className="shrink-0 border-t border-border/70 bg-card/70 px-1.5 pt-1"
    >
      <ul className="flex items-stretch">
        {tabs.map((item) => {
          const current = item.key === active;
          const Icon = item.icon;

          return (
            <li key={item.key} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onSelect(item.key)}
                aria-current={current ? "page" : undefined}
                className="group flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-xl px-0.5 py-1.5 transition-transform duration-150 active:scale-[0.97]"
              >
                <span
                  className={cn(
                    "flex h-7 w-11 items-center justify-center rounded-full transition-[background-color,color,box-shadow] duration-200",
                    current
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground group-hover:bg-muted group-hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span
                  className={cn(
                    "w-full truncate text-center text-[10px] leading-none",
                    current
                      ? "font-semibold text-foreground"
                      : "font-medium text-muted-foreground",
                  )}
                >
                  {item.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function PreviewHomeScreen({
  preview,
  onOpenMessages,
  onOpenHelp,
  onCompose,
  onOpenUpdates,
}: {
  preview: WidgetPreviewData;
  onOpenMessages: () => void;
  onOpenHelp: () => void;
  onCompose: () => void;
  onOpenUpdates: () => void;
}) {
  const latest = preview.entries[0] ?? null;
  const productInitial = preview.productName.trim().charAt(0).toUpperCase() || "H";
  const actions: WidgetHomeAction[] = [];

  if (preview.sections.includes("help")) {
    actions.push({ href: "#help", label: "Search for help", icon: "help" });
  }
  if (preview.sections.includes("feedback")) {
    actions.push({ href: "#compose", label: "Submit a request", icon: "request" });
  }
  if (preview.sections.includes("roadmap")) {
    actions.push({ href: "#roadmap", label: "Roadmap", icon: "roadmap" });
  }

  return (
    <PreviewLinkGuard
      onNavigate={(target) => {
        if (target === "messages") onOpenMessages();
        else if (target === "help") onOpenHelp();
        else if (target === "compose") onCompose();
        else if (target === "updates") onOpenUpdates();
      }}
    >
      <WidgetHomeView
        productInitial={productInitial}
        logoUrl={preview.logoUrl}
        accentColor={preview.accentColor}
        accentForeground={foregroundFor(preview.accentColor)}
        greeting="Hi there"
        title={`What's new in ${preview.productName}`}
        message={
          preview.sections.includes("messages")
            ? {
                href: "#messages",
                title: "Send us a message",
                body: "Ask a question or share what you need.",
                placeholder: "Write a message…",
              }
            : null
        }
        actions={actions}
        latestUpdate={
          latest
            ? {
                id: latest.id,
                href: "#updates",
                title: latest.title,
                summary: latest.summary,
                category: latest.category,
                cover: latest.cover,
                dateLabel: latest.publishedLabel,
              }
            : null
        }
        moreUpdates={preview.entries.slice(1, 3).map((entry) => ({
          id: entry.id,
          href: "#updates",
          title: entry.title,
        }))}
        updatesHref="#updates"
        labels={{
          latestUpdate: "Latest update",
          viewAllUpdates: "View all updates",
          emptyTitle: "No published updates yet",
          emptyBody: "Publish a changelog entry to see it here.",
        }}
        updatesEnabled
      />
    </PreviewLinkGuard>
  );
}

function PreviewMessagesScreen({ preview }: { preview: WidgetPreviewData }) {
  return (
    <WidgetMessagesListView
      items={[]}
      labels={{
        title: "Messages",
        emptyTitle: "No messages yet",
        emptyBody: "Ask a question or report a bug, and we'll reply right here.",
        newConversation: "New conversation",
      }}
      productInitial={preview.productName.trim().charAt(0).toUpperCase() || "H"}
      onNewConversation={() => {}}
    />
  );
}

function PreviewFeedbackScreen({
  onCompose,
  onOpenRequest,
}: {
  onCompose: () => void;
  onOpenRequest: (id: string) => void;
}) {
  return (
    <PreviewLinkGuard
      onNavigate={(target) => {
        if (target === "compose") onCompose();
        else if (target.startsWith("request-")) {
          onOpenRequest(target.slice("request-".length));
        }
      }}
    >
      <WidgetFeedbackView
        rows={PREVIEW_FEEDBACK_ROWS.map((row) => ({
          ...row,
          href: `#request-${row.id}`,
        }))}
        labels={PREVIEW_FEEDBACK_LABELS}
        submitHref="#compose"
        locale="en"
      />
    </PreviewLinkGuard>
  );
}

function PreviewHelpScreen() {
  return (
    <PreviewLinkGuard>
      <WidgetHelpView
        collections={PREVIEW_HELP_COLLECTIONS}
        labels={PREVIEW_HELP_LABELS}
      />
    </PreviewLinkGuard>
  );
}

function PreviewUpdatesScreen({ preview }: { preview: WidgetPreviewData }) {
  const items = preview.entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    category: entry.category,
    categoryLabel: previewCategoryLabel(entry.category),
    dateLabel: entry.publishedLabel,
    href: "#",
  }));

  return (
    <PreviewLinkGuard>
      <div className="pb-1">
        <div className="pt-1">
          <h1 className="text-lg font-semibold tracking-tight">Updates</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Latest news from {preview.productName}.
          </p>
        </div>
        <div className="mt-3">
          <WidgetWhatsNewView
            items={items}
            labels={{
              search: "Search updates…",
              noResults: "No updates match your search.",
              emptyTitle: "No published updates yet",
              emptyBody: "Publish a changelog entry to see it here.",
            }}
          />
        </div>
      </div>
    </PreviewLinkGuard>
  );
}

function PreviewComposeScreen({
  showAttribution,
  onBack,
  onClose,
}: {
  showAttribution: boolean;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="grid shrink-0 grid-cols-[2rem_1fr_2rem] items-center gap-2 px-2 pb-1 pt-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to feedback"
          className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>
        <p className="truncate text-center text-[14px] font-semibold">
          Give feedback
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close widget preview"
          className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      <div className="widget-scrollbars-hidden min-h-0 flex-1 overflow-y-auto px-4 py-2">
        <p className="text-[18px] font-semibold leading-snug text-muted-foreground/50">
          Title
        </p>
        <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground/60">
          What&apos;s on your mind?
        </p>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/70 px-3 py-2">
        <div className="flex items-center gap-1 text-muted-foreground" aria-hidden="true">
          <span className="inline-flex size-8 items-center justify-center rounded-full">
            <Paperclip className="size-4" />
          </span>
          <span className="inline-flex size-8 items-center justify-center rounded-full">
            <Camera className="size-4" />
          </span>
        </div>
        <span className="inline-flex h-9 items-center rounded-full bg-foreground px-4 text-[12px] font-semibold text-background">
          Post
        </span>
      </div>

      {showAttribution ? (
        <p className="shrink-0 pb-1.5 text-center text-[8.5px] leading-tight text-muted-foreground/80">
          Powered by Herald
        </p>
      ) : null}
    </div>
  );
}

function WidgetPreviewPanel({
  position,
  theme,
  preview,
  device,
  open,
  onClose,
  onOpen,
}: {
  position: WidgetPosition;
  theme: ConfiguredWidgetTheme;
  preview: WidgetPreviewData;
  device: "desktop" | "mobile";
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  // The preview imitates the public widget, so it carries the same theme scope
  // and brand accent variables. Without them every colour token resolves
  // against the dashboard palette, which paints light text on the hardcoded
  // light surface whenever the dashboard itself is dark.
  const accent = accessibleAccent(preview.accentColor);
  const panelScope = {
    "--brand-accent-light": accent.onLight,
    "--brand-accent-light-fg": accent.foregroundOnLight,
    "--brand-accent-dark": accent.onDark,
    "--brand-accent-dark-fg": accent.foregroundOnDark,
  } as CSSProperties;
  const launcherText = foregroundFor(preview.accentColor);
  const [tab, setTab] = useState<PreviewTab>(() =>
    initialPreviewTab(preview.sections),
  );
  const [composing, setComposing] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);

  const tabs: PreviewTabItem[] = [
    { key: "home", label: "Home", icon: House },
  ];
  if (preview.sections.includes("messages")) {
    tabs.push({ key: "messages", label: "Messages", icon: MessagesSquare });
  }
  if (preview.sections.includes("help")) {
    tabs.push({ key: "help", label: "Help", icon: BookOpen });
  }
  if (preview.sections.includes("feedback")) {
    tabs.push({ key: "feedback", label: "Feedback", icon: MessageCircle });
  }
  tabs.push({ key: "updates", label: "Updates", icon: Megaphone });

  const activeTab = tabs.some((item) => item.key === tab)
    ? tab
    : initialPreviewTab(preview.sections);
  const selectedRequest =
    requestId === null
      ? null
      : PREVIEW_FEEDBACK_ROWS.find((row) => row.id === requestId) ?? null;
  const composingVisible = composing && activeTab === "feedback";
  const requestVisible =
    !composingVisible && activeTab === "feedback" && selectedRequest !== null;

  function openPreview() {
    setComposing(false);
    setRequestId(null);
    onOpen();
  }

  function closePreview() {
    setComposing(false);
    setRequestId(null);
    onClose();
  }

  function selectTab(next: PreviewTab) {
    setTab(next);
    setComposing(false);
    setRequestId(null);
  }

  function openRequest(id: string) {
    setTab("feedback");
    setComposing(false);
    setRequestId(id);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPreview}
        className={cn(
          "absolute z-10 inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2.5 text-[12px] font-semibold shadow-[0_10px_24px_rgba(23,22,20,0.22)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          PREVIEW_POSITION[position],
        )}
        style={{
          backgroundColor: preview.accentColor,
          color: launcherText,
        }}
        aria-label="Open widget preview"
      >
        <Bell className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
        What&apos;s new
        <span
          className="size-1.5 rounded-full bg-current opacity-70"
          aria-hidden="true"
        />
      </button>
    );
  }

  return (
    <div
      className={cn(
        `public-theme-${theme} public-brand-accent`,
        "absolute z-10 flex h-[480px] max-h-[calc(100%-4.25rem)] flex-col overflow-hidden rounded-[22px] border border-border/80 bg-background text-foreground shadow-[0_20px_48px_rgba(23,22,20,0.24)]",
        PREVIEW_POSITION[position],
        device === "mobile"
          ? "w-[calc(100%-1rem)]"
          : "w-[min(380px,calc(100%-1.5rem))]",
      )}
      style={panelScope}
    >
      {composingVisible ? (
        <PreviewComposeScreen
          showAttribution={preview.showAttribution}
          onBack={() => setComposing(false)}
          onClose={closePreview}
        />
      ) : requestVisible && selectedRequest ? (
        <WidgetFeedbackDetailView
          request={{
            title: selectedRequest.title,
            body: selectedRequest.body,
            authorName: selectedRequest.authorName,
            status: selectedRequest.status,
            statusLabel: PREVIEW_FEEDBACK_LABELS.statuses[selectedRequest.status],
            voteCount: selectedRequest.voteCount,
          }}
          comments={PREVIEW_REQUEST_COMMENTS}
          voters={PREVIEW_REQUEST_VOTERS}
          labels={{
            header: "Request",
            commentPlaceholder: "Add a comment...",
            reply: "Reply",
            attribution: "Powered by Herald",
          }}
          onBack={() => setRequestId(null)}
          onClose={closePreview}
          showAttribution={preview.showAttribution}
        />
      ) : (
        <>
          <PreviewHeader preview={preview} onClose={closePreview} />

          <div className="widget-scrollbars-hidden min-h-0 flex-1 overflow-y-auto px-4 py-2">
            {activeTab === "home" ? (
              <PreviewHomeScreen
                preview={preview}
                onOpenMessages={() => selectTab("messages")}
                onOpenHelp={() => selectTab("help")}
                onCompose={() => {
                  setTab("feedback");
                  setComposing(true);
                }}
                onOpenUpdates={() => selectTab("updates")}
              />
            ) : activeTab === "messages" ? (
              <PreviewMessagesScreen preview={preview} />
            ) : activeTab === "help" ? (
              <PreviewHelpScreen />
            ) : activeTab === "feedback" ? (
              <PreviewFeedbackScreen
                onCompose={() => {
                  setRequestId(null);
                  setComposing(true);
                }}
                onOpenRequest={openRequest}
              />
            ) : (
              <PreviewUpdatesScreen preview={preview} />
            )}
          </div>

          <PreviewTabBar
            tabs={tabs}
            active={activeTab}
            onSelect={selectTab}
          />

          {preview.showAttribution ? (
            <p className="shrink-0 pb-1.5 text-center text-[8.5px] leading-tight text-muted-foreground/80">
              Powered by Herald
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function WidgetPreviewCard({
  position,
  theme,
  preview,
}: {
  position: WidgetPosition;
  theme: ConfiguredWidgetTheme;
  preview: WidgetPreviewData;
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [open, setOpen] = useState(true);

  return (
    <section
      aria-label="Widget preview"
      className="overflow-hidden rounded-[10px] border bg-card shadow-[0_1px_2px_rgba(23,22,20,0.04)]"
    >
      <div className="space-y-3 border-b border-border/70 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Preview device"
            value={device}
            onChange={setDevice}
            options={[
              { value: "desktop", label: "Desktop", icon: Monitor },
              { value: "mobile", label: "Mobile", icon: Smartphone },
            ]}
          />
          <Badge
            variant="outline"
            className="gap-1.5 border-border/80 bg-muted/30 font-normal text-muted-foreground"
          >
            <span
              className="size-1.5 rounded-full bg-success"
              aria-hidden="true"
            />
            Simulated preview
          </Badge>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Widget state
            </span>
            <Segmented
              label="Widget state"
              value={open ? "open" : "closed"}
              onChange={(next) => setOpen(next === "open")}
              options={[
                { value: "open", label: "Drawer open" },
                { value: "closed", label: "Minimized" },
              ]}
            />
          </div>
          <span className="text-[10.5px] text-muted-foreground">
            {POSITION_LABELS[position]} · {THEME_LABELS[theme]}
          </span>
        </div>
      </div>

      <div className="relative flex min-h-[620px] items-center justify-center overflow-hidden bg-[#e9e6df] p-4 sm:p-6">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(28,27,25,0.10)_1px,transparent_0)] [background-size:18px_18px]"
          aria-hidden="true"
        />
        <div
          className={cn(
            "relative w-full overflow-hidden rounded-xl border border-[#d8d3c9] bg-card shadow-[0_24px_60px_rgba(23,22,20,0.16)] transition-[max-width] duration-300",
            device === "desktop" ? "max-w-[560px]" : "max-w-[320px]",
          )}
        >
          <div className="flex h-9 items-center gap-1.5 border-b border-[#dedad2] bg-[#f1efe9] px-3">
            <span className="size-2 rounded-full bg-[#d98a7c]" aria-hidden="true" />
            <span className="size-2 rounded-full bg-[#ddc06d]" aria-hidden="true" />
            <span className="size-2 rounded-full bg-[#9ab68d]" aria-hidden="true" />
            <div className="ml-2 flex min-w-0 flex-1 items-center gap-1.5 rounded-[5px] border border-[#dedad2] bg-white/80 px-2 py-1 text-[9px] text-muted-foreground">
              <Lock className="size-2.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                https://app.{preview.workspaceSlug}.com
              </span>
            </div>
            <RefreshCw
              className="size-3 shrink-0 text-muted-foreground/55"
              aria-hidden="true"
            />
          </div>

          <div className="relative h-[548px] overflow-hidden bg-[#f5f3ed]">
            <div aria-hidden="true">
              <div className="flex h-11 items-center gap-2 border-b border-[#e2ded5] bg-white px-3">
                {preview.logoUrl ? (
                  <Image
                    src={preview.logoUrl}
                    alt=""
                    width={20}
                    height={20}
                    unoptimized
                    className="size-5 shrink-0 rounded object-contain"
                  />
                ) : (
                  <span
                    className="flex size-5 shrink-0 items-center justify-center rounded text-[9px] font-semibold"
                    style={{
                      backgroundColor: preview.accentColor,
                      color: foregroundFor(preview.accentColor),
                    }}
                  >
                    {preview.brandName.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="truncate text-[10px] font-semibold">
                  {preview.brandName}
                </span>
                {device === "desktop" ? (
                  <div className="ml-3 flex items-center gap-3 text-[8.5px] text-muted-foreground">
                    <span className="font-medium text-foreground">Overview</span>
                    <span>Feedback</span>
                    <span>Updates</span>
                  </div>
                ) : null}
                <div className="ml-auto flex items-center gap-1">
                  <span className="size-4 rounded-full bg-[#e8e5dc]" />
                  <span className="size-4 rounded-full bg-[#e8e5dc]" />
                </div>
              </div>

              <div className={cn("space-y-3", device === "desktop" ? "p-4" : "p-3")}>
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Workspace overview
                    </p>
                    <p className="mt-0.5 text-[15px] font-semibold tracking-[-0.02em] text-[#34312d]">
                      Product pulse
                    </p>
                  </div>
                  <span className="rounded border border-[#e2ded5] bg-white px-1.5 py-1 text-[8px] text-muted-foreground">
                    Last 30 days
                  </span>
                </div>

                <div
                  className={cn(
                    "grid gap-2",
                    device === "desktop" ? "grid-cols-3" : "grid-cols-2",
                  )}
                >
                  {[
                    ["Active signals", "1,482"],
                    ["Response rate", "94.2%"],
                    ["New this week", "38"],
                  ]
                    .slice(0, device === "desktop" ? 3 : 2)
                    .map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-md border border-[#e2ded5] bg-white/85 p-2.5"
                      >
                        <p className="text-[8px] text-muted-foreground">{label}</p>
                        <p className="mt-1 text-[13px] font-semibold tabular-nums text-[#34312d]">
                          {value}
                        </p>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#eeeae2]">
                          <div
                            className="h-full w-2/3 rounded-full"
                            style={{ backgroundColor: preview.accentColor }}
                          />
                        </div>
                      </div>
                    ))}
                </div>

                <div className="rounded-md border border-[#e2ded5] bg-white/85 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[8.5px] font-medium text-[#34312d]">
                      Signals over time
                    </p>
                    <span className="text-[8px] text-muted-foreground">Weekly</span>
                  </div>
                  <div
                    className={cn(
                      "mt-2 flex items-end gap-1",
                      device === "desktop" ? "h-20" : "h-14",
                    )}
                  >
                    {[34, 48, 40, 66, 54, 78, 61, 86, 70, 94].map(
                      (height, index) => (
                        <span
                          key={index}
                          className="flex-1 rounded-t-sm bg-[#dfdbd2]"
                          style={{
                            height: `${height}%`,
                            backgroundColor:
                              index === 9 ? preview.accentColor : undefined,
                            opacity: index === 9 ? 0.8 : 1,
                          }}
                        />
                      ),
                    )}
                  </div>
                </div>

                {device === "desktop" ? (
                  <div className="rounded-md border border-[#e2ded5] bg-white/85 p-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[8.5px] font-medium text-[#34312d]">
                        Recent feedback
                      </p>
                      <span className="text-[8px] text-muted-foreground">
                        View all
                      </span>
                    </div>
                    {[78, 62, 88].map((width, index) => (
                      <div
                        key={index}
                        className="mt-2 flex items-center gap-2 border-t border-[#eeebe4] pt-2"
                      >
                        <span className="size-4 rounded-sm bg-[#eeeae2]" />
                        <span
                          className="h-1.5 rounded-full bg-[#e8e4dc]"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <WidgetPreviewPanel
              key={open ? "open" : "closed"}
              position={position}
              theme={theme}
              preview={preview}
              device={device}
              open={open}
              onClose={() => setOpen(false)}
              onOpen={() => setOpen(true)}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-4 py-3 text-[10.5px] text-muted-foreground sm:px-5">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
          Preview reflects your current selections.
        </span>
        <span className="inline-flex items-center gap-1">
          <ArrowUpRight className="size-3" aria-hidden="true" />
          No live script is loaded here.
        </span>
      </div>
    </section>
  );
}

export function WidgetSettingsView({
  workspaceSlug,
  productSlug,
  settings,
  identity,
  canManage,
  snippet,
  frameHref,
  preview,
}: {
  workspaceSlug: string;
  productSlug: string;
  settings: WidgetSettingsView;
  identity: { enabled: boolean; hasSecret: boolean };
  canManage: boolean;
  snippet: string;
  frameHref: string;
  preview: WidgetPreviewData;
}) {
  const router = useRouter();
  const [origins, setOrigins] = useState(settings.allowedOrigins.join("\n"));
  const [position, setPosition] = useState<WidgetPosition>(settings.position);
  const [theme, setTheme] = useState<ConfiguredWidgetTheme>(settings.theme);
  const [sections, setSections] = useState<WidgetSection[]>(settings.sections);
  const [overrides, setOverrides] = useState<
    Record<
      string,
      { theme: ConfiguredWidgetTheme | ""; position: WidgetPosition | "" }
    >
  >(() =>
    Object.fromEntries(
      settings.originOverrides.map((override) => [
        override.origin,
        { theme: override.theme ?? "", position: override.position ?? "" },
      ]),
    ),
  );
  const [saving, startSave] = useTransition();
  const [checking, setChecking] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);

  // Keep the install snippet in step with the controls above, even before the
  // operator saves. The server-rendered snippet supplies the stable loader,
  // key and accent attributes; these three are the customizer's choices.
  const currentSnippet = snippet
    .replace(/data-position="[^"]*"/, `data-position="${position}"`)
    .replace(/data-theme="[^"]*"/, `data-theme="${theme}"`)
    .replace(
      /data-sections="[^"]*"/,
      `data-sections="${sections.join(",")}"`,
    );

  function copyText(value: string, label: string) {
    void navigator.clipboard
      .writeText(value)
      .then(() => toast.success(`${label} copied.`))
      .catch(() => toast.error(`Could not copy the ${label.toLowerCase()}.`));
  }

  const originList = origins
    .split(/\r?\n/)
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean)
    .map((value) => {
      // Match the normalized origin the server stores, so an override is not
      // rejected only because the operator typed the host in upper case.
      try {
        return new URL(value).origin;
      } catch {
        return value;
      }
    });

  function save() {
    startSave(async () => {
      const result = await saveWidgetSettingsAction({
        workspaceSlug,
        productSlug,
        allowedOrigins: origins
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean),
        position,
        theme,
        sections,
        originOverrides: originList.flatMap((origin) => {
          const entry = overrides[origin];
          const payload: WidgetOriginOverride = { origin };
          if (entry?.theme) payload.theme = entry.theme;
          if (entry?.position) payload.position = entry.position;
          return entry?.theme || entry?.position ? [payload] : [];
        }),
      });

      if (!result.ok) {
        toastActionFailure(result);
        return;
      }

      setOrigins(result.data.settings.allowedOrigins.join("\n"));
      setPosition(result.data.settings.position);
      setTheme(result.data.settings.theme);
      setSections(result.data.settings.sections);
      setOverrides(
        Object.fromEntries(
          result.data.settings.originOverrides.map((override) => [
            override.origin,
            {
              theme: override.theme ?? "",
              position: override.position ?? "",
            },
          ]),
        ),
      );
      router.refresh();
    });
  }

  async function verify() {
    setChecking(true);
    setChecks(null);

    const base = `/p/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
      productSlug,
    )}/embed`;
    const host = settings.allowedOrigins[0] ?? window.location.origin;
    const params = new URLSearchParams({ host, key: settings.publicKey });
    const embedUrl = `${base}?${params.toString()}`;
    const noKeyUrl = `${base}?${new URLSearchParams({ host }).toString()}`;
    const next: Check[] = [];

    try {
      const script = await fetch("/widget/v1.js", { cache: "no-store" });
      const scriptType = script.headers.get("content-type") ?? "";
      next.push({
        label: "Versioned loader",
        ok: script.ok && scriptType.includes("javascript"),
        detail: `${script.status} ${scriptType || "no content type"}`,
      });

      const embed = await fetch(embedUrl, { cache: "no-store" });
      next.push({
        label: "Embed route",
        ok: embed.ok,
        detail: `${embed.status} ${embed.ok ? "ready" : "not available"}`,
      });

      const withoutKey = await fetch(noKeyUrl, { cache: "no-store" });
      next.push({
        label: "Project key enforced",
        ok: withoutKey.status === 404,
        detail:
          withoutKey.status === 404
            ? "A request without the key is refused."
            : `Unexpected ${withoutKey.status}; the key gate is not active.`,
      });

      if (settings.allowedOrigins.length > 0) {
        const blockedUrl = `${base}?${new URLSearchParams({
          host: "https://not-allowed.invalid",
          key: settings.publicKey,
        }).toString()}`;
        const blocked = await fetch(blockedUrl, { cache: "no-store" });
        next.push({
          label: "Origin allowlist",
          ok: blocked.status === 404,
          detail:
            blocked.status === 404
              ? "An origin outside the allowlist is refused."
              : `Unexpected ${blocked.status}; check the saved allowlist.`,
        });
      } else {
        next.push({
          label: "Origin allowlist",
          ok: true,
          detail: "Open: any origin may embed the widget.",
        });
      }

      next.push({
        label: "Signed identity",
        ok: !identity.enabled || identity.hasSecret,
        detail: identity.enabled
          ? identity.hasSecret
            ? "SSO is enabled and a signing secret exists."
            : "SSO is enabled but no signing secret exists; rotate one in settings."
          : "Optional: SSO is off, so the widget runs without signed identity.",
      });
    } catch (error) {
      next.push({
        label: "Network check",
        ok: false,
        detail:
          error instanceof Error
            ? error.message
            : "Could not reach the widget endpoints.",
      });
    }

    setChecks(next);
    setChecking(false);
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,370px)_minmax(0,1fr)] xl:gap-6">
      <div className="space-y-5">
        <SettingsSection
          icon={SlidersHorizontal}
          title="General settings"
          description="Choose where the launcher sits, how it looks and which sites may load it."
          badge={
            <Badge
              variant="outline"
              className="border-border/80 bg-muted/40 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground"
            >
              Client SDK
            </Badge>
          }
          footer={
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-[190px] text-[11px] leading-relaxed text-muted-foreground">
                {canManage
                  ? "Changes apply the next time the widget loads."
                  : "Only workspace admins can change this configuration."}
              </p>
              <Button
                type="button"
                size="sm"
                onClick={save}
                disabled={!canManage || saving}
              >
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Launcher position</Label>
                <span className="text-[10.5px] text-muted-foreground">
                  Default: bottom right
                </span>
              </div>
              <div
                role="radiogroup"
                aria-label="Launcher position"
                className="grid grid-cols-2 gap-2"
              >
                {POSITION_OPTIONS.map((option) => {
                  const active = position === option.value;
                  return (
                    <label
                      key={option.value}
                      className={cn(
                        "relative flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2.5 text-[11.5px] font-medium transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
                        active
                          ? "border-primary/45 bg-primary/[0.045] text-foreground ring-1 ring-primary/10"
                          : "border-border bg-card text-muted-foreground hover:bg-muted/40",
                        !canManage && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <input
                        type="radio"
                        name="widget-position"
                        value={option.value}
                        checked={active}
                        onChange={() => setPosition(option.value)}
                        disabled={!canManage}
                        className="sr-only"
                      />
                      <span
                        className={cn(
                          "relative size-5 shrink-0 rounded-[5px] border bg-background",
                          active ? "border-primary/40" : "border-border",
                        )}
                        aria-hidden="true"
                      >
                        <span
                          className={cn(
                            "absolute size-1.5 rounded-full",
                            active ? "bg-primary" : "bg-muted-foreground/35",
                            POSITION_DOT[option.value],
                          )}
                        />
                      </span>
                      <span>{option.label}</span>
                      <Check
                        className={cn(
                          "ml-auto size-3.5 text-primary transition-opacity",
                          active ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden="true"
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Theme</Label>
                <span className="text-[10.5px] text-muted-foreground">
                  Auto follows the visitor
                </span>
              </div>
              <Segmented
                label="Widget theme"
                value={theme}
                onChange={setTheme}
                options={THEME_OPTIONS}
                disabled={!canManage}
                stretch
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Widget sections</Label>
                <span className="text-[10.5px] text-muted-foreground">
                  Changelog always on
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Choose what visitors can open beside the changelog.
              </p>
              <div className="space-y-1.5">
                {SECTION_OPTIONS.map((option) => {
                  const active = sections.includes(option.value);
                  return (
                    <label
                      key={option.value}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 transition-colors",
                        active
                          ? "border-primary/45 bg-primary/[0.045]"
                          : "border-border bg-card hover:bg-muted/40",
                        !canManage && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <Checkbox
                        checked={active}
                        disabled={!canManage}
                        onCheckedChange={(checked) =>
                          setSections((current) =>
                            checked === true
                              ? current.includes(option.value)
                                ? current
                                : [...current, option.value]
                              : current.filter((value) => value !== option.value),
                          )
                        }
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block text-[11.5px] font-medium text-foreground">
                          {option.label}
                        </span>
                        <span className="block text-[10.5px] leading-relaxed text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="widget-origins">Allowed origins</Label>
                <span className="text-[10.5px] text-muted-foreground">
                  Optional
                </span>
              </div>
              <Textarea
                id="widget-origins"
                value={origins}
                onChange={(event) => setOrigins(event.target.value)}
                placeholder={"https://app.example.com\nhttps://staging.example.com"}
                rows={3}
                disabled={!canManage}
                className="min-h-[76px] font-mono text-[11px] leading-relaxed"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                One exact origin per line, including <code>https://</code>. Leave
                empty to allow any origin.
              </p>
            </div>

            <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <Label>Per-origin overrides</Label>
                <span className="text-[10.5px] text-muted-foreground">
                  Optional
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Give one installation a different launcher position or theme. The
                embed reports the override for the origin it was loaded from; an
                explicit <code>data-position</code> or <code>data-theme</code> in
                that installation&apos;s snippet still wins.
              </p>
              {originList.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Add an allowed origin above to create an override.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {originList.map((origin) => {
                    const entry = overrides[origin] ?? {
                      theme: "" as const,
                      position: "" as const,
                    };
                    return (
                      <div
                        key={origin}
                        className="grid gap-1.5 rounded border border-border/70 bg-card p-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
                      >
                        <code className="truncate text-[10.5px] text-foreground">
                          {origin}
                        </code>
                        <select
                          aria-label={`Theme for ${origin}`}
                          value={entry.theme}
                          onChange={(event) =>
                            setOverrides((current) => ({
                              ...current,
                              [origin]: {
                                ...entry,
                                theme: event.target
                                  .value as ConfiguredWidgetTheme | "",
                              },
                            }))
                          }
                          disabled={!canManage}
                          className="h-7 rounded border border-border bg-card px-1.5 text-[11px] text-foreground disabled:opacity-60"
                        >
                          <option value="">Inherit theme</option>
                          {THEME_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label={`Position for ${origin}`}
                          value={entry.position}
                          onChange={(event) =>
                            setOverrides((current) => ({
                              ...current,
                              [origin]: {
                                ...entry,
                                position: event.target
                                  .value as WidgetPosition | "",
                              },
                            }))
                          }
                          disabled={!canManage}
                          className="h-7 rounded border border-border bg-card px-1.5 text-[11px] text-foreground disabled:opacity-60"
                        >
                          <option value="">Inherit position</option>
                          {POSITION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          icon={Code2}
          title="Installation snippet"
          description={
            <>
              Add this once before <code>&lt;/body&gt;</code>. The loader reads
              its project, key and launcher defaults from the tag. The Widget
              sections above decide which optional panels are served, including
              for already-installed tags. The snippet follows your current
              choices; save them to apply the same sections live.
            </>
          }
          badge={
            <Badge
              variant="outline"
              className="border-border/80 bg-muted/40 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground"
            >
              Async · v1
            </Badge>
          }
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <KeyRound className="size-3" aria-hidden="true" />
                Public key is safe to ship.
              </span>
              <Link
                href={frameHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                Open widget frame
                <ExternalLink className="size-3" aria-hidden="true" />
              </Link>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="overflow-hidden rounded-lg border border-[#2f2c28] bg-[#1c1b19] shadow-inner">
              <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
                <span className="font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-white/40">
                  HTML
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => copyText(currentSnippet, "Installation snippet")}
                  className="h-6 gap-1.5 rounded px-2 text-[10px] text-white/65 hover:bg-white/10 hover:text-white"
                >
                  <Copy className="size-3" aria-hidden="true" />
                  Copy script
                </Button>
              </div>
              <pre className="max-h-44 overflow-auto p-3 font-mono text-[10px] leading-[1.7] text-[#f4f3ee] [scrollbar-color:rgba(255,255,255,0.25)_transparent] [scrollbar-width:thin]">
                <code>{currentSnippet}</code>
              </pre>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="widget-public-key">Public key</Label>
              <div className="relative">
                <Input
                  id="widget-public-key"
                  value={settings.publicKey}
                  readOnly
                  className="h-8 pr-9 font-mono text-[10.5px]"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Copy public key"
                  onClick={() => copyText(settings.publicKey, "Public key")}
                  className="absolute right-0.5 top-0.5 size-7 text-muted-foreground"
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-border/80 bg-muted/25 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <ShieldCheck
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-[11.5px] font-medium text-foreground">
                      Ping verification
                    </p>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
                      Checks the loader, key and origin gate.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void verify()}
                  disabled={checking}
                  className="h-7 px-2 text-[10.5px]"
                >
                  {checking ? "Testing…" : "Test widget ping"}
                </Button>
              </div>

              {checks ? (
                <ul aria-live="polite" className="mt-2.5 space-y-1.5">
                  {checks.map((check) => (
                    <li
                      key={check.label}
                      className="flex items-start gap-1.5 text-[10.5px] leading-relaxed"
                    >
                      {check.ok ? (
                        <CheckCircle2
                          className="mt-0.5 size-3 shrink-0 text-success"
                          aria-hidden="true"
                        />
                      ) : (
                        <XCircle
                          className="mt-0.5 size-3 shrink-0 text-destructive"
                          aria-hidden="true"
                        />
                      )}
                      <span>
                        <span className="font-medium text-foreground">
                          {check.label}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {check.detail}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
              <KeyRound className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              <span>
                Signed identity uses the workspace SSO secret.{" "}
                <Link
                  href={`/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
                    productSlug,
                  )}/settings#identity`}
                  className="font-medium text-primary hover:underline"
                >
                  Rotate identity secret
                </Link>
              </span>
            </p>
          </div>
        </SettingsSection>
      </div>

      <WidgetPreviewCard
        position={position}
        theme={theme}
        preview={{ ...preview, sections }}
      />
    </div>
  );
}
