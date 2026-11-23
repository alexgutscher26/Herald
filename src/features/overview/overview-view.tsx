"use client";

import { ViewerTimeZone } from "@/components/shared/dual-timestamp";

import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Circle,
  Gift,
  Inbox,
  Mail,
  Map,
  MessageSquare,
  Plus,
  Rocket,
  Send,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { MetricCard } from "@/components/shared/metric-card";
import { ReleaseCover } from "@/components/shared/release-cover";
import {
  FeedbackStatusBadge,
  ReleaseStatusBadge,
  StatusBadge,
} from "@/components/shared/status-badge";
import {
  DEFAULT_TRIAL_DAYS,
  SETUP_COMPLETE_TRIAL_DAYS,
} from "@/features/billing/trial";
import type { SetupChecklist } from "@/features/overview/setup-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getActiveSubscriberCount,
  getFeedbackForProduct,
  getReleasesForProduct,
  getRouteContext,
  getVoteCount,
} from "@/features/live/selectors";
import { useDashboard } from "@/features/live/store";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Release, ReleaseStatus } from "@/types";

const CLOSED_FEEDBACK = new Set(["shipped", "closed"]);

/** Ranges the overview's release metric can be scoped to. */
const RANGES = [7, 30, 90] as const;

const PIPELINE: { status: ReleaseStatus; label: string; bar: string }[] = [
  { status: "draft", label: "Drafts", bar: "bg-muted-foreground/35" },
  { status: "scheduled", label: "Scheduled", bar: "bg-info" },
  { status: "published", label: "Published", bar: "bg-success" },
  { status: "archived", label: "Archived", bar: "bg-muted-foreground/20" },
];

/** When the row last changed, not when a future publication is due. */
function releaseInstant(release: Release): string {
  if (release.status === "published" && release.publishedAt) return release.publishedAt;
  return release.updatedAt;
}

type ActivityItem = {
  id: string;
  at: string;
  icon: LucideIcon;
  label: string;
  detail: string;
  href: string;
};

