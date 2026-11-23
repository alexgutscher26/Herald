import Link from "next/link";
import { ArrowLeft, GitMerge, ShieldCheck, X } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";

import { resolveDuplicateReviewAction } from "./actions";
import type { DuplicateReviewView } from "./duplicate-review";

function formatUtc(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Human duplicate triage.
 *
 * The AI only proposes. A merge runs the ordinary merge transaction, so it
 * appears in merge history and can be undone there. Dismissing changes neither
 * request.
 */
export function DuplicateReviewView({
  workspaceSlug,
  productSlug,
  reviews,
  canWrite,
  saved,
  error,
}: {
  workspaceSlug: string;
  productSlug: string;
  reviews: DuplicateReviewView[];
  canWrite: boolean;
  saved?: string | undefined;
  error?: string | undefined;
}) {
  const base = `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Duplicate triage"
        description="Possible duplicates the AI was not confident enough to merge on its own. Merging keeps the target, moves engagement through the normal merge transaction, and stays undoable from the target's merge history."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`${base}/feedback`}>
              <ArrowLeft aria-hidden="true" />
              Feedback
            </Link>
          </Button>
        }
        meta={
          <>
            <span>{reviews.length} pending reviews</span>
            <span aria-hidden="true">·</span>
            <span>Automatic merges are recorded in merge history</span>
          </>
        }
      />

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {saved ? (
        <p
          role="status"
          className="rounded-md border border-success/30 bg-success-muted px-3 py-2 text-sm text-success"
        >
          {saved === "merge"
            ? "Requests merged. You can undo it from the target's merge history."
            : "Marked as not a duplicate. Neither request changed."}
        </p>
      ) : null}

      {reviews.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No duplicates waiting"
          description="When assisted duplicate linking finds an uncertain match, it appears here for a person to decide. Nothing is merged automatically in assisted mode."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={`${base}/settings#juno`}>Duplicate settings</Link>
            </Button>
          }
        />
      ) : (
        <ol className="space-y-4">
          {reviews.map((review) => (
            <li key={review.id}>
              <article className="space-y-4 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <GitMerge className="size-4" aria-hidden="true" />
                    <span className="rounded-full border bg-muted px-2 py-0.5 font-medium tabular-nums text-foreground">
                      {Math.round(review.score * 100)}% match
                    </span>
                    <span>Queued {formatUtc(review.createdAt)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{review.mode} mode</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`${base}/feedback?post=${review.sourceId}`}>
                        Open source
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`${base}/feedback?post=${review.targetId}`}>
                        Open target
                      </Link>
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-warning/30 bg-warning-muted/30 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      This request would be merged
                    </p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {review.sourceTitle}
                    </p>
                    <p className="mt-1 line-clamp-4 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                      {review.sourceBody}
                    </p>
                  </div>
                  <div className="rounded-md border border-success/30 bg-success-muted/20 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Into this request (kept)
                    </p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {review.targetTitle}
                    </p>
                    <p className="mt-1 line-clamp-4 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                      {review.targetBody}
                    </p>
                  </div>
                </div>

                {canWrite ? (
                  <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                    <form action={resolveDuplicateReviewAction}>
                      <input
                        type="hidden"
                        name="workspaceSlug"
                        value={workspaceSlug}
                      />
                      <input type="hidden" name="productSlug" value={productSlug} />
                      <input type="hidden" name="reviewId" value={review.id} />
                      <input type="hidden" name="decision" value="merge" />
                      <Button type="submit" size="sm">
                        <GitMerge aria-hidden="true" />
                        Merge into target
                      </Button>
                    </form>
                    <form action={resolveDuplicateReviewAction}>
                      <input
                        type="hidden"
                        name="workspaceSlug"
                        value={workspaceSlug}
                      />
                      <input type="hidden" name="productSlug" value={productSlug} />
                      <input type="hidden" name="reviewId" value={review.id} />
                      <input type="hidden" name="decision" value="dismiss" />
                      <Button type="submit" size="sm" variant="ghost">
                        <X aria-hidden="true" />
                        Not a duplicate
                      </Button>
                    </form>
                    <p className="text-xs text-muted-foreground">
                      Merge moves votes, comments and followers, then can be undone from
                      the target request.
                    </p>
                  </div>
                ) : (
                  <p className="border-t pt-3 text-xs text-muted-foreground">
                    Your role can review the match but not merge requests.
                  </p>
                )}
              </article>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
