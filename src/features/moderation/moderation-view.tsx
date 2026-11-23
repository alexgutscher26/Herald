"use client";

import {
  Ban,
  Check,
  ExternalLink,
  EyeOff,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toastActionFailure } from "@/components/shared/action-toast";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  moderateReviewAction,
  retryModerationChecksAction,
  setCustomerBanAction,
} from "@/features/moderation/actions";
import {
  MODERATION_REASON_DETAILS,
  reasonLabel,
} from "@/features/moderation/analyze";
import { formatDate } from "@/features/public/format";
import type {
  ModerationCounts,
  ModerationQueueItem,
  ModerationQueueStatus,
} from "@/features/moderation/types";

/**
 * Moderation queue.
 *
 * Server actions are the authority; this view only chooses which action to
 * request. A decision re-reads the queue from the server rather than mutating
 * local rows, so two moderators cannot leave the screen in disagreement with
 * the database.
 */

const TABS: { id: ModerationQueueStatus; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Hidden" },
  { id: "all", label: "All" },
];

function statusTone(status: ModerationQueueItem["status"]) {
  if (status === "approved") return "success" as const;
  if (status === "rejected") return "danger" as const;
  return "warning" as const;
}

function statusLabel(status: ModerationQueueItem["status"]) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Kept hidden";
  return "Pending";
}

function checksSummary(item: ModerationQueueItem): string[] {
  const lines: string[] = [];
  if (item.checks.text) {
    lines.push(item.checks.text === "flagged" ? "Text: flagged" : "Text: clear");
  }

  const images = item.checks.images;
  if (images) {
    const parts = [`${images.scanned} scanned`];
    if (images.flagged > 0) parts.push(`${images.flagged} flagged`);
    if (images.unavailable > 0) parts.push(`${images.unavailable} unavailable`);
    if (images.errors > 0) parts.push(`${images.errors} failed`);
    lines.push(`Images: ${parts.join(", ")}`);
  }

  if (item.checks.checkedAt) {
    lines.push(`Checked ${formatDate(item.checks.checkedAt)}`);
  }

  return lines;
}

