"use client";

import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Globe2,
  Mail,
  Puzzle,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { NotConnectedBadge, StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime, formatNumber } from "@/lib/format";
import type {
  CancellationReason,
  FeedbackPost,
  Product,
  ReleaseChannels,
  ReleaseCover,
  TeamMember,
  Workspace,
} from "@/types";

import { releaseChecklist } from "./checklist";

import { previewReleaseWinbackAction } from "./audience-actions";
import { AudiencePreviewContent } from "./audience-preview-content";
import { useAudiencePreview } from "./audience-preview-dialog";
import type { ReleaseWinbackPreview } from "./audience-types";
import { diffReleaseSnapshots } from "./release-diff";
import { listReleaseRevisionsAction } from "./revision-actions";
import {
  findPublicationRevision,
  type ReleaseRevisionSnapshot,
  type ReleaseRevisionView,
} from "./revision-types";

type PublishReviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  summary: string;
  cover: ReleaseCover;
  channels: ReleaseChannels;
  scheduledFor: string | null;
  workspace: Workspace;
  product: Product;
  activeSubscriberCount: number;
  mode: "publish" | "schedule" | "update";
  onConfirm: () => void;
  workspaceSlug: string;
  productSlug: string;
  releaseId: string;
  /** Current form values, used for the diff against the published revision. */
  currentSnapshot: ReleaseRevisionSnapshot;
  linkedFeedbackIds: string[];
  tagSlugs: string[];
  teamMembers: TeamMember[];
  feedbackPosts: FeedbackPost[];
  cancellationReasons: CancellationReason[];
};

const MODE_COPY = {
  publish: {
    heading: "Publish this release?",
    confirm: "Publish release",
  },
  schedule: {
    heading: "Schedule this release?",
    confirm: "Schedule release",
  },
  update: {
    heading: "Update the published release?",
    confirm: "Save published changes",
  },
};

