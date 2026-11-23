import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Clock3,
  Download,
  Mail,
  MessageSquare,
  Minus,
  Sparkles,
} from "lucide-react";

import { getPortalAnalytics } from "@/features/analytics/portal";
import {
  cleanEventSteps,
  getAnalyticsFreshness,
  getBoardAnalytics,
  getEventFunnel,
  getSignupCohorts,
  getTagAnalytics,
  listEventNames,
} from "@/features/analytics/insights";
import { getRevenueAnalytics } from "@/features/analytics/revenue";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAnalyticsOverview,
  type AnalyticsMetric,
  type AnalyticsOverview,
} from "@/features/reporting/overview";
import { ReportsPanel } from "@/features/reporting/reports-panel";
import { getReportDashboard, listSavedReports } from "@/features/reporting/service";
import { resolveProductPage } from "@/lib/product-page";
import { formatNumber, formatPercent } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";

export const metadata = { title: "Analytics" };

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  under_review: "Under review",
  planned: "Planned",
  in_progress: "In progress",
  shipped: "Shipped",
  closed: "Closed",
};

function metric(
  overview: AnalyticsOverview,
  key: AnalyticsMetric,
): number {
  return overview.totals[key] ?? 0;
}

function conversion(overview: AnalyticsOverview): number | null {
  const started = metric(overview, "submit_started");
  return started > 0 ? metric(overview, "submissions") / started : null;
}