export function OverviewView({
  workspaceSlug,
  productSlug,
  days,
  setup,
  setupOffer,
  winback,
}: {
  workspaceSlug: string;
  productSlug: string;
  days: number;
  setup: SetupChecklist;
  /** Show the paid-trial reward only while the workspace is on Free. */
  setupOffer: boolean;
  winback: { matched: number; eligible: number };
}) {
  const { state } = useDashboard();
  const context = getRouteContext(state, workspaceSlug, productSlug);

  const data = useMemo(() => {
    if (!context) return null;

    const releases = getReleasesForProduct(state, context.product.id);
    const feedback = getFeedbackForProduct(state, context.product.id);
    const activeSubscribers = getActiveSubscriberCount(state, context.product.id);
    const votes = feedback.reduce((total, post) => total + getVoteCount(state, post.id), 0);
    const openFeedback = feedback.filter((post) => !CLOSED_FEEDBACK.has(post.status));
    const scheduled = releases
      .filter((release) => release.status === "scheduled")
      .sort(
        (a, b) =>
          new Date(a.scheduledFor ?? a.updatedAt).getTime() -
          new Date(b.scheduledFor ?? b.updatedAt).getTime(),
      );

    const activity: ActivityItem[] = [
      ...releases.map((release) => ({
        id: `release-${release.id}`,
        at: releaseInstant(release),
        icon: release.status === "scheduled" ? CalendarClock : Rocket,
        label:
          release.status === "published"
            ? "Release published"
            : release.status === "scheduled"
              ? "Release scheduled"
              : release.status === "archived"
                ? "Release archived"
                : "Draft updated",
        detail: release.title,
        href: `/app/${workspaceSlug}/${productSlug}/releases/${release.id}/edit`,
      })),
      ...feedback.map((post) => ({
        id: `feedback-${post.id}`,
        at: post.createdAt,
        icon: MessageSquare,
        label: "New feedback",
        detail: post.title,
        href: `/app/${workspaceSlug}/${productSlug}/feedback?post=${post.id}`,
      })),
    ]
      .filter((item) => Number.isFinite(new Date(item.at).getTime()))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 8);

    return {
      releases,
      feedback,
      activeSubscribers,
      votes,
      openFeedback,
      scheduled,
      activity,
    };
  }, [context, state, workspaceSlug, productSlug]);

  if (!context || !data) {
    return (
      <EmptyState
        title="Product not found"
        description="This workspace or product is not available to your account."
      />
    );
  }

  const { workspace, product } = context;
  const base = `/app/${workspace.slug}/${product.slug}`;
  const now = new Date(state.liveNow);
  const {
    releases,
    feedback,
    activeSubscribers,
    votes,
    openFeedback,
    scheduled,
    activity,
  } = data;

  const drafts = releases.filter((release) => release.status === "draft");
  const published = releases.filter((release) => release.status === "published");
  const windowStart = now.getTime() - days * 24 * 60 * 60 * 1000;
  const publishedInWindow = published.filter((release) => {
    if (!release.publishedAt) return false;
    const at = new Date(release.publishedAt).getTime();
    return Number.isFinite(at) && at >= windowStart;
  }).length;
  // The roadmap is a projection of request status; there is no second list.
  const roadmapInProgress = feedback.filter((post) =>
    ["planned", "in_progress"].includes(post.status),
  );
  const roadmapShipped = feedback.filter((post) => post.status === "shipped");
  const roadmapTotal = roadmapInProgress.length + roadmapShipped.length;
  const newFeedback = feedback.filter((post) => post.status === "new");
  const nextScheduled = scheduled[0] ?? null;
  const recentReleases = releases.slice(0, 4);
  const recentFeedback = feedback.slice(0, 5);
  const totalReleases = releases.length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description={`What is happening in ${product.name} right now.`}
        actions={
          <>
            <Button asChild size="sm">
              <Link href={`${base}/releases/new`}>
                <Plus aria-hidden="true" />
                New release
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`${base}/feedback`}>
                <Inbox aria-hidden="true" />
                Open inbox
              </Link>
            </Button>
          </>
        }
        meta={
          <>
            <span>Times shown in {workspace.timezone}</span>
            <span aria-hidden="true">·</span>
            <ViewerTimeZone timeZone={workspace.timezone} />
            <span aria-hidden="true">·</span>
            <span>
              {releases.length} releases · {feedback.length} feedback requests
            </span>
            <span aria-hidden="true">·</span>
            <nav aria-label="Release metric range" className="flex items-center gap-1">
              <span>Range</span>
              {RANGES.map((range) => (
                <Link
                  key={range}
                  href={`${base}?days=${range}`}
                  aria-current={days === range ? "true" : undefined}
                  className={cn(
                    "rounded px-1.5 py-0.5 tabular-nums transition-colors",
                    days === range
                      ? "bg-primary/10 font-medium text-primary"
                      : "hover:bg-muted hover:text-foreground",
                  )}
                >
                  {range}d
                </Link>
              ))}
            </nav>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="Published releases"
          value={publishedInWindow}
          hint={`Last ${days} days · ${drafts.length} drafts · ${scheduled.length} scheduled`}
          definition={`Releases with a publication date inside the selected ${days}-day range. Drafts and scheduled entries are not published yet.`}
          icon={Rocket}
        />
        <MetricCard
          label="Open feedback"
          value={openFeedback.length}
          hint={`${feedback.length} total · ${votes} ${votes === 1 ? "vote" : "votes"}`}
          definition="Feedback requests that are not shipped or closed. Votes come from authenticated workspace members."
          icon={MessageSquare}
        />
        <MetricCard
          label="Active subscribers"
          value={activeSubscribers}
          hint={
            activeSubscribers === 0
              ? "Nobody is subscribed to product updates yet"
              : "Included when a release queues subscriber email"
          }
          definition="Subscribers with an active subscription. Publishing records one pending delivery for each active subscriber."
          icon={Mail}
        />
        <MetricCard
          label="Roadmap requests"
          value={roadmapTotal}
          hint={`${roadmapInProgress.length} active · ${roadmapShipped.length} shipped`}
          definition="Requests in Planned, In progress or Shipped status. The roadmap is their projection, not a second list."
          icon={Map}
        />
        <MetricCard
          label="Win-back opportunities"
          value={winback.matched}
          hint={
            winback.matched === 0
              ? "No reason-to-release matches yet"
              : `${winback.eligible} contactable right now`
          }
          definition="Former customers whose recorded cancellation reason is linked to a published release. Counts explicit links only; there is no scoring or inferred match."
          icon={Undo2}
        />
      </div>

      {setup.completed < setup.total ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Finish setting up {product.name}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {setup.completed} of {setup.total} steps complete. Each step is derived from
                  saved records, so it cannot be ticked without the work existing.
                </p>
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                {Math.round((setup.completed / setup.total) * 100)}%
              </span>
            </div>
            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`Setup ${setup.completed} of ${setup.total} steps complete`}
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${(setup.completed / setup.total) * 100}%` }}
              />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="divide-y">
              {setup.steps.map((step) => (
                <li key={step.id}>
                  <Link
                    href={step.href}
                    className="flex items-start gap-3 py-2.5 transition-colors hover:bg-muted/40 sm:rounded-md sm:px-2"
                  >
                    {step.done ? (
                      <CheckCircle2
                        className="mt-0.5 size-4 shrink-0 text-success"
                        aria-hidden="true"
                      />
                    ) : (
                      <Circle
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground/60"
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{step.label}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {step.done ? step.detail : step.description}
                      </span>
                    </span>
                    {step.done ? (
                      <StatusBadge tone="success">Done</StatusBadge>
                    ) : (
                      <span className="shrink-0 text-xs font-medium text-primary">Set up</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            {setupOffer ? (
              <div className="mt-3 flex items-start gap-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 px-3 py-2.5">
                <Gift className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Finish all {setup.total} steps and your paid trial becomes{" "}
                    {SETUP_COMPLETE_TRIAL_DAYS} days.
                  </span>{" "}
                  Indie or Professional, instead of {DEFAULT_TRIAL_DAYS}. It is applied
                  automatically at checkout.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : setupOffer ? (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="flex items-start gap-3 py-4">
            <CheckCircle2
              className="mt-0.5 size-5 shrink-0 text-success"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium">
                Setup complete — your {SETUP_COMPLETE_TRIAL_DAYS}-day trial is unlocked
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Start Indie or Professional and the trial runs {SETUP_COMPLETE_TRIAL_DAYS} days
                instead of {DEFAULT_TRIAL_DAYS}. Checkout applies it automatically; there is no
                code to remember.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link href={`/app/${workspaceSlug}/settings#billing`}>
                  Start a trial
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
              <div>
                <CardTitle>Recent releases</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  The latest entries in your changelog.
                </p>
              </div>
              <Button asChild variant="ghost" size="sm" className="-mr-2">
                <Link href={`${base}/releases`}>
                  View all
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {recentReleases.length === 0 ? (
                <EmptyState
                  compact
                  icon={Rocket}
                  title="No releases yet"
                  description="Write your first changelog entry. Save it as a draft, schedule it, or publish immediately."
                  action={
                    <Button asChild size="sm">
                      <Link href={`${base}/releases/new`}>
                        <Plus aria-hidden="true" />
                        Create release
                      </Link>
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y">
                  {recentReleases.map((release) => {
                    const date = release.publishedAt ?? release.scheduledFor;
                    return (
                      <li key={release.id}>
                        <Link
                          href={`${base}/releases/${release.id}/edit`}
                          className="flex items-start gap-3 py-3 transition-colors first:pt-1 hover:bg-muted/40 sm:rounded-md sm:px-2"
                        >
                          <ReleaseCover
                            cover={release.cover}
                            accentColor={product.accentColor}
                            productInitial={product.name.charAt(0)}
                            className="h-10 w-16 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium">{release.title}</span>
                              <ReleaseStatusBadge status={release.status} />
                            </div>
                            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                              {release.summary || "No summary yet."}
                            </p>
                            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                              <span>
                                {date
                                  ? `${release.publishedAt ? "Published" : "Scheduled"} ${formatDateTime(date, workspace.timezone)}`
                                  : "Not scheduled"}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{release.authorName}</span>
                            </p>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
              <div>
                <CardTitle>Recent feedback</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {openFeedback.length === 0
                    ? "Everything is triaged."
                    : `${openFeedback.length} ${openFeedback.length === 1 ? "request needs" : "requests need"} attention.`}
                </p>
              </div>
              <Button asChild variant="ghost" size="sm" className="-mr-2">
                <Link href={`${base}/feedback`}>
                  Open inbox
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {recentFeedback.length === 0 ? (
                <EmptyState
                  compact
                  icon={MessageSquare}
                  title="No feedback yet"
                  description="Requests submitted for this product appear here with their status and vote count."
                  action={
                    <Button asChild size="sm" variant="outline">
                      <Link href={`${base}/feedback`}>
                        <Inbox aria-hidden="true" />
                        Open inbox
                      </Link>
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y">
                  {recentFeedback.map((post) => (
                    <li key={post.id}>
                      <Link
                        href={`${base}/feedback?post=${post.id}`}
                        className="flex items-start gap-3 py-3 transition-colors first:pt-1 hover:bg-muted/40 sm:rounded-md sm:px-2"
                      >
                        <span className="mt-0.5 flex w-9 shrink-0 flex-col items-center rounded border bg-background py-1 text-xs font-semibold tabular-nums">
                          <MessageSquare
                            className="mb-0.5 size-3 text-muted-foreground"
                            aria-hidden="true"
                          />
                          {getVoteCount(state, post.id)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium">{post.title}</span>
                            <FeedbackStatusBadge status={post.status} />
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {post.description}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {post.authorName} · {formatRelative(post.createdAt, now)}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Needs attention</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Work that is waiting on the team.
              </p>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <AttentionRow
                href={`${base}/releases?status=scheduled`}
                icon={CalendarClock}
                label="Scheduled releases"
                count={scheduled.length}
                detail={
                  nextScheduled?.scheduledFor
                    ? `Next ${formatDateTime(nextScheduled.scheduledFor, workspace.timezone)}`
                    : "Nothing scheduled"
                }
                tone={scheduled.length > 0 ? "info" : "neutral"}
              />
              <AttentionRow
                href={`${base}/releases?status=draft`}
                icon={Rocket}
                label="Draft releases"
                count={drafts.length}
                detail={drafts.length === 0 ? "No drafts waiting" : "Not published yet"}
                tone="neutral"
              />
              <AttentionRow
                href={`${base}/feedback`}
                icon={Inbox}
                label="New feedback"
                count={newFeedback.length}
                detail={newFeedback.length === 0 ? "Inbox is clear" : "Waiting for triage"}
                tone={newFeedback.length > 0 ? "warning" : "neutral"}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Release pipeline</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {totalReleases === 0
                  ? "No releases yet."
                  : `${totalReleases} ${totalReleases === 1 ? "release" : "releases"} across every status.`}
              </p>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {PIPELINE.map((stage) => {
                const count = releases.filter((release) => release.status === stage.status).length;
                const percent = totalReleases === 0 ? 0 : Math.round((count / totalReleases) * 100);
                return (
                  <div key={stage.status}>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium">{stage.label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {count} · {percent}%
                      </span>
                    </div>
                    <div
                      className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                      role="img"
                      aria-label={`${stage.label}: ${count} of ${totalReleases} releases`}
                    >
                      <div
                        className={cn("h-full rounded-full", stage.bar)}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link href={`${base}/releases`}>
                  Manage releases
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Feedback snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0 text-sm">
              <SnapshotRow label="Open" value={openFeedback.length} />
              <SnapshotRow
                label="Shipped"
                value={feedback.filter((post) => post.status === "shipped").length}
              />
              <SnapshotRow
                label="Closed"
                value={feedback.filter((post) => post.status === "closed").length}
              />
              <SnapshotRow label="Votes cast" value={votes} />
              <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
                Counts include every feedback request for this product, including merged requests.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Recent activity</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Release, feedback and roadmap updates across this product.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          {activity.length === 0 ? (
            <EmptyState
              compact
              icon={Send}
              title="No activity yet"
              description="Create a release or add a feedback request to start the timeline."
            />
          ) : (
            <ol className="space-y-0">
              {activity.map((item, index) => (
                <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {index < activity.length - 1 ? (
                    <span
                      aria-hidden="true"
                      className="absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-px bg-border"
                    />
                  ) : null}
                  <span className="relative z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
                    <item.icon className="size-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <Link
                        href={item.href}
                        className="truncate text-sm font-medium hover:text-primary"
                      >
                        {item.detail}
                      </Link>
                      <span className="text-[11px] text-muted-foreground">{item.label}</span>
                    </div>
                    <p
                      className="mt-0.5 text-[11px] text-muted-foreground"
                      title={formatDateTime(item.at, workspace.timezone)}
                    >
                      {formatRelative(item.at, now)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AttentionRow({
  href,
  icon: Icon,
  label,
  count,
  detail,
  tone,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  count: number;
  detail: string;
  tone: "info" | "warning" | "neutral";
}) {
  const toneClasses = {
    info: "bg-info-muted text-info",
    warning: "bg-warning-muted text-warning",
    neutral: "bg-muted text-muted-foreground",
  } as const;

  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-md border p-2.5 transition-colors hover:bg-muted/50"
    >
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", toneClasses[tone])}>
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{detail}</span>
      </span>
      <span className="text-lg font-semibold tabular-nums">{count}</span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function SnapshotRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}