export function PublishReviewDialog({
  open,
  onOpenChange,
  title,
  summary,
  cover,
  channels,
  scheduledFor,
  workspace,
  product,
  activeSubscriberCount,
  mode,
  onConfirm,
  workspaceSlug,
  productSlug,
  releaseId,
  currentSnapshot,
  linkedFeedbackIds,
  tagSlugs,
  teamMembers,
  feedbackPosts,
  cancellationReasons,
}: PublishReviewDialogProps) {
  const copy = MODE_COPY[mode];
  const checklist = releaseChecklist({
    title,
    summary,
    linkedFeedbackCount: linkedFeedbackIds.length,
    cover,
  });
  const warnings = checklist.filter((item) => !item.passed);
  const audience = useAudiencePreview({
    enabled: open,
    workspaceSlug,
    productSlug,
    linkedFeedbackIds,
    tagSlugs,
    emailEnabled: channels.subscriberEmail,
  });
  const scheduledRecipients = audience.preview?.eligible ?? activeSubscriberCount;

  const [revisionRequest, setRevisionRequest] = useState<{
    key: string;
    revision: ReleaseRevisionView | null;
    error: string | null;
  } | null>(null);
  const revisionKey = `${workspaceSlug}|${productSlug}|${releaseId}`;

  const [winbackRequest, setWinbackRequest] = useState<{
    key: string;
    preview: ReleaseWinbackPreview | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void previewReleaseWinbackAction({ workspaceSlug, productSlug, releaseId })
      .then((result) => {
        if (cancelled) return;
        setWinbackRequest({
          key: revisionKey,
          preview: result.ok ? result.data : null,
          error: result.ok ? null : result.error,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWinbackRequest({
            key: revisionKey,
            preview: null,
            error: "Could not check the win-back match.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceSlug, productSlug, releaseId, revisionKey]);

  const winbackSettled =
    open && winbackRequest?.key === revisionKey ? winbackRequest : null;
  const winbackPreview = winbackSettled?.preview ?? null;
  const winbackError = winbackSettled?.error ?? null;

  useEffect(() => {
    if (!open || mode !== "update") return;

    let cancelled = false;
    void listReleaseRevisionsAction({ workspaceSlug, productSlug, releaseId })
      .then((result) => {
        if (cancelled) return;
        setRevisionRequest({
          key: revisionKey,
          revision: result.ok ? findPublicationRevision(result.data) : null,
          error: result.ok ? null : result.error,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setRevisionRequest({
            key: revisionKey,
            revision: null,
            error: "Could not load the published revision.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, mode, workspaceSlug, productSlug, releaseId, revisionKey]);

  const revisionSettled =
    open && mode === "update" && revisionRequest?.key === revisionKey
      ? revisionRequest
      : null;
  const publishedRevision = revisionSettled?.revision ?? null;
  const revisionError = revisionSettled?.error ?? null;
  const revisionLoading =
    open && mode === "update" && revisionRequest?.key !== revisionKey;

  const changes = useMemo(() => {
    if (!publishedRevision) return [];
    return diffReleaseSnapshots(publishedRevision, currentSnapshot, {
      timeZone: workspace.timezone,
      authorName: (id) => teamMembers.find((member) => member.id === id)?.name,
      feedbackTitle: (id) => feedbackPosts.find((post) => post.id === id)?.title,
      cancellationReason: (id) =>
        cancellationReasons.find((reason) => reason.id === id)?.label,
    });
  }, [
    publishedRevision,
    currentSnapshot,
    workspace.timezone,
    teamMembers,
    feedbackPosts,
    cancellationReasons,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.heading}</DialogTitle>
          <DialogDescription>
            Review the distribution below. Nothing is sent until you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border p-3">
            <p className="text-sm font-medium">{title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {mode === "schedule" && scheduledFor
                ? `Scheduled for ${formatDateTime(scheduledFor, workspace.timezone)}`
                : mode === "update"
                  ? "The existing publication date is preserved."
                  : "Publishes immediately and records the current time."}
            </p>
          </div>

          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Readiness check
              </p>
              <span
                className={
                  warnings.length === 0
                    ? "text-[11px] font-medium text-success"
                    : "text-[11px] font-medium text-warning"
                }
              >
                {warnings.length === 0
                  ? "Ready"
                  : `${warnings.length} soft warning${warnings.length === 1 ? "" : "s"}`}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              These are suggestions. They never block publishing.
            </p>
            <ul className="mt-2 space-y-1.5">
              {checklist.map((item) => (
                <li key={item.id} className="flex items-start gap-2 text-xs">
                  {item.passed ? (
                    <CheckCircle2
                      className="mt-0.5 size-3.5 shrink-0 text-success"
                      aria-hidden="true"
                    />
                  ) : (
                    <AlertTriangle
                      className="mt-0.5 size-3.5 shrink-0 text-warning"
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="font-medium">{item.label}</span>
                    <span className="block text-[11px] leading-relaxed text-muted-foreground">
                      {item.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Distribution channels
            </p>
            <ul className="space-y-2">
              <li className="flex items-start gap-2.5 rounded-md border p-2.5">
                <Globe2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Public changelog</p>
                  <p className="text-xs text-muted-foreground">
                    {channels.publicChangelog
                      ? `Visible on the ${product.name} changelog.`
                      : "Not included in this release."}
                  </p>
                </div>
                <StatusBadge tone={channels.publicChangelog ? "info" : "neutral"}>
                  {channels.publicChangelog ? "Included" : "Off"}
                </StatusBadge>
              </li>
              <li className="flex items-start gap-2.5 rounded-md border p-2.5">
                <Puzzle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">In-app widget</p>
                  <p className="text-xs text-muted-foreground">
                    {channels.inAppWidget
                      ? "Appears in the What's New release list."
                      : "Not shown in the widget."}
                  </p>
                </div>
                <StatusBadge tone={channels.inAppWidget ? "info" : "neutral"}>
                  {channels.inAppWidget ? "Included" : "Off"}
                </StatusBadge>
              </li>
              <li className="flex items-start gap-2.5 rounded-md border p-2.5">
                <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    Subscriber email
                    {channels.subscriberEmail ? (
                      <NotConnectedBadge label="Pending · no provider" />
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {!channels.subscriberEmail
                      ? "No email will be queued."
                      : audience.preview
                        ? `${formatNumber(audience.preview.eligible)} would receive the email; ${formatNumber(audience.preview.suppressed)} active subscribers are suppressed. No email provider is connected, so pending delivery rows are recorded and nothing is sent.`
                        : `${formatNumber(activeSubscriberCount)} active subscribers. Checking the suppression list…`}
                  </p>
                </div>
                <StatusBadge tone={channels.subscriberEmail ? "warning" : "neutral"}>
                  {channels.subscriberEmail ? "Queued" : "Off"}
                </StatusBadge>
              </li>
            </ul>
          </div>

          {mode === "schedule" && scheduledFor ? (
            <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info-muted p-3 text-xs leading-relaxed text-info">
              <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">
                  {channels.subscriberEmail
                    ? `This will go out to ${formatNumber(scheduledRecipients)} ${scheduledRecipients === 1 ? "subscriber" : "subscribers"} at ${formatDateTime(scheduledFor, workspace.timezone)}.`
                    : `This will publish at ${formatDateTime(scheduledFor, workspace.timezone)} without emailing subscribers.`}
                </p>
                {channels.subscriberEmail ? (
                  <p className="mt-0.5 text-info/80">
                    {audience.preview
                      ? `${formatNumber(audience.preview.suppressed)} active subscribers are suppressed and excluded from this count.`
                      : "Checking the suppression list; the final count may be lower."}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {channels.subscriberEmail ? (
            <div className="rounded-md border p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pre-send audience
              </p>
              <AudiencePreviewContent
                preview={audience.preview}
                loading={audience.loading}
                error={audience.error}
                compact
              />
            </div>
          ) : null}

          {mode === "update" ? (
            <div className="rounded-md border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Changes since publication
              </p>
              {revisionLoading ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Comparing with the last published revision…
                </p>
              ) : revisionError ? (
                <p className="mt-1 text-xs text-destructive">{revisionError}</p>
              ) : !publishedRevision ? (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  No published revision is recorded for this entry yet. Saving this update starts
                  the comparison history.
                </p>
              ) : changes.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  No content changes since it was published. Subscribers are not re-emailed for an
                  update.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {changes.length} field{changes.length === 1 ? "" : "s"} will change on the
                    published entry. Subscribers are not re-emailed for an update.
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {changes.map((change) => (
                      <li
                        key={change.field}
                        className="rounded-full border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {change.label}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : null}

          <div className="rounded-md border p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Win-back eligibility
            </p>
            {!winbackSettled ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Checking the cancellation reasons linked to this release…
              </p>
            ) : winbackError ? (
              <p className="mt-1 text-xs text-destructive">{winbackError}</p>
            ) : winbackPreview && winbackPreview.reasons > 0 ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                This release matches {formatNumber(winbackPreview.reasons)} cancellation
                reason{winbackPreview.reasons === 1 ? "" : "s"} — {
                  formatNumber(winbackPreview.matched)
                }{" "}
                cancelled customer{winbackPreview.matched === 1 ? "" : "s"}, of whom {
                  formatNumber(winbackPreview.eligible)
                }{" "}
                {winbackPreview.eligible === 1 ? "is" : "are"} contactable right now. Sending
                a campaign remains a separate review step.
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                No cancellation reasons are linked to this release, so it matches no win-back
                audience.
              </p>
            )}
          </div>

          <div className="flex gap-2 rounded-md border border-warning/40 bg-warning-muted p-3 text-xs leading-relaxed text-warning">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              Publishing <span className="font-semibold">never</span> approves or sends a win-back
              campaign. Those remain separate review and send steps in Win-back.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>{copy.confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