function ModerationRow({
  item,
  workspaceSlug,
  productSlug,
  canManage,
}: {
  item: ModerationQueueItem;
  workspaceSlug: string;
  productSlug: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [deciding, startDecision] = useTransition();
  const [retrying, startRetry] = useTransition();
  const [banning, startBan] = useTransition();
  const [expanded, setExpanded] = useState(false);

  const canDecide = canManage && item.status === "pending";
  const showPublicLink =
    item.publicPath !== null &&
    (item.status === "approved" || (item.status === "pending" && !item.held));
  const canRetry =
    canDecide &&
    (item.reasons.includes("scan_unavailable") ||
      item.reasons.includes("scan_error"));

  function decide(action: "approve" | "keep_hidden" | "delete") {
    startDecision(async () => {
      const result = await moderateReviewAction({
        workspaceSlug,
        productSlug,
        reviewId: item.reviewId,
        action,
      });

      if (!result.ok) {
        toastActionFailure(result);
        return;
      }

      router.refresh();
    });
  }

  function toggleBan(banned: boolean) {
    if (!item.authorCustomerId) return;
    startBan(async () => {
      const result = await setCustomerBanAction({
        workspaceSlug,
        productSlug,
        customerId: item.authorCustomerId as string,
        banned,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      router.refresh();
    });
  }

  function retry() {
    startRetry(async () => {
      const result = await retryModerationChecksAction({
        workspaceSlug,
        productSlug,
        reviewId: item.reviewId,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      router.refresh();
    });
  }

  const busy = deciding || retrying || banning;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge tone={statusTone(item.status)}>
            {statusLabel(item.status)}
          </StatusBadge>
          <span className="rounded-full border bg-muted px-2 py-0.5 font-medium">
            {item.contentType === "feedback_post" ? "Request" : "Comment"}
          </span>
          {item.boardName ? <span>{item.boardName}</span> : null}
          <span aria-hidden="true">·</span>
          <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
          {item.reviewedAt ? (
            <span className="text-muted-foreground">
              Reviewed {formatDate(item.reviewedAt)}
            </span>
          ) : null}
        </div>

        <div>
          <h2 className="text-base font-semibold leading-snug text-foreground">
            {item.title}
          </h2>
          <p
            className={`mt-1 whitespace-pre-line text-sm text-muted-foreground ${
              expanded ? "" : "line-clamp-4"
            }`}
          >
            {item.body}
          </p>
          {item.body.length > 320 ? (
            <button
              type="button"
              className="mt-1 text-xs font-medium text-primary hover:underline"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{item.authorName}</span>
          {item.authorBanned ? (
            <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
              Banned
            </span>
          ) : null}
          {item.authorEmail ? (
            <span className="truncate">{item.authorEmail}</span>
          ) : null}
          {item.publicPath ? (
            <span className="truncate font-mono text-[11px]">
              {item.publicPath}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {item.reasons.length === 0 ? (
            <span className="rounded-full border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              No automated flags
            </span>
          ) : (
            item.reasons.map((reason) => (
              <span
                key={reason}
                title={MODERATION_REASON_DETAILS[reason] ?? undefined}
                className="rounded-full border border-warning/40 bg-warning-muted px-2 py-0.5 text-[11px] font-medium text-warning"
              >
                {reasonLabel(reason)}
              </span>
            ))
          )}
        </div>

        {checksSummary(item).length > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {checksSummary(item).join(" · ")}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {canDecide ? (
            <>
              <Button
                type="button"
                size="sm"
                onClick={() => decide("approve")}
                disabled={busy}
              >
                <Check aria-hidden="true" />
                {item.held
                  ? item.contentType === "feedback_post"
                    ? "Publish"
                    : "Approve"
                  : "Keep visible"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => decide("keep_hidden")}
                disabled={busy}
              >
                <EyeOff aria-hidden="true" />
                Keep hidden
              </Button>
              {canRetry ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={retry}
                  disabled={busy}
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={retrying ? "animate-spin" : undefined}
                  />
                  {retrying ? "Checking…" : "Retry checks"}
                </Button>
              ) : null}
              <ConfirmDialog
                trigger={
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete
                  </Button>
                }
                title={
                  item.contentType === "feedback_post"
                    ? "Delete this request?"
                    : "Delete this comment?"
                }
                description="The content and its attachments are permanently removed, including from the public board. This cannot be undone."
                confirmLabel="Delete permanently"
                onConfirm={() => decide("delete")}
              >
                <p className="text-sm text-muted-foreground">{item.title}</p>
              </ConfirmDialog>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {canManage
                ? "This review has been decided."
                : "Your role can read the queue but cannot decide reviews."}
            </p>
          )}

          {canManage && item.authorCustomerId ? (
            item.authorBanned ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => toggleBan(false)}
                disabled={busy}
              >
                <UserCheck aria-hidden="true" />
                Unban author
              </Button>
            ) : (
              <ConfirmDialog
                trigger={
                  <Button type="button" size="sm" variant="ghost" disabled={busy}>
                    <Ban aria-hidden="true" />
                    Ban author
                  </Button>
                }
                title="Ban this customer?"
                description="They are signed out everywhere and their existing requests and comments are hidden from public pages. You can unban them from this queue later."
                confirmLabel="Ban customer"
                onConfirm={() => toggleBan(true)}
              >
                <p className="text-sm text-muted-foreground">{item.authorName}</p>
              </ConfirmDialog>
            )
          ) : null}

          {showPublicLink && item.publicPath ? (
            <Button asChild size="sm" variant="link" className="ml-auto">
              <Link href={item.publicPath} target="_blank" rel="noreferrer">
                Open
                <ExternalLink aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function ModerationView({
  workspaceSlug,
  productSlug,
  status,
  counts,
  items,
  canManage,
}: {
  workspaceSlug: string;
  productSlug: string;
  status: ModerationQueueStatus;
  counts: ModerationCounts;
  items: ModerationQueueItem[];
  canManage: boolean;
}) {
  const base = `/app/${workspaceSlug}/${productSlug}/moderation`;
  const countFor = (id: ModerationQueueStatus) =>
    id === "all"
      ? counts.pending + counts.approved + counts.rejected
      : id === "rejected"
        ? counts.rejected
        : counts[id];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Moderation"
        description="Review submissions and comments before or after they appear publicly. Automated checks are advisory; every decision is recorded."
        meta={
          <>
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            <span>{counts.pending} awaiting review</span>
          </>
        }
      />

      <nav aria-label="Moderation status" className="flex flex-wrap gap-1.5">
        {TABS.map((tab) => {
          const active = status === tab.id;
          return (
            <Link
              key={tab.id}
              href={tab.id === "pending" ? base : `${base}?status=${tab.id}`}
              aria-current={active ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                active
                  ? "border-foreground/30 bg-foreground text-background"
                  : "bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              <span
                className={`tabular-nums ${
                  active ? "text-background/80" : "text-muted-foreground"
                }`}
              >
                {countFor(tab.id)}
              </span>
            </Link>
          );
        })}
      </nav>

      {items.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={
            status === "pending"
              ? "Nothing is waiting for review"
              : "No reviews in this view"
          }
          description={
            status === "pending"
              ? "New submissions, moderated comments and anything the automated checks flag will appear here."
              : "Approved and hidden reviews are kept as a record of who decided what."
          }
        />
      ) : (
        <ol className="space-y-3" aria-label="Reviews">
          {items.map((item) => (
            <li key={item.reviewId}>
              <ModerationRow
                item={item}
                workspaceSlug={workspaceSlug}
                productSlug={productSlug}
                canManage={canManage}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
