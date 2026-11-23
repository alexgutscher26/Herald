import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { TimeZoneSelect } from "@/components/shared/timezone-select";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  setOutboundStatusAction,
  updateOutboundCadenceAction,
} from "@/features/engagement/actions";
import {
  getOutboundAnalytics,
  previewOutboundAudience,
} from "@/features/engagement/service";
import { outboundDeliveryPreview } from "@/features/jobs/outbound-handlers";
import { requireProductContext } from "@/lib/authz";

export const metadata = { title: "Outbound analytics" };

function formatRate(rate: number | null): string {
  return rate === null ? "No deliveries yet" : `${rate}% of delivered`;
}

function dateTimeLocal(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16) : "";
}

function PreviewCount({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span>{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </li>
  );
}

export default async function OutboundDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string; messageId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { workspaceSlug, productSlug, messageId } = await params;
  const status = await searchParams;
  const context = await requireProductContext(workspaceSlug, productSlug, "settings:manage");
  const analytics = await getOutboundAnalytics(context.product.id, messageId);
  if (!analytics) notFound();
  const audiencePreview = await previewOutboundAudience({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    audience: analytics.message.audience,
    segmentId: analytics.message.segmentId,
    channel: analytics.message.channel,
  });
  const deliveries =
    analytics.message.channel === "email"
      ? await outboundDeliveryPreview(context.product.id, messageId)
      : [];
  const hidden = (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="productSlug" value={productSlug} />
      <input type="hidden" name="messageId" value={messageId} />
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={analytics.message.name}
        description={`${analytics.message.channel} · ${analytics.message.status} · ${analytics.message.recurrence}`}
      />
      {status.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {status.error}
        </p>
      ) : null}
      {status.saved ? (
        <p className="rounded-md border border-success/30 bg-success-muted px-3 py-2 text-sm text-success">
          Saved. The cron runner will process due work.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href={`/app/${workspaceSlug}/${productSlug}/outbound`}>Back</Link>
        </Button>
        <form action={setOutboundStatusAction}>
          {hidden}
          <input
            type="hidden"
            name="status"
            value={analytics.message.status === "active" ? "paused" : "active"}
          />
          <Button type="submit" variant="outline">
            {analytics.message.status === "active" ? "Pause" : "Activate"}
          </Button>
        </form>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Delivered",
            value: analytics.reconciliation.reached,
            detail: `${analytics.reconciliation.deliveryRows} delivery rows`,
          },
          {
            label: "Opened",
            value: analytics.reconciliation.opened,
            detail: formatRate(analytics.reconciliation.openRate),
          },
          {
            label: "Clicked",
            value: analytics.reconciliation.clicked,
            detail: formatRate(analytics.reconciliation.clickRate),
          },
          {
            label: "Converted",
            value: analytics.reconciliation.converted,
            detail: formatRate(analytics.reconciliation.conversionRate),
          },
        ].map((metric) => (
          <Card key={metric.label}>
            <CardContent className="pt-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {metric.label}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{metric.value}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{metric.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Delivered is unique customers with a sent delivery row or a logged in-app send.{" "}
        {analytics.reconciliation.pending} deliveries are pending;{" "}
        {analytics.reconciliation.unattributedEvents} events had no matching recipient
        and are excluded. Opens, clicks and conversions are shown only when the client
        posts them for this message; conversions are not inferred from a click.
      </p>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Audience preview</CardTitle>
            <CardDescription>
              {audiencePreview.total} customers scanned from the saved rules, segment and
              channel. The send step re-checks every rule and the workspace frequency cap
              before queueing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Eligible
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {audiencePreview.eligible}
                </p>
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Excluded
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {audiencePreview.excluded}
                </p>
              </div>
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <PreviewCount label="Banned" value={audiencePreview.banned} />
              <PreviewCount
                label="Outside targeting"
                value={audiencePreview.outside_targeting}
              />
              <PreviewCount
                label="Outside segment"
                value={audiencePreview.segment_mismatch}
              />
              <PreviewCount label="No email" value={audiencePreview.no_email} />
              <PreviewCount label="Suppressed" value={audiencePreview.suppressed} />
              <PreviewCount
                label="Frequency capped"
                value={audiencePreview.frequency_capped}
              />
            </ul>
            <p className="border-t pt-2 text-xs text-muted-foreground">
              {audiencePreview.frequencyCap === 0
                ? "No workspace frequency cap is set."
                : `Cap: ${audiencePreview.frequencyCap} outbound message${audiencePreview.frequencyCap === 1 ? "" : "s"} per customer in ${audiencePreview.frequencyWindowDays} day${audiencePreview.frequencyWindowDays === 1 ? "" : "s"}.`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cadence and send window</CardTitle>
            <CardDescription>
              The scheduler only queues inside this local window. Change the cadence here
              without recreating the message.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={updateOutboundCadenceAction} className="space-y-3">
              {hidden}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cadence-channel">Channel</Label>
                  <select
                    id="cadence-channel"
                    name="channel"
                    defaultValue={analytics.message.channel}
                    className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                  >
                    <option value="in_app">In-app</option>
                    <option value="email">Email</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cadence-recurrence">Recurrence</Label>
                  <select
                    id="cadence-recurrence"
                    name="recurrence"
                    defaultValue={analytics.message.recurrence}
                    className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                  >
                    <option value="one_shot">One-shot</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cadence-window-start">Window start</Label>
                  <Input
                    id="cadence-window-start"
                    name="windowStart"
                    type="time"
                    defaultValue={analytics.message.windowStart}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cadence-window-end">Window end</Label>
                  <Input
                    id="cadence-window-end"
                    name="windowEnd"
                    type="time"
                    defaultValue={analytics.message.windowEnd}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cadence-timezone">Timezone</Label>
                <TimeZoneSelect
                  id="cadence-timezone"
                  name="timezone"
                  value={analytics.message.timezone}
                  className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cadence-start">Start (UTC)</Label>
                  <Input
                    id="cadence-start"
                    name="scheduleStart"
                    type="datetime-local"
                    defaultValue={dateTimeLocal(analytics.message.scheduleStart)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cadence-end">End (UTC)</Label>
                  <Input
                    id="cadence-end"
                    name="scheduleEnd"
                    type="datetime-local"
                    defaultValue={dateTimeLocal(analytics.message.scheduleEnd)}
                  />
                </div>
              </div>
              <Button type="submit" size="sm">
                Save cadence
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Message</CardTitle>
            <CardDescription>{analytics.message.title}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="whitespace-pre-wrap">{analytics.message.body}</p>
            {analytics.message.ctaUrl ? (
              <p className="text-xs text-muted-foreground">
                CTA: {analytics.message.ctaLabel || "Open"} → {analytics.message.ctaUrl}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Window {analytics.message.windowStart}–{analytics.message.windowEnd}{" "}
              {analytics.message.timezone} · {analytics.message.audience.length} audience
              rules · {analytics.message.recurrence}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Delivery log</CardTitle>
            <CardDescription>
              Email deliveries use the shared outbox; in-app delivery is logged as a
              sent event per customer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No deliveries yet.</p>
            ) : (
              deliveries.map((delivery) => (
                <div
                  key={delivery.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs"
                >
                  <span className="min-w-0 truncate">
                    {delivery.customerName || delivery.recipientEmail}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{delivery.status}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
