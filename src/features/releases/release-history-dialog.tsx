"use client";

import { History, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ReleaseStatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import type {
  CancellationReason,
  FeedbackPost,
  TeamMember,
} from "@/types";

import {
  listReleaseRevisionsAction,
  restoreReleaseRevisionAction,
} from "./revision-actions";
import {
  findPublicationRevision,
  type ReleaseRevisionAction,
  type ReleaseRevisionSnapshot,
  type ReleaseRevisionView,
} from "./revision-types";
import { diffReleaseSnapshots, type ReleaseFieldChange } from "./release-diff";

const ACTION_LABELS: Record<ReleaseRevisionAction, string> = {
  autosave: "Autosaved",
  save: "Saved",
  publish: "Published",
  update: "Published update",
  schedule: "Scheduled",
  archive: "Archived",
  restore: "Restored",
};

function BodyDiff({ change }: { change: ReleaseFieldChange }) {
  if (!change.body) return null;

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>{change.before}</span>
        <span aria-hidden="true">→</span>
        <span>{change.after}</span>
      </div>
      <ul className="max-h-72 overflow-auto rounded-md border bg-muted/30 py-1 font-mono text-[11px] leading-relaxed">
        {change.body.lines.map((line, index) => (
          <li
            key={`${index}-${line.type}`}
            className={
              line.type === "added"
                ? "bg-success-muted/40 px-2 text-success"
                : line.type === "removed"
                  ? "bg-destructive/5 px-2 text-destructive"
                  : "px-2 text-muted-foreground"
            }
          >
            <span aria-hidden="true">
              {line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  "}
            </span>
            {line.words && line.words.length > 0
              ? line.words.map((word, wordIndex) => (
                  <span
                    key={`${wordIndex}-${word.type}`}
                    className={
                      word.type === "added"
                        ? "rounded-sm bg-success/25 px-0.5"
                        : word.type === "removed"
                          ? "rounded-sm bg-destructive/20 px-0.5 line-through decoration-destructive/50"
                          : undefined
                    }
                  >
                    {word.text}
                  </span>
                ))
              : line.text || " "}
          </li>
        ))}
      </ul>
      {change.body.truncated ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          The diff is long; only the first lines are shown.
        </p>
      ) : null}
    </div>
  );
}

function FieldChange({ change }: { change: ReleaseFieldChange }) {
  return (
    <li className="rounded-md border p-3">
      <p className="text-xs font-medium">{change.label}</p>
      {change.body ? (
        <div className="mt-2">
          <BodyDiff change={change} />
        </div>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="rounded-md bg-muted/40 p-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Before</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-xs">{change.before}</p>
          </div>
          <div className="rounded-md bg-muted/40 p-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">After</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-xs">{change.after}</p>
          </div>
        </div>
      )}
    </li>
  );
}