function durationLabel(value: number | null, empty: string): string {
  if (value === null) return empty;
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

function StatCard({
  title,
  value,
  detail,
  delta,
  href,
  icon: Icon,
}: {
  title: string;
  value: string;
  detail: string;
  delta?: number | null;
  href?: string;
  icon: typeof BarChart3;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {title}
            </p>
            <p className="mt-2 [font-family:var(--font-archivo)] text-[27px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
              {value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
            {delta !== undefined ? (
              <p
                className={`mt-1.5 inline-flex items-center gap-1 text-[11px] ${
                  delta === null || delta === 0
                    ? "text-muted-foreground"
                    : delta > 0
                      ? "text-emerald-600"
                      : "text-rose-600"
                }`}
              >
                {delta === null || delta === 0 ? (
                  <Minus className="size-3" aria-hidden="true" />
                ) : delta > 0 ? (
                  <ArrowUpRight className="size-3" aria-hidden="true" />
                ) : (
                  <ArrowDownRight className="size-3" aria-hidden="true" />
                )}
                {delta === null
                  ? "No previous baseline"
                  : `${Math.abs(delta).toFixed(1)}% vs previous 30 days`}
              </p>
            ) : null}
            {href ? (
              <Link
                href={href}
                className="mt-2 inline-block text-[11px] font-medium text-primary hover:underline"
              >
                View rows
              </Link>
            ) : null}
          </div>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function freshnessLabel(updatedAt: string | null): string {
  if (!updatedAt) return "Rollups have not run yet";
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(updatedAt).getTime()) / 60_000),
  );
  if (minutes < 1) return "Rollups updated just now";
  if (minutes < 60) return `Rollups updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Rollups updated ${hours} hr ago`;
  return `Rollups updated ${Math.floor(hours / 24)} d ago`;
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function DailyBars({
  overview,
  metricKey,
  label,
}: {
  overview: AnalyticsOverview;
  metricKey: AnalyticsMetric;
  label: string;
}) {
  const max = Math.max(
    1,
    ...overview.series.map((point) => point.metrics[metricKey] ?? 0),
  );
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">Last {overview.days} days</p>
      </div>
      <div
        className="mt-3 flex h-24 items-end gap-1"
        role="img"
        aria-label={`${label} by day`}
      >
        {overview.series.map((point) => {
          const value = point.metrics[metricKey] ?? 0;
          return (
            <div
              key={point.day}
              className="min-w-0 flex-1 rounded-t-sm bg-primary/70"
              style={{ height: `${Math.max(4, (value / max) * 100)}%` }}
              title={`${point.day}: ${formatNumber(value)}`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
        <span>{overview.from}</span>
        <span>{overview.to}</span>
      </div>
    </div>
  );
}

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{ step?: string | string[]; days?: string; cohortMonths?: string }>;
}) {
    const query = await searchParams;
  const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "analytics:read");
  const canManageReports = hasPermission(context.role, "settings:manage");
  const funnelDays = Math.min(Math.max(Number(query.days) || 30, 1), 90);
  const cohortMonths = Math.min(Math.max(Number(query.cohortMonths) || 6, 1), 12);
  const [overview, portal, reports, reportCards, eventNames, freshness, tags, boards, cohorts, revenue] =
    await Promise.all([
    getAnalyticsOverview({
      workspaceId: context.workspace.id,
      productId: context.product.id,
      days: 30,
    }),
    getPortalAnalytics({
      workspaceId: context.workspace.id,
      productId: context.product.id,
      days: 30,
    }),
    listSavedReports(context.workspace.id, context.product.id),
    getReportDashboard(
      { workspaceId: context.workspace.id, productId: context.product.id },
    ),
    listEventNames(context.product.id),
    getAnalyticsFreshness(context.product.id),
    getTagAnalytics({ productId: context.product.id, days: 30 }),
    getBoardAnalytics({ productId: context.product.id, days: 30 }),
    getSignupCohorts({
      workspaceId: context.workspace.id,
      productId: context.product.id,
      months: cohortMonths,
    }),
    canManageReports ? getRevenueAnalytics(context.workspace.id) : Promise.resolve(null),
  ]);

  const requestedSteps = cleanEventSteps(
    Array.isArray(query.step) ? query.step : query.step ? [query.step] : [],
  );
  const steps =
    requestedSteps.length > 0
      ? requestedSteps
      : query.step === undefined
        ? eventNames.slice(0, 4).map((event) => event.name)
        : [];
  const funnel =
    steps.length > 0
      ? await getEventFunnel({
          productId: context.product.id,
          steps,
          days: funnelDays,
        })
      : null;
  const basePath = `/app/${workspaceSlug}/${productSlug}`;

  const pageViews =
    metric(overview, "board_views") +
    metric(overview, "request_views") +
    metric(overview, "portal_page_views");
  const submitConversion = conversion(overview);
  const topFunnel = overview.funnel
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxFunnel = Math.max(1, ...topFunnel.map((row) => row.count));
  const maxPortal = Math.max(1, ...portal.funnel.map((step) => step.count));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="The customer loop, measured from real events and daily rollups. Times are UTC days."
        meta={
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
              freshness.updatedAt ? "bg-muted/40" : "bg-amber-50 text-amber-800"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                freshness.updatedAt ? "bg-emerald-500" : "bg-amber-500"
              }`}
              aria-hidden="true"
            />
            {freshnessLabel(freshness.updatedAt)}
          </span>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <a href={`/api/app/${workspaceSlug}/${productSlug}/analytics/events/export?days=30`}>
              <Download className="size-4" aria-hidden="true" />
              Export events CSV
            </a>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Public views"
          value={formatNumber(pageViews)}
          detail={`${formatNumber(metric(overview, "board_views"))} board · ${formatNumber(metric(overview, "request_views"))} request · ${formatNumber(metric(overview, "portal_page_views"))} roadmap/updates`}
          delta={overview.comparison.board_views}
          href={`${basePath}/analytics/drilldown?dataset=product_activity&metric=board_views&days=30`}
          icon={BarChart3}
        />
        <StatCard
          title="Submissions"
          value={formatNumber(metric(overview, "submissions"))}
          detail={
            submitConversion === null
              ? "No submit form opens recorded"
              : `${formatPercent(submitConversion * 100)} of form opens converted`
          }
          delta={overview.comparison.submissions}
          href={`${basePath}/analytics/drilldown?dataset=product_activity&metric=submissions&days=30`}
          icon={MessageSquare}
        />
        <StatCard
          title="Votes"
          value={formatNumber(metric(overview, "votes"))}
          detail={`${formatNumber(metric(overview, "widget_opens"))} widget opens`}
          delta={overview.comparison.votes}
          href={`${basePath}/analytics/drilldown?dataset=feedback&metric=votes_cast&days=30`}
          icon={Sparkles}
        />
        <StatCard
          title="Email delivery"
          value={
            overview.emailDeliveryRate === null
              ? "—"
              : formatPercent(overview.emailDeliveryRate * 100)
          }
          detail={`${formatNumber(metric(overview, "emails_sent"))} sent · ${formatNumber(metric(overview, "emails_failed"))} failed`}
          delta={overview.comparison.emails_sent}
          href={`${basePath}/analytics/drilldown?dataset=product_activity&metric=emails_sent&days=30`}
          icon={Mail}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Volume</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <DailyBars overview={overview} metricKey="board_views" label="Board views" />
            <DailyBars overview={overview} metricKey="submissions" label="Submissions" />
            <DailyBars overview={overview} metricKey="votes" label="Votes" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Clock3 className="size-4" aria-hidden="true" />
              Support and shipping
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-center justify-between gap-3 border-b pb-3">
              <span className="text-muted-foreground">Conversations started</span>
              <span className="font-medium tabular-nums">
                {formatNumber(metric(overview, "conversations_started"))}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 border-b pb-3">
              <span className="text-muted-foreground">Conversations resolved</span>
              <span className="font-medium tabular-nums">
                {formatNumber(metric(overview, "conversations_resolved"))}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 border-b pb-3">
              <span className="text-muted-foreground">Average first team response</span>
              <span className="font-medium">
                {durationLabel(overview.averageFirstResponseMinutes, "No team reply yet")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 border-b pb-3">
              <span className="text-muted-foreground">Average time to ship</span>
              <span className="font-medium">
                {durationLabel(overview.averageTimeToShipMinutes, "Nothing shipped yet")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 border-b pb-3">
              <span className="text-muted-foreground">CSAT</span>
              <span className="font-medium tabular-nums">
                {overview.csatAverage === null
                  ? "No ratings yet"
                  : `${overview.csatAverage.toFixed(1)} / 5 · ${formatNumber(overview.csatResponses)} of ${formatNumber(overview.csatRequested)}`}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Juno resolved</span>
              <span className="font-medium tabular-nums">
                {formatNumber(overview.junoResolved)} / {formatNumber(overview.junoInvolved)}
              </span>
            </div>
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Status changes are captured by a database trigger, so API, import,
              merge and publishing paths all feed the funnel and ship time.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Current status funnel</CardTitle>
        </CardHeader>
        <CardContent>
          {topFunnel.length === 0 ? (
            <p className="text-sm text-muted-foreground">No feedback yet.</p>
          ) : (
            <div className="space-y-3">
              {topFunnel.map((row) => (
                <div key={row.status} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {STATUS_LABELS[row.status] ?? row.status}
                  </span>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(row.count / maxFunnel) * 100}%` }}
                    />
                  </div>
                  <span className="text-right tabular-nums">{formatNumber(row.count)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">CSAT by operator</CardTitle>
        </CardHeader>
        <CardContent>
          {overview.csatByOperator.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No resolved conversations with CSAT enabled in this window.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Operator</th>
                    <th className="py-2 pr-4 font-medium">Average</th>
                    <th className="py-2 pr-4 font-medium">Responses</th>
                    <th className="py-2 font-medium">Response rate</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.csatByOperator.map((row) => (
                    <tr key={row.operatorId ?? "unassigned"} className="border-b last:border-0">
                      <td className="py-2 pr-4">{row.name}</td>
                      <td className="py-2 pr-4 tabular-nums">
                        {row.average === null ? "—" : `${row.average.toFixed(2)} / 5`}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {formatNumber(row.responses)} of {formatNumber(row.requested)}
                      </td>
                      <td className="py-2 tabular-nums">
                        {row.requested === 0
                          ? "—"
                          : `${Math.round((row.responses / row.requested) * 100)}%`}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-medium">
                    <td className="py-2 pr-4">Team</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {overview.csatAverage === null
                        ? "—"
                        : `${overview.csatAverage.toFixed(2)} / 5`}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      {formatNumber(overview.csatResponses)} of{" "}
                      {formatNumber(overview.csatRequested)}
                    </td>
                    <td className="py-2 tabular-nums">
                      {overview.csatRequested === 0
                        ? "—"
                        : `${Math.round(
                            (overview.csatResponses / overview.csatRequested) * 100,
                          )}%`}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Threads are credited to their current assignee. Unassigned threads stay in
            their own row so the leaderboard cannot hide them.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Portal analytics</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <div className="space-y-3">
            {portal.funnel.map((step, index) => (
              <div key={step.key}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{step.label}</span>
                  <span className="font-medium tabular-nums">
                    {formatNumber(step.count)}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(step.count / maxPortal) * 100}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {index === 0
                    ? `${formatNumber(portal.visitorDays)} visitor-days`
                    : step.rate === null
                      ? "No previous-step baseline"
                      : `${formatPercent(step.rate * 100)} of previous step`}
                </p>
              </div>
            ))}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Page views
              </p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {portal.pages.length === 0 ? (
                  <li className="text-muted-foreground">No portal views yet.</li>
                ) : (
                  portal.pages.map((page) => (
                    <li key={page.page} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{page.page}</span>
                      <span className="tabular-nums">{formatNumber(page.views)}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Top boards
              </p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {portal.topBoards.length === 0 ? (
                  <li className="text-muted-foreground">No board views yet.</li>
                ) : (
                  portal.topBoards.map((board) => (
                    <li key={board.id} className="flex justify-between gap-3">
                      <span className="truncate text-muted-foreground">{board.name}</span>
                      <span className="tabular-nums">{formatNumber(board.views)}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Event funnel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <form action={`${basePath}/analytics`} method="get" className="grid gap-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_7rem_auto]">
            {[0, 1, 2, 3].map((index) => (
              <Input
                key={index}
                name="step"
                list="analytics-event-names"
                placeholder={`Step ${index + 1} event`}
                defaultValue={steps[index] ?? ""}
                aria-label={`Funnel step ${index + 1}`}
              />
            ))}
            <select
              name="days"
              defaultValue={String(funnelDays)}
              aria-label="Funnel window"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
            <Button type="submit" size="sm">
              Build
            </Button>
            <datalist id="analytics-event-names">
              {eventNames.map((event) => (
                <option key={event.name} value={event.name} />
              ))}
            </datalist>
          </form>
          <p className="text-xs text-muted-foreground">
            Ordered by customer. A later step only counts after the previous event, so
            later activity cannot satisfy an earlier step. {eventNames.length} event names
            recorded in the last 90 days.
          </p>

          {funnel === null || funnel.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add at least one event name to build a funnel.
            </p>
          ) : (
            <div className="space-y-3">
              {funnel.steps.map((step, index) => (
                <div key={step.name}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{step.name}</span>
                    <span className="font-medium tabular-nums">
                      {formatNumber(step.count)}
                      {step.rate === null ? "" : ` · ${formatPercent(step.rate * 100)}`}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${(step.count / Math.max(1, funnel.steps[0]?.count ?? 1)) * 100}%`,
                      }}
                    />
                  </div>
                  {index > 0 ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {step.dropped === 0
                        ? "No drop-off"
                        : `${formatNumber(step.dropped ?? 0)} dropped after ${funnel.steps[index - 1]?.name}`}
                    </p>
                  ) : null}
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">
                {funnel.from} to {funnel.to} · {funnel.days} days
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Retention by signup month</CardTitle>
        </CardHeader>
        <CardContent>
          {cohorts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No signups in the last {cohortMonths} months.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Signup month</th>
                    <th className="py-2 pr-4 font-medium">Customers</th>
                    {Array.from({ length: cohortMonths }, (_, index) => (
                      <th key={index} className="py-2 pr-4 font-medium">
                        M+{index}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cohorts.map((cohort) => (
                    <tr key={cohort.month} className="border-b last:border-0">
                      <td className="py-2 pr-4">{monthLabel(cohort.month)}</td>
                      <td className="py-2 pr-4 tabular-nums">{formatNumber(cohort.size)}</td>
                      {cohort.retained.map((value, index) => (
                        <td key={index} className="py-2 pr-4 tabular-nums">
                          {value === null
                            ? "—"
                            : `${Math.round((value / Math.max(1, cohort.size)) * 100)}%`}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Retained means the customer sent any event to this product in that calendar month.
            M+0 is the signup month. Future months are blank.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">By board</CardTitle>
          </CardHeader>
          <CardContent>
            {boards.length === 0 ? (
              <p className="text-sm text-muted-foreground">No boards yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Board</th>
                    <th className="py-2 pr-3 text-right font-medium">Requests</th>
                    <th className="py-2 pr-3 text-right font-medium">Votes</th>
                    <th className="py-2 text-right font-medium">Shipped</th>
                  </tr>
                </thead>
                <tbody>
                  {boards.map((board) => (
                    <tr key={board.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">{board.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatNumber(board.requests)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatNumber(board.votes)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatNumber(board.shipped)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">Requests created in the last 30 days.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">By tag</CardTitle>
          </CardHeader>
          <CardContent>
            {tags.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tagged requests in the last 30 days.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Tag</th>
                    <th className="py-2 pr-3 text-right font-medium">Requests</th>
                    <th className="py-2 pr-3 text-right font-medium">Votes</th>
                    <th className="py-2 text-right font-medium">Shipped</th>
                  </tr>
                </thead>
                <tbody>
                  {tags.map((tag) => (
                    <tr key={tag.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="size-2 rounded-full bg-muted-foreground/40"
                            style={tag.color ? { backgroundColor: tag.color } : undefined}
                            aria-hidden="true"
                          />
                          {tag.name}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatNumber(tag.requests)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatNumber(tag.votes)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatNumber(tag.shipped)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">Requests created in the last 30 days.</p>
          </CardContent>
        </Card>
      </div>

      {revenue ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Revenue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">MRR</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{usd.format(revenue.mrr)}</p>
                <p className="text-xs text-muted-foreground">{revenue.active} active · {revenue.trialing} trialing</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Churn (30d)</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{usd.format(revenue.churn.mrr)}</p>
                <p className="text-xs text-muted-foreground">{revenue.churn.workspaceCount} workspace{revenue.churn.workspaceCount === 1 ? "" : "s"}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Expansion (30d)</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600">+{usd.format(revenue.expansion.mrr)}</p>
                <p className="text-xs text-muted-foreground">{revenue.expansion.workspaceCount} upgrade{revenue.expansion.workspaceCount === 1 ? "" : "s"}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Contraction (30d)</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-rose-600">−{usd.format(revenue.contraction.mrr)}</p>
                <p className="text-xs text-muted-foreground">{revenue.contraction.workspaceCount} downgrade{revenue.contraction.workspaceCount === 1 ? "" : "s"}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
              {revenue.planMix.map((plan) => (
                <span key={plan.plan}>
                  {plan.name}: {plan.count} · {usd.format(plan.mrr)}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              MRR uses the plan catalogue&apos;s monthly price and excludes one-time lifetime
              payments. Churn is canceled, past-due or unpaid subscriptions updated in the last
              30 days. Expansion and contraction need a plan change recorded by the billing webhook.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <ReportsPanel
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        reports={reports}
        cards={reportCards}
        canManage={canManageReports}
      />
    </div>
  );
}
