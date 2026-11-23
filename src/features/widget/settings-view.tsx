"use client";

import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  ExternalLink,
  KeyRound,
  Lock,
  Monitor,
  Moon,
  RefreshCw,
  Search,
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
import { useState, useTransition, type CSSProperties } from "react";
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
import { cn } from "@/lib/utils";

import {
  type ConfiguredWidgetTheme,
  type WidgetOriginOverride,
  type WidgetPosition,
  type WidgetSection,
} from "./policy";
import { saveWidgetSettingsAction } from "./settings-actions";
import type { WidgetSettingsView } from "./settings";

type Check = { label: string; ok: boolean; detail: string };

export type WidgetPreviewEntry = {
  id: string;
  title: string;
  summary: string;
  category: "feature" | "improvement" | "fix";
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

const SECTION_LABELS: Record<WidgetSection, string> = {
  help: "Help",
  feedback: "Feedback",
  roadmap: "Roadmap",
  messages: "Messages",
};

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

function CategoryPill({ category }: { category: WidgetPreviewEntry["category"] }) {
  const label =
    category === "feature"
      ? "Feature"
      : category === "improvement"
        ? "Improvement"
        : "Fix";

  return (
    <span
      className={cn(
        "inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
        category === "feature"
          ? "bg-primary/10 text-primary"
          : category === "improvement"
            ? "bg-info-muted text-info"
            : "bg-warning-muted text-warning",
      )}
    >
      {label}
    </span>
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
  const border = "border-border/70";
  const muted = "text-muted-foreground";
  const panelSurface = "border-border/80 bg-card text-card-foreground";
  const accent = accessibleAccent(preview.accentColor);
  const panelScope = {
    "--brand-accent-light": accent.onLight,
    "--brand-accent-light-fg": accent.foregroundOnLight,
    "--brand-accent-dark": accent.onDark,
    "--brand-accent-dark-fg": accent.foregroundOnDark,
  } as CSSProperties;
  const launcherText = foregroundFor(preview.accentColor);

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "absolute z-10 inline-flex items-center gap-2 rounded-full px-3.5 py-2.5 text-[11px] font-semibold shadow-[0_10px_24px_rgba(23,22,20,0.22)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
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
        "absolute z-10 flex max-h-[calc(100%-4.25rem)] flex-col overflow-hidden rounded-xl border shadow-[0_20px_48px_rgba(23,22,20,0.24)]",
        panelSurface,
        PREVIEW_POSITION[position],
        device === "mobile"
          ? "w-[calc(100%-1rem)]"
          : "w-[min(304px,calc(100%-1.5rem))]",
      )}
      style={panelScope}
    >
      <div
        className={cn(
          "flex shrink-0 items-start justify-between gap-2 border-b px-3.5 py-3",
          border,
        )}
      >
        <div className="flex min-w-0 items-start gap-2">
          <span
            className="mt-1 size-2 shrink-0 rounded-full"
            style={{ backgroundColor: preview.accentColor }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-semibold leading-tight">
              What&apos;s new in {preview.productName}
            </p>
            <p className={cn("mt-0.5 truncate text-[10px]", muted)}>
              Latest product updates
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {preview.entries.length > 0 ? (
            <span
              className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary"
            >
              {preview.entries.length} new
            </span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close widget preview"
                          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {preview.sections.length > 0 ? (
        <div
          className={cn(
            "flex shrink-0 items-center gap-1 overflow-hidden border-b px-3 py-1.5 text-[9.5px]",
            border,
          )}
        >
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
            What&apos;s new
          </span>
          {preview.sections.map((section) => (
            <span key={section} className={cn("rounded px-1.5 py-0.5", muted)}>
              {SECTION_LABELS[section]}
            </span>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 overflow-y-auto [scrollbar-width:thin]">
        {preview.entries.length === 0 ? (
          <div className="px-4 py-7 text-center">
            <span
              className={cn(
                "mx-auto flex size-8 items-center justify-center rounded-full border text-muted-foreground",
                border,
              )}
            >
              <Bell className="size-3.5" aria-hidden="true" />
            </span>
            <p className="mt-2 text-[11.5px] font-medium">
              No published updates yet
            </p>
            <p className={cn("mt-1 text-[10px] leading-relaxed", muted)}>
              Publish a changelog entry to see it here.
            </p>
          </div>
        ) : (
          preview.entries.slice(0, 2).map((entry, index) => (
            <article
              key={entry.id}
              className={cn(
                "px-3.5 py-3",
                index < Math.min(preview.entries.length, 2) - 1 && "border-b",
                border,
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <CategoryPill category={entry.category} />
                <span className={cn("text-[9.5px]", muted)}>
                  {entry.publishedLabel}
                </span>
              </div>
              <h4 className="mt-1.5 text-[11.5px] font-semibold leading-snug">
                {entry.title}
              </h4>
              <p
                className={cn(
                  "mt-1 line-clamp-2 text-[10px] leading-relaxed",
                  muted,
                )}
              >
                {entry.summary}
              </p>
            </article>
          ))
        )}
      </div>

      <div className={cn("shrink-0 border-t px-3 py-2", border)}>
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px]",
            border,
            "bg-muted/30",
            muted,
          )}
        >
          <Search className="size-3 shrink-0" aria-hidden="true" />
          <span>Search updates…</span>
        </div>
      </div>

      <div
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2.5 text-[9.5px]",
          border,
          muted,
        )}
      >
        <span
          className="inline-flex items-center gap-1 font-medium text-primary"
        >
          View all updates
          <ArrowRight className="size-2.5" aria-hidden="true" />
        </span>
        {preview.showAttribution ? <span>Powered by Herald</span> : null}
      </div>
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
              its project, key, position, theme and sections from the tag.
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
                  onClick={() => copyText(snippet, "Installation snippet")}
                  className="h-6 gap-1.5 rounded px-2 text-[10px] text-white/65 hover:bg-white/10 hover:text-white"
                >
                  <Copy className="size-3" aria-hidden="true" />
                  Copy script
                </Button>
              </div>
              <pre className="max-h-44 overflow-auto p-3 font-mono text-[10px] leading-[1.7] text-[#f4f3ee] [scrollbar-color:rgba(255,255,255,0.25)_transparent] [scrollbar-width:thin]">
                <code>{snippet}</code>
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