export function ReleaseHistoryDialog({
  open,
  onOpenChange,
  workspaceSlug,
  productSlug,
  releaseId,
  workingSnapshot,
  timeZone,
  teamMembers,
  feedbackPosts,
  cancellationReasons,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  productSlug: string;
  releaseId: string;
  workingSnapshot: ReleaseRevisionSnapshot;
  timeZone: string;
  teamMembers: TeamMember[];
  feedbackPosts: FeedbackPost[];
  cancellationReasons: CancellationReason[];
  onRestored: (snapshot: ReleaseRevisionSnapshot) => void;
}) {
  const [request, setRequest] = useState<{
    key: string;
    revisions: ReleaseRevisionView[];
    error: string | null;
  } | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const requestKey = `${workspaceSlug}|${productSlug}|${releaseId}|${retryNonce}`;

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    void listReleaseRevisionsAction({ workspaceSlug, productSlug, releaseId })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setRequest({ key: requestKey, revisions: [], error: result.error });
          return;
        }
        setRequest({ key: requestKey, revisions: result.data, error: null });
        setCompareId((findPublicationRevision(result.data) ?? result.data[0])?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setRequest({
            key: requestKey,
            revisions: [],
            error: "Could not load the revision history.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, workspaceSlug, productSlug, releaseId, requestKey]);

  const settled = open && request?.key === requestKey ? request : null;
  const revisions = settled?.revisions ?? [];
  const error = settled?.error ?? null;
  const loading = open && request?.key !== requestKey;

  const selected = revisions.find((revision) => revision.id === compareId) ?? null;

  const changes = useMemo(() => {
    if (!selected) return [];
    return diffReleaseSnapshots(selected, workingSnapshot, {
      timeZone,
      authorName: (id) => teamMembers.find((member) => member.id === id)?.name,
      feedbackTitle: (id) => feedbackPosts.find((post) => post.id === id)?.title,
      cancellationReason: (id) =>
        cancellationReasons.find((reason) => reason.id === id)?.label,
    });
  }, [
    selected,
    workingSnapshot,
    timeZone,
    teamMembers,
    feedbackPosts,
    cancellationReasons,
  ]);

  async function handleRestore() {
    if (!selected || restoringId) return;
    setRestoringId(selected.id);
    setRestoreError(null);
    try {
      const result = await restoreReleaseRevisionAction({
        workspaceSlug,
        productSlug,
        releaseId,
        revisionId: selected.id,
      });
      if (!result.ok) {
        setRestoreError(result.error);
        return;
      }
      onRestored(result.data);
      setRetryNonce((value) => value + 1);
    } catch {
      setRestoreError("Could not restore that revision.");
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" aria-hidden="true" />
            Revision history
          </DialogTitle>
          <DialogDescription>
            Each save, schedule and publication is recorded from the database. Compare a saved
            revision with the working copy before you publish.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading revisions…
          </p>
        ) : error ? (
          <div className="space-y-3 py-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRetryNonce((value) => value + 1)}
            >
              Try again
            </Button>
          </div>
        ) : revisions.length === 0 ? (
          <div className="rounded-md border bg-muted/40 p-4">
            <p className="text-sm font-medium">No revisions recorded yet</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              The first save, schedule or publication creates a revision. Autosave also records
              the state after a change.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Compare from
              </p>
              <ul className="max-h-96 space-y-1 overflow-y-auto pr-1">
                {revisions.map((revision) => {
                  const active = revision.id === compareId;
                  return (
                    <li key={revision.id}>
                      <label
                        className={
                          active
                            ? "block cursor-pointer rounded-md border-2 border-primary bg-primary/5 p-2.5"
                            : "block cursor-pointer rounded-md border p-2.5 hover:bg-muted/50"
                        }
                      >
                        <span className="flex items-start gap-2">
                          <input
                            type="radio"
                            name="revision-compare"
                            className="mt-1 size-3.5 accent-[var(--primary)]"
                            checked={active}
                            onChange={() => setCompareId(revision.id)}
                          />
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-medium">
                                {ACTION_LABELS[revision.action]}
                              </span>
                              <ReleaseStatusBadge status={revision.status} />
                            </span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {formatDateTime(revision.createdAt, timeZone)}
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {revision.createdByName ?? "System"}
                            </span>
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                The working copy is the form as it is now, including unsaved edits.
              </p>
            </div>

            <div className="min-w-0">
              {selected ? (
                <>
                  <div className="mb-3 rounded-md border bg-muted/30 p-3">
                    <p className="text-sm font-medium">
                      {changes.length === 0
                        ? "No changes from this revision"
                        : `${changes.length} field${changes.length === 1 ? "" : "s"} changed`}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Working copy vs {ACTION_LABELS[selected.action].toLowerCase()} ·{" "}
                      {formatDateTime(selected.createdAt, timeZone)}
                    </p>
                  </div>

                  {changes.length === 0 ? (
                    <p className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
                      The form matches this revision exactly. Nothing would change if you saved
                      now.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {changes.map((change) => (
                        <FieldChange key={change.field} change={change} />
                      ))}
                    </ul>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleRestore()}
                      disabled={restoringId !== null}
                    >
                      {restoringId === selected.id ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <RotateCcw aria-hidden="true" />
                      )}
                      Restore this revision
                    </Button>
                    <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
                      Restores content, tags, authors and links. The current status, schedule and
                      publication date stay as they are; a custom cover keeps its current image.
                    </p>
                  </div>
                  {restoreError ? (
                    <p className="mt-2 text-xs text-destructive" role="alert">
                      {restoreError}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
