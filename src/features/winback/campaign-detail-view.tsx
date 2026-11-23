"use client";

import {
  ArrowLeft,
  Check,
  Mail,
  Pause,
  PauseCircle,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
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
  approveCampaignAction,
  markRecipientReturnedAction,
  pauseCampaignAction,
  rejectCampaignAction,
  resumeCampaignAction,
  sendCampaignAction,
  sendCampaignTestAction,
  stopCampaignAction,
  submitCampaignAction,
} from "./actions";
import type { CampaignDetail, CampaignRecipientView } from "./service";

const APPROVAL_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
};

const APPROVAL_TONES: Record<string, StatusTone> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "success",
  rejected: "danger",
};

const SEND_LABELS: Record<string, string> = {
  not_sent: "Not sent",
  sending: "Sending",
  paused: "Paused",
  sent: "Sent",
  partially_sent: "Partially sent",
  failed: "Failed",
};

const SEND_TONES: Record<string, StatusTone> = {
  not_sent: "neutral",
  sending: "warning",
  paused: "warning",
  sent: "success",
  partially_sent: "warning",
  failed: "danger",
};

const RECIPIENT_LABELS: Record<string, string> = {
  pending: "Pending",
  excluded: "Excluded",
  queued: "Queued",
  sent: "Sent",
  bounced: "Bounced",
  failed: "Failed",
};

const RECIPIENT_TONES: Record<string, StatusTone> = {
  pending: "neutral",
  excluded: "neutral",
  queued: "info",
  sent: "success",
  bounced: "danger",
  failed: "danger",
};

const DELIVERY_LABELS: Record<string, string> = {
  pending: "Queued",
  sent: "Delivered to provider",
  skipped: "Skipped",
  failed: "Failed",
  bounced: "Bounced",
  complained: "Complaint",
};

const EXCLUSION_LABELS: Record<string, string> = {
  no_email: "No email address",
  ineligible: "Not marked eligible",
  unsubscribed: "Unsubscribed or globally suppressed",
  winback_opted_out: "Opted out of win-back",
  already_received: "Already received a campaign",
  campaign_not_approved: "Campaign was not approved",
  campaign_stopped: "Campaign was stopped",
};

function exclusionLabel(reason: string): string {
  return EXCLUSION_LABELS[reason] ?? reason.replaceAll("_", " ");
}

