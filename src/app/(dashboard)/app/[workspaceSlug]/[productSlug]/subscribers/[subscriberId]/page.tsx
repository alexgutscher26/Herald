import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSubscriberDetail } from "@/db/queries/subscribers";
import { SubscriberDataControls } from "@/features/subscribers/subscriber-data-controls";
import { requireProductContext } from "@/lib/authz";
import { formatDate, formatDateTime } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";

export const metadata = { title: "Subscriber" };

const SOURCE_LABELS: Record<string, string> = {
  widget: "Widget",
  import: "Import",
  api: "API",
  manual: "Manual",
  follower: "Follower",
};

const TEMPLATE_LABELS: Record<string, string> = {
  release_published: "Release update",
  winback_campaign: "Win-back campaign",
  feedback_status_changed: "Request status",
  feedback_reply: "Request reply",
  conversation_reply: "Support reply",
  conversation_csat: "Support rating",
  conversation_notification: "Operator alert",
  conversation_away_reply: "Away reply",
  conversation_transcript: "Transcript",
  weekly_digest: "Weekly digest",
  daily_digest: "Daily digest",
  outbound_message: "Outbound message",
};

const STATUS_TONES = {
  active: "success",
  pending: "warning",
  unsubscribed: "neutral",
} as const;

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[10px] border bg-card p-4 shadow-[0_1px_2px_rgba(23,22,20,0.04)]">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 [font-family:var(--font-archivo)] text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
        {typeof value === "number" ? value.toLocaleString("en") : value}
      </p>
    </div>
  );
}

export default async function SubscriberDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string; subscriberId: string }>;
}) {
  const { workspaceSlug, productSlug, subscriberId } = await params;
  const context = await requireProductContext(workspaceSlug, productSlug, "subscriber:read");
  const detail = await getSubscriberDetail({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    subscriberId,
  });
  if (!detail) notFound();

  const { subscriber, customer, events, emails, engagement, topics } = detail;
  const timeZone = "UTC";
  const traits = Object.entries(customer?.traits ?? {});

  return (
    <div className="space-y-5">
      <PageHeader
        title={subscriber.email}
        description={`${subscriber.name ?? "No name"} · ${SOURCE_LABELS[subscriber.source] ?? subscriber.source} · added ${formatDate(subscriber.createdAt, timeZone)}`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/${workspaceSlug}/${productSlug}/subscribers`}>
              <ArrowLeft aria-hidden="true" />
              Back
            </Link>
          </Button>
        }
        meta={
          <>
            <StatusBadge tone={STATUS_TONES[subscriber.status]}>
              {subscriber.status}
            </StatusBadge>
            {subscriber.customerId ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Linked customer</span>
              </>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Emails delivered" value={engagement.delivered} />
        <Metric label="Opens" value={engagement.opened} />
        <Metric label="Clicks" value={engagement.clicked} />
        <Metric label="Requests authored" value={engagement.feedbackAuthored} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Source and consent</CardTitle>
            <CardDescription>How this address entered the list and what it agreed to.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Source</dt>
                <dd className="mt-0.5 font-medium">
                  {SOURCE_LABELS[subscriber.source] ?? subscriber.source}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Added</dt>
                <dd className="mt-0.5">{formatDateTime(subscriber.createdAt, timeZone)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Confirmed</dt>
                <dd className="mt-0.5">
                  {subscriber.confirmedAt
                    ? formatDateTime(subscriber.confirmedAt, timeZone)
                    : subscriber.status === "active"
                      ? "Not required"
                      : "Not confirmed"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Confirmation email</dt>
                <dd className="mt-0.5">
                  {subscriber.confirmationSentAt
                    ? formatDateTime(subscriber.confirmationSentAt, timeZone)
                    : "Never sent"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Unsubscribed</dt>
                <dd className="mt-0.5">
                  {subscriber.unsubscribedAt
                    ? formatDateTime(subscriber.unsubscribedAt, timeZone)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Win-back opt-out</dt>
                <dd className="mt-0.5">
                  {subscriber.winbackOptedOutAt
                    ? formatDateTime(subscriber.winbackOptedOutAt, timeZone)
                    : "Not opted out"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Preferences</CardTitle>
            <CardDescription>What this address currently receives.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-1.5">
              {subscriber.status === "active" ? <Chip label="Product updates" /> : null}
              {subscriber.notifyStatusChanges ? <Chip label="Request status" /> : null}
              {subscriber.notifyReplies ? <Chip label="Replies" /> : null}
              {subscriber.digestFrequency !== "off" ? (
                <Chip label={`${subscriber.digestFrequency} digest`} />
              ) : null}
              {topics
                .filter((topic) => !topic.builtIn && topic.subscribed)
                .map((topic) => (
                  <Chip key={topic.key} label={topic.name} />
                ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Preferences are changed by the subscriber through the tokenised link in any email.
              The team can change status here, not consent wording.
            </p>

            <SubscriberDataControls
              workspaceSlug={workspaceSlug}
              productSlug={productSlug}
              subscriberId={subscriber.id}
              email={subscriber.email}
              pendingConfirmation={subscriber.status === "pending"}
              canWrite={hasPermission(context.role, "subscriber:write")}
              canErase={context.role === "owner"}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Traits</CardTitle>
            <CardDescription>
              Customer attributes recorded by the API, SDK or intake questions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {traits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No traits recorded.</p>
            ) : (
              <dl className="grid gap-2 text-sm">
                {traits.map(([key, value]) => (
                  <div key={key} className="flex items-start justify-between gap-3">
                    <dt className="font-mono text-xs text-muted-foreground">{key}</dt>
                    <dd className="text-right">
                      {typeof value === "string" || typeof value === "number"
                        ? String(value)
                        : JSON.stringify(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {customer ? (
              <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                Customer since {formatDate(customer.createdAt, timeZone)}
                {customer.lastSeenAt
                  ? ` · last seen ${formatDateTime(customer.lastSeenAt, timeZone)}`
                  : ""}
                {customer.verifiedAt ? " · email verified" : ""}
                {customer.crmLifecycleStage ? ` · CRM: ${customer.crmLifecycleStage}` : ""}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Events</CardTitle>
            <CardDescription>
              Product activity recorded for the linked customer on this product.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No product events yet.</p>
            ) : (
              <ul className="divide-y rounded-md border text-sm">
                {events.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="font-mono text-xs">{event.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(event.occurredAt, timeZone)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Emails received</CardTitle>
            <CardDescription>
              The delivery log for this address on this product, newest first.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {emails.length === 0 ? (
              <p className="text-sm text-muted-foreground">No emails have been sent yet.</p>
            ) : (
              <ul className="divide-y rounded-md border text-sm">
                {emails.map((email) => (
                  <li
                    key={email.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {TEMPLATE_LABELS[email.template] ?? email.template}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {email.sentAt
                          ? `Sent ${formatDateTime(email.sentAt, timeZone)}`
                          : `Created ${formatDateTime(email.createdAt, timeZone)}`}
                        {email.error ? ` · ${email.error}` : ""}
                      </p>
                    </div>
                    <StatusBadge
                      tone={
                        email.status === "sent"
                          ? "success"
                          : email.status === "failed" || email.status === "bounced"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {email.status}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              {engagement.bounced} bounced · {engagement.complained} complained
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}
