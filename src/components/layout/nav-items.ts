import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  FileJson,
  LayoutDashboard,
  LayoutGrid,
  Mail,
  ListChecks,
  Map,
  MessageSquare,
  MessagesSquare,
  Send,
  Sparkles,
  Plug,
  Puzzle,
  Rocket,
  Settings,
  ShieldCheck,
  Undo2,
  type LucideIcon,
} from "lucide-react";

import type { Permission } from "@/lib/permissions";

export const NAV_GROUPS = ["Customer loop", "Publish", "Grow", "Configure"] as const;

export type NavGroup = (typeof NAV_GROUPS)[number];

export type NavItem = {
  label: string;
  /** Sidebar group. Order is defined by NAV_GROUPS. */
  group: NavGroup;
  /** Path segment below the product root; `""` is the overview. */
  segment: string;
  href: string;
  icon: LucideIcon;
  description: string;
  /**
   * Permission required to *manage* this area. Navigation stays visible so an
   * editor can still read the data; the page disables mutations and explains
   * the role restriction. Production routes additionally enforce this
   * server-side.
   */
  permission: Permission;
  /**
   * Whether the section is backed by a working page. Unavailable sections are
   * left out of the primary navigation while W1–W7 are in progress: a
   * placeholder page is not a destination. They stay in this list so a direct
   * URL still gets a breadcrumb and a clear "not built yet" page.
   */
  available: boolean;
};

/** Single source of truth for dashboard navigation. */
export function getNavItems(
  workspaceSlug: string,
  productSlug: string,
  options: { includeUnavailable?: boolean } = {},
): NavItem[] {
  const base = `/app/${workspaceSlug}/${productSlug}`;

  const items: NavItem[] = [
    {
      label: "Overview",
      group: "Customer loop",
      segment: "",
      href: base,
      icon: LayoutDashboard,
      description: "Activity and product summary.",
      permission: "workspace:read",
      available: true,
    },
    {
      label: "Releases",
      group: "Publish",
      segment: "releases",
      href: `${base}/releases`,
      icon: Rocket,
      description: "Draft, schedule and publish changelog entries.",
      permission: "release:read",
      available: true,
    },
    {
      label: "Feedback",
      group: "Customer loop",
      segment: "feedback",
      href: `${base}/feedback`,
      icon: MessageSquare,
      description: "Collect, triage and connect customer feedback.",
      permission: "feedback:read",
      available: true,
    },
    {
      label: "Inbox",
      group: "Customer loop",
      segment: "conversations",
      href: `${base}/conversations`,
      icon: MessagesSquare,
      description: "Answer customer conversations and keep internal notes.",
      permission: "conversation:read",
      available: true,
    },
    {
      label: "Moderation",
      group: "Customer loop",
      segment: "moderation",
      href: `${base}/moderation`,
      icon: ShieldCheck,
      description: "Review flagged requests, comments and sensitive content.",
      permission: "moderation:read",
      available: true,
    },
    {
      label: "Boards",
      group: "Publish",
      segment: "boards",
      href: `${base}/boards`,
      icon: LayoutGrid,
      description: "Public feedback boards, URLs and moderation rules.",
      permission: "settings:manage",
      available: true,
    },
    {
      label: "Roadmap",
      group: "Publish",
      segment: "roadmap",
      href: `${base}/roadmap`,
      icon: Map,
      description: "Plan what is next and publish a public view.",
      permission: "roadmap:read",
      available: true,
    },
    {
      label: "Help center",
      group: "Publish",
      segment: "help",
      href: `${base}/help`,
      icon: BookOpen,
      description: "Collections, articles, drafts and public help search.",
      permission: "settings:manage",
      available: true,
    },
    {
      label: "API docs",
      group: "Publish",
      segment: "api-docs",
      href: `${base}/api-docs`,
      icon: FileJson,
      description: "Versioned OpenAPI documents, diffs and the playground.",
      permission: "settings:manage",
      available: true,
    },
    {
      label: "Widget",
      group: "Publish",
      segment: "widget",
      href: `${base}/widget`,
      icon: Puzzle,
      description: "Configure and embed the What's New widget.",
      permission: "widget:manage",
      available: true,
    },
    {
      label: "Surveys",
      group: "Grow",
      segment: "surveys",
      href: `${base}/surveys`,
      icon: ListChecks,
      description: "Targeted NPS, CSAT and custom surveys.",
      permission: "settings:manage",
      available: true,
    },
    {
      label: "Tours & banners",
      group: "Grow",
      segment: "experiences",
      href: `${base}/experiences`,
      icon: Sparkles,
      description: "In-product tours and pinned banners.",
      permission: "settings:manage",
      available: true,
    },
    {
      label: "Outbound",
      group: "Grow",
      segment: "outbound",
      href: `${base}/outbound`,
      icon: Send,
      description: "Targeted one-shot and recurring messages.",
      permission: "settings:manage",
      available: true,
    },
    {
      label: "Subscribers",
      group: "Grow",
      segment: "subscribers",
      href: `${base}/subscribers`,
      icon: Mail,
      description: "Product-update subscribers, preferences and suppressions.",
      permission: "subscriber:read",
      available: true,
    },
    {
      label: "Segments",
      group: "Grow",
      segment: "segments",
      href: `${base}/segments`,
      icon: ListChecks,
      description: "Reusable audiences for outbound messages and win-back.",
      permission: "subscriber:read",
      available: true,
    },
    {
      label: "Win-back",
      group: "Grow",
      segment: "winback",
      href: `${base}/winback`,
      icon: Undo2,
      description: "Match cancellation reasons to shipped releases.",
      permission: "winback:read",
      available: true,
    },
    {
      label: "Analytics",
      group: "Grow",
      segment: "analytics",
      href: `${base}/analytics`,
      icon: BarChart3,
      description: "Release, widget and email performance.",
      permission: "analytics:read",
      available: true,
    },
    {
      label: "Operations",
      group: "Configure",
      segment: "operations",
      href: `${base}/operations`,
      icon: Activity,
      description: "Background jobs and delivery health for this product.",
      permission: "settings:manage",
      available: true,
    },
    {
      label: "Integrations",
      group: "Configure",
      segment: "integrations",
      href: `${base}/integrations`,
      icon: Plug,
      description: "Turn Slack messages into feedback requests.",
      permission: "integration:manage",
      available: true,
    },
    {
      label: "Import & export",
      group: "Configure",
      segment: "import",
      href: `${base}/import`,
      icon: ArrowLeftRight,
      description: "Bring feedback in from a CSV or download everything.",
      permission: "settings:manage",
      available: true,
    },
    {
      label: "Settings",
      group: "Configure",
      segment: "settings",
      href: `${base}/settings`,
      icon: Settings,
      description: "Product, team, domain and email settings.",
      permission: "settings:manage",
      available: true,
    },
  ];

  return options.includeUnavailable
    ? items
    : items.filter((item) => item.available);
}