export function CampaignDetailView({
  workspaceSlug,
  productSlug,
  detail,
  canManage,
  canApprove,
  allowed,
  testEmail,
}: {
  workspaceSlug: string;
  productSlug: string;
  detail: CampaignDetail;
  canManage: boolean;
  canApprove: boolean;
  allowed: boolean;
  testEmail: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [testRecipient, setTestRecipient] = useState(testEmail);
  const campaign = detail.campaign;

  function transition(
    run: () => Promise<{ ok: true } | { ok: false; error: string }>,
  ): void {
    setError(null);
    startTransition(async () => {
      const result = await run();
      if (!result.ok) {
        setError(result.error);
        toast.error("That action could not be completed", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  function submit(): void {
    transition(() =>
      submitCampaignAction({ workspaceSlug, productSlug, campaignId: campaign.id }),
    );
  }

  function approve(): void {
    transition(() =>
      approveCampaignAction({ workspaceSlug, productSlug, campaignId: campaign.id }),
    );
  }

  function reject(): void {
    transition(() =>
      rejectCampaignAction({ workspaceSlug, productSlug, campaignId: campaign.id }),
    );
  }

  function send(canary: boolean): void {
    setError(null);
    startTransition(async () => {
      const result = await sendCampaignAction({
        workspaceSlug,
        productSlug,
        campaignId: campaign.id,
        canary,
      });
      if (!result.ok) {
        setError(result.error);
        toast.error("The campaign was not sent", { description: result.error });
        return;
      }
      toast.success(canary ? "Canary queued" : "Remaining audience queued", {
        description: `${result.data.queued} queued · ${result.data.excluded} excluded at send time`,
      });
      router.refresh();
    });
  }

  function pause(): void {
    transition(() =>
      pauseCampaignAction({ workspaceSlug, productSlug, campaignId: campaign.id }),
    );
  }

  function resume(): void {
    transition(() =>
      resumeCampaignAction({ workspaceSlug, productSlug, campaignId: campaign.id }),
    );
  }

  function stop(): void {
    transition(() =>
      stopCampaignAction({ workspaceSlug, productSlug, campaignId: campaign.id }),
    );
  }

  function sendTest(): void {
    setError(null);
    startTransition(async () => {
      const result = await sendCampaignTestAction({
        workspaceSlug,
        productSlug,
        campaignId: campaign.id,
        to: testRecipient,
      });
      if (!result.ok) {
        setError(result.error);
        toast.error("Test email was not sent", { description: result.error });
        return;
      }
      toast.success("Test email sent", { description: testRecipient });
    });
  }

  function markReturned(recipient: CampaignRecipientView, basis: "inferred" | "confirmed"): void {
    setError(null);
    startTransition(async () => {
      const result = await markRecipientReturnedAction({
        workspaceSlug,
        productSlug,
        campaignId: campaign.id,
        recipientId: recipient.id,
        basis,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const stopped = campaign.stoppedAt !== null;
  const paused = campaign.sendStatus === "paused";
  const finished = campaign.sendStatus === "sent" || campaign.sendStatus === "partially_sent";
  const releaseReady = !detail.release || detail.release.status === "published";
  const sendBlocked =
    !allowed || stopped || !releaseReady || detail.senderProblem !== null;
  const canSendCanary =
    !sendBlocked &&
    canManage &&
    campaign.approvalStatus === "approved" &&
    campaign.sendStatus === "not_sent";
  const canSendRemaining =
    !sendBlocked &&
    canManage &&
    campaign.approvalStatus === "approved" &&
    campaign.sendStatus === "sending" &&
    detail.canary.sentAt !== null &&
    detail.canary.ready;
  const canStop = allowed && canApprove && !stopped && !finished && campaign.sendStatus !== "failed";
  const canPause = allowed && canApprove && !stopped && campaign.sendStatus === "sending";
  const canResume = allowed && canApprove && !stopped && paused;
  const canTest = allowed && canManage && !stopped;

  const blockedReason = !allowed
    ? "Win-back campaigns are not available on the current plan."
    : detail.senderProblem
      ? detail.senderProblem
      : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={campaign.name}
        description={campaign.description ?? "No message written yet."}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/${workspaceSlug}/${productSlug}/winback`}>
                <ArrowLeft aria-hidden="true" />
                All campaigns
              </Link>
            </Button>
            {campaign.approvalStatus === "draft" && canManage ? (
              <Button type="button" size="sm" onClick={submit} disabled={pending || !allowed}>
                <ShieldCheck aria-hidden="true" />
                Submit for approval
              </Button>
            ) : null}
            {campaign.approvalStatus === "pending_approval" && canApprove ? (
              <>
                <Button type="button" size="sm" onClick={approve} disabled={pending || !allowed}>
                  <Check aria-hidden="true" />
                  Approve
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={reject} disabled={pending || !allowed}>
                  <X aria-hidden="true" />
                  Reject
                </Button>
              </>
            ) : null}
            {canSendCanary ? (
              <ConfirmDialog
                trigger={
                  <Button type="button" size="sm" disabled={pending}>
                    <Send aria-hidden="true" />
                    {pending ? "Queueing…" : "Send canary batch"}
                  </Button>
                }
                title="Send the canary batch?"
                description="A small batch is queued first. The rest of the audience stays pending until these deliveries settle."
                confirmLabel="Send canary"
                onConfirm={() => send(true)}
              />
            ) : null}
            {canSendRemaining ? (
              <ConfirmDialog
                trigger={
                  <Button type="button" size="sm" disabled={pending}>
                    <Send aria-hidden="true" />
                    {pending ? "Queueing…" : "Send remaining audience"}
                  </Button>
                }
                title="Send the remaining audience?"
                description="Every eligible recipient is queued now. This cannot be undone."
                confirmLabel="Send remaining"
                onConfirm={() => send(false)}
              />
            ) : null}
            {canPause ? (
              <Button type="button" variant="outline" size="sm" onClick={pause} disabled={pending}>
                <Pause aria-hidden="true" />
                Pause campaign
              </Button>
            ) : null}
            {canResume ? (
              <Button type="button" size="sm" onClick={resume} disabled={pending}>
                <Play aria-hidden="true" />
                Resume campaign
              </Button>
            ) : null}
            {canStop ? (
              <ConfirmDialog
                trigger={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    disabled={pending}
                  >
                    <PauseCircle aria-hidden="true" />
                    Stop campaign
                  </Button>
                }
                title="Stop this campaign?"
                description="Pending recipients will not be emailed. This cannot be undone."
                confirmLabel="Stop campaign"
                onConfirm={stop}
              />
            ) : null}
          </>
        }
        meta={
          <>
            <StatusBadge tone={APPROVAL_TONES[campaign.approvalStatus] ?? "neutral"}>
              {APPROVAL_LABELS[campaign.approvalStatus] ?? campaign.approvalStatus}
            </StatusBadge>
            <StatusBadge tone={SEND_TONES[campaign.sendStatus] ?? "neutral"}>
              {SEND_LABELS[campaign.sendStatus] ?? campaign.sendStatus}
            </StatusBadge>
            {stopped ? <StatusBadge tone="danger">Stopped</StatusBadge> : null}
            {paused ? <StatusBadge tone="warning">Paused</StatusBadge> : null}
            <span>Created {formatDateTime(campaign.createdAt.toISOString())}</span>
            {campaign.sentAt ? <span>Started {formatDateTime(campaign.sentAt.toISOString())}</span> : null}
          </>
        }
      />

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {blockedReason ? (
        <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          {blockedReason}{" "}
          {detail.senderProblem ? (
            <Link className="underline underline-offset-2" href={`/app/${workspaceSlug}/${productSlug}/settings#sender-identity`}>
              Fix sender identity
            </Link>
          ) : null}
        </p>
      ) : null}

      {stopped ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          This campaign was stopped {formatDateTime(campaign.stoppedAt!.toISOString())}. No remaining
          recipient will be emailed, including any delivery that was already queued.
        </p>
      ) : paused ? (
        <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          This campaign is paused{campaign.pausedAt
            ? ` since ${formatDateTime(campaign.pausedAt.toISOString())}`
            : ""}
          . Queued emails are held, not sent or discarded. Resume to continue, or stop to end
          it permanently.
        </p>
      ) : null}

      {!stopped && !releaseReady && detail.release ? (
        <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          The linked release is not published, so this campaign cannot send or be tested.
        </p>
      ) : null}

      {campaign.approvalStatus === "pending_approval" && !canApprove ? (
        <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          This campaign is waiting for an approver. Approval is a separate permission from
          managing the campaign.
        </p>
      ) : null}

      {campaign.approvalStatus === "approved" && !stopped && campaign.sendStatus === "not_sent" ? (
        <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Sending starts with a canary batch of up to {detail.canary.recipientCount > 0 ? detail.canary.recipientCount : 5}{" "}
          recipients. The rest of the audience is only queued after those deliveries settle.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Recipients" value={detail.counts.total} />
        <Metric label="Excluded" value={detail.counts.excluded} />
        <Metric label="Sent" value={detail.counts.sent} />
        <Metric label="Returns" value={detail.counts.returned} />
        <Metric label="Window ended" value={detail.counts.windowEnded} />
      </div>

      {detail.excludedByReason.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Excluded before sending</CardTitle>
            <CardDescription>
              These customers are part of the product audience but will not receive this
              campaign. The same checks run again immediately before each send.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {detail.excludedByReason.map((entry) => (
                <li key={entry.reason} className="flex items-baseline gap-2">
                  <span className="font-medium tabular-nums">{entry.count}</span>
                  <span className="text-muted-foreground">{exclusionLabel(entry.reason)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Delivery and returns</CardTitle>
            <CardDescription>
              Every recipient is unique per campaign. A delivery is queued only once, and the
              provider call uses that delivery&apos;s dedupe key. A return is counted when a sent
              recipient reconverts within {detail.attributionWindowDays} days of the send;
              &ldquo;inferred&rdquo; is not proof that the email caused it. Once that window
              ends the row shows &ldquo;Window ended&rdquo; and late returns are not attributed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detail.recipients.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recipients were captured for this campaign.</p>
            ) : (
              <div className="max-h-[560px] overflow-auto rounded-md border">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <caption className="sr-only">Campaign recipients and delivery events</caption>
                  <thead className="sticky top-0 border-b bg-muted/80 text-xs text-muted-foreground backdrop-blur">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Recipient</th>
                      <th scope="col" className="px-3 py-2 font-medium">Recipient status</th>
                      <th scope="col" className="px-3 py-2 font-medium">Delivery</th>
                      <th scope="col" className="px-3 py-2 font-medium">Return</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {detail.recipients.map((recipient) => (
                      <tr key={recipient.id} className="align-top">
                        <td className="px-3 py-2.5">
                          <p className="flex items-center gap-1.5 font-medium">
                            {recipient.name ?? "Unnamed customer"}
                            {detail.variantSummary ? (
                              <span className="rounded bg-muted px-1 text-[10px] font-semibold uppercase text-muted-foreground">
                                {recipient.variant}
                              </span>
                            ) : null}
                          </p>
                          <p className="text-xs text-muted-foreground">{recipient.email ?? "No email address"}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge tone={RECIPIENT_TONES[recipient.status] ?? "neutral"}>
                            {RECIPIENT_LABELS[recipient.status] ?? recipient.status}
                          </StatusBadge>
                          {recipient.exclusionReason ? (
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {exclusionLabel(recipient.exclusionReason)}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          {recipient.delivery ? (
                            <>
                              <StatusBadge tone={recipient.delivery.status === "sent" ? "success" : recipient.delivery.status === "failed" || recipient.delivery.status === "bounced" ? "danger" : "neutral"}>
                                {DELIVERY_LABELS[recipient.delivery.status] ?? recipient.delivery.status}
                              </StatusBadge>
                              <p className="mt-1 text-muted-foreground">
                                {recipient.delivery.attempts} attempt{recipient.delivery.attempts === 1 ? "" : "s"}
                                {recipient.delivery.sentAt ? ` · ${formatDateTime(recipient.delivery.sentAt)}` : ""}
                              </p>
                              {recipient.delivery.error ? (
                                <p className="mt-1 max-w-xs break-words text-destructive">{recipient.delivery.error}</p>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-muted-foreground">
                              {recipient.status === "excluded" ? "Not queued" : "Awaiting send"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          {recipient.convertedAt ? (
                            <>
                              <StatusBadge tone={recipient.attributionBasis === "confirmed" ? "success" : "info"}>
                                {recipient.attributionBasis === "confirmed" ? "Confirmed" : "Inferred"}
                              </StatusBadge>
                              <p className="mt-1 text-muted-foreground">{formatDateTime(recipient.convertedAt)}</p>
                              {recipient.attributionBasis === "inferred" && canManage && recipient.attributionOpen ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="mt-1 h-6 px-1.5 text-[11px]"
                                  onClick={() => markReturned(recipient, "confirmed")}
                                  disabled={pending}
                                >
                                  Confirm
                                </Button>
                              ) : null}
                            </>
                          ) : recipient.status === "sent" && canManage && recipient.attributionOpen ? (
                            <div className="flex flex-wrap gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-6 px-1.5 text-[11px]"
                                onClick={() => markReturned(recipient, "confirmed")}
                                disabled={pending}
                              >
                                <RotateCcw aria-hidden="true" className="size-3" />
                                Confirmed
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 px-1.5 text-[11px]"
                                onClick={() => markReturned(recipient, "inferred")}
                                disabled={pending}
                              >
                                Inferred
                              </Button>
                            </div>
                          ) : recipient.status === "sent" && recipient.attributionWindowEnded ? (
                            <>
                              <StatusBadge tone="neutral">Window ended</StatusBadge>
                              <p className="mt-1 text-muted-foreground">
                                Closed {formatDateTime(recipient.attributionWindowEndsAt!)}
                              </p>
                            </>
                          ) : recipient.status === "sent" && recipient.attributionOpen ? (
                            <span className="text-muted-foreground">
                              Open until {formatDateTime(recipient.attributionWindowEndsAt!)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Test email</CardTitle>
              <CardDescription>
                Sends this campaign to one address without touching the audience or the
                campaign status.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="test-recipient" className="text-xs">
                Recipient
              </Label>
              <Input
                id="test-recipient"
                type="email"
                value={testRecipient}
                onChange={(event) => setTestRecipient(event.target.value)}
                disabled={pending || !canTest}
                autoComplete="email"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={sendTest}
                disabled={pending || !canTest || testRecipient.trim().length < 3}
              >
                <Mail aria-hidden="true" />
                Send test
              </Button>
              {!canTest ? (
                <p className="text-xs text-muted-foreground">
                  {stopped
                    ? "This campaign was stopped."
                    : "Testing needs win-back manage permission."}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {detail.variantSummary ? (
            <Card>
              <CardHeader>
                <CardTitle>A/B test</CardTitle>
                <CardDescription>
                  {detail.variantSummary.percent}% of the audience was included, split by a
                  stable hash. Returns are attribution results, not proof of causation.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b bg-muted/30 text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-2 py-1.5 font-medium">Variant</th>
                        <th scope="col" className="px-2 py-1.5 text-right font-medium">Audience</th>
                        <th scope="col" className="px-2 py-1.5 text-right font-medium">Sent</th>
                        <th scope="col" className="px-2 py-1.5 text-right font-medium">Returns</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(["a", "b"] as const).map((variant) => {
                        const stats = detail.variantSummary![variant];
                        return (
                          <tr key={variant}>
                            <td className="px-2 py-1.5 font-semibold uppercase">{variant}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{stats.recipients}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{stats.sent}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{stats.returned}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-1.5 border-t pt-2 text-xs">
                  <p className="font-medium">Variant A</p>
                  <p className="whitespace-pre-line text-muted-foreground">
                    {campaign.description ?? "No message written yet."}
                  </p>
                  <p className="pt-1 font-medium">Variant B</p>
                  <p className="whitespace-pre-line text-muted-foreground">
                    {campaign.messageB ?? "No second message."}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Canary</CardTitle>
              <CardDescription>
                The first batch goes to at most 5 recipients. The full audience stays locked
                until every canary delivery settles. A pause holds queued deliveries without
                discarding them.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {detail.canary.sentAt ? (
                <>
                  <p>
                    <span className="text-muted-foreground">Sent:</span>{" "}
                    {formatDateTime(detail.canary.sentAt)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Recipients:</span>{" "}
                    {detail.canary.recipientCount}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Remaining send:</span>{" "}
                    {detail.canary.ready ? (
                      <span className="text-success">Unlocked</span>
                    ) : (
                      <span className="text-warning">Waiting for canary deliveries</span>
                    )}
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Not started. Sending begins with a small canary batch.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Linked release</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {detail.release ? (
                <>
                  <Link
                    className="font-medium hover:underline"
                    href={`/app/${workspaceSlug}/${productSlug}/releases/${detail.release.id}`}
                  >
                    {detail.release.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    Status: {detail.release.status}. Only a published release can be used by a send.
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No release linked. The email sends customers to the public changelog.
                </p>
              )}
              {detail.reasons.length > 0 ? (
                <div className="border-t pt-2">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Answers these cancellation reasons</p>
                  <div className="flex flex-wrap gap-1">
                    {detail.reasons.map((reason) => (
                      <span key={reason.id} className="rounded border bg-muted/30 px-1.5 py-0.5 text-[11px]">
                        {reason.label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sender</CardTitle>
              <CardDescription>The identity this campaign will use.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {detail.senderProblem ? (
                <p className="rounded border border-warning/40 bg-warning-muted px-2 py-1.5 text-warning">
                  {detail.senderProblem}
                </p>
              ) : (
                <p className="text-success">Ready to send.</p>
              )}
              <p><span className="text-muted-foreground">From:</span> {detail.sender.from || "Not configured"}</p>
              <p><span className="text-muted-foreground">Reply-to:</span> {detail.sender.replyTo ?? "Not set"}</p>
              <p className="whitespace-pre-line"><span className="text-muted-foreground">Address:</span> {detail.sender.postalAddress || "Not set"}</p>
              <p className="border-t pt-2 leading-relaxed text-muted-foreground">
                The footer includes the physical address and a link to the customer&apos;s email
                preferences, where win-back can be turned off.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[10px] border bg-card p-4 shadow-[0_1px_2px_rgba(23,22,20,0.04)]">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1.5 [font-family:var(--font-archivo)] text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{value.toLocaleString("en")}</p>
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(iso));
}
