import Link from "next/link";

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
  createOutboundMessageAction,
  deleteOutboundMessageAction,
  setOutboundFrequencyCapsAction,
  setOutboundStatusAction,
} from "@/features/engagement/actions";
import { listOutboundMessages } from "@/features/engagement/service";
import { listSegmentOptions } from "@/features/segments/service";
import { resolveProductPage } from "@/lib/product-page";

export const metadata = { title: "Outbound messages" };

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm";
const TEXTAREA_CLASS =
  "w-full rounded-md border border-input bg-card p-3 font-mono text-xs leading-5";

export default async function OutboundPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
    const status = await searchParams;
  const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "settings:manage");
  const [messages, segments] = await Promise.all([
    listOutboundMessages(context.product.id),
    listSegmentOptions(context.product.id),
  ]);
  const hidden = (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="productSlug" value={productSlug} />
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outbound messages"
        description="Audience rules, delivery windows, one-shot or recurring sends, per-message analytics and the existing suppression and delivery log."
      />
      {status.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {status.error}
        </p>
      ) : null}
      {status.saved ? (
        <p className="rounded-md border border-success/30 bg-success-muted px-3 py-2 text-sm text-success">
          Saved. Delivery is processed by the job runner.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Frequency cap</CardTitle>
          <CardDescription>
            Applies to every outbound email and in-app message in this workspace.
            A capped customer is skipped at delivery time, not just in the preview.
            Set the cap to 0 to disable it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={setOutboundFrequencyCapsAction}
            className="flex flex-wrap items-end gap-3"
          >
            {hidden}
            <div className="space-y-1.5">
              <Label htmlFor="outbound-cap">Messages per customer</Label>
              <Input
                id="outbound-cap"
                name="cap"
                type="number"
                min={0}
                max={100}
                defaultValue={context.workspace.outboundFrequencyCap}
                className="w-32"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="outbound-cap-window">Rolling window (days)</Label>
              <Input
                id="outbound-cap-window"
                name="windowDays"
                type="number"
                min={1}
                max={365}
                defaultValue={context.workspace.outboundFrequencyWindowDays}
                className="w-32"
              />
            </div>
            <Button size="sm" variant="outline" type="submit">
              Save cap
            </Button>
            <p className="text-xs text-muted-foreground">
              Currently{" "}
              {context.workspace.outboundFrequencyCap === 0
                ? "unlimited"
                : `${context.workspace.outboundFrequencyCap} per ${context.workspace.outboundFrequencyWindowDays} day${context.workspace.outboundFrequencyWindowDays === 1 ? "" : "s"}`}
              .
            </p>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Card>
          <CardHeader>
            <CardTitle>Messages</CardTitle>
            <CardDescription>
              Email uses the suppression list, the delivery outbox and the existing
              sender. In-app messages land in the customer inbox.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No outbound messages yet.</p>
            ) : (
              messages.map((message) => (
                <div key={message.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/app/${workspaceSlug}/${productSlug}/outbound/${message.id}`}
                        className="font-medium hover:underline"
                      >
                        {message.name}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {message.channel} · {message.status} · {message.recurrence} ·{" "}
                        {message.windowStart}–{message.windowEnd} {message.timezone} ·{" "}
                        {message.audience.length} rules
                        {message.segmentId ? " · segment" : ""}
                      </p>
                      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                        {message.title} — {message.body}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <form action={setOutboundStatusAction}>
                        {hidden}
                        <input type="hidden" name="messageId" value={message.id} />
                        <select
                          name="status"
                          defaultValue={message.status}
                          className={SELECT_CLASS}
                          aria-label={`Status for ${message.name}`}
                        >
                          <option value="draft">Draft</option>
                          <option value="scheduled">Scheduled</option>
                          <option value="active">Active</option>
                          <option value="paused">Paused</option>
                          <option value="completed">Completed</option>
                        </select>
                        <Button size="sm" variant="outline" type="submit">
                          Save
                        </Button>
                      </form>
                      <form action={deleteOutboundMessageAction}>
                        {hidden}
                        <input type="hidden" name="messageId" value={message.id} />
                        <Button size="sm" variant="destructive" type="submit">
                          Delete
                        </Button>
                      </form>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>New message</CardTitle>
            <CardDescription>
              Page URL, time-on-page and selector rules apply to in-app delivery.
              Attribute rules apply to both channels.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createOutboundMessageAction} className="space-y-3">
              {hidden}
              <div className="space-y-1.5">
                <Label htmlFor="outbound-name">Name</Label>
                <Input id="outbound-name" name="name" required maxLength={160} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="outbound-channel">Channel</Label>
                  <select id="outbound-channel" name="channel" className={SELECT_CLASS}>
                    <option value="in_app">In-app</option>
                    <option value="email">Email</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="outbound-recurrence">Recurrence</Label>
                  <select id="outbound-recurrence" name="recurrence" className={SELECT_CLASS}>
                    <option value="one_shot">One-shot</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="outbound-title">Title</Label>
                <Input id="outbound-title" name="title" required maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="outbound-body">Body</Label>
                <textarea id="outbound-body" name="body" required rows={4} className={TEXTAREA_CLASS} />
              </div>
              <fieldset className="space-y-3 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">Spanish translation (optional)</legend>
                <div className="space-y-1.5">
                  <Label htmlFor="outbound-title-es">Título</Label>
                  <Input id="outbound-title-es" name="translationTitleEs" maxLength={200} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="outbound-body-es">Mensaje</Label>
                  <textarea
                    id="outbound-body-es"
                    name="translationBodyEs"
                    rows={3}
                    className={TEXTAREA_CLASS}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="outbound-cta-label-es">CTA label</Label>
                  <Input id="outbound-cta-label-es" name="translationCtaLabelEs" maxLength={80} />
                </div>
              </fieldset>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="outbound-cta-label">CTA label</Label>
                  <Input id="outbound-cta-label" name="ctaLabel" maxLength={80} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="outbound-cta-url">CTA URL</Label>
                  <Input id="outbound-cta-url" name="ctaUrl" maxLength={2000} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="outbound-audience">Audience rules (JSON, optional)</Label>
                <textarea
                  id="outbound-audience"
                  name="audience"
                  rows={4}
                  className={TEXTAREA_CLASS}
                  placeholder='[{"type":"attribute","key":"plan","operator":"equals","value":"pro"}]'
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="outbound-segment">Segment (optional)</Label>
                <select id="outbound-segment" name="segmentId" className={SELECT_CLASS}>
                  <option value="">No segment — audience rules only</option>
                  {segments.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  A segment is combined with the rules above. An in-app segment only reaches
                  identified customers. Create one on Segments.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="outbound-start">Start</Label>
                  <Input id="outbound-start" name="scheduleStart" type="datetime-local" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="outbound-end">End</Label>
                  <Input id="outbound-end" name="scheduleEnd" type="datetime-local" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="outbound-window-start">Window start</Label>
                  <Input
                    id="outbound-window-start"
                    name="windowStart"
                    type="time"
                    defaultValue="00:00"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="outbound-window-end">Window end</Label>
                  <Input
                    id="outbound-window-end"
                    name="windowEnd"
                    type="time"
                    defaultValue="23:59"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="outbound-timezone">Send-window timezone</Label>
                <TimeZoneSelect
                  id="outbound-timezone"
                  name="timezone"
                  value="UTC"
                  className={SELECT_CLASS}
                />
                <p className="text-xs text-muted-foreground">
                  An IANA timezone. The window is evaluated in this zone; a bad value falls
                  back to UTC.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" />
                Schedule immediately
              </label>
              <Button type="submit" className="w-full">
                Create message
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
