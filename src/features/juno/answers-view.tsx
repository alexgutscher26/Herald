import Link from "next/link";
import { ArrowLeft, ClipboardCheck, ThumbsDown, ThumbsUp } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { addJunoAnswerEvalAction, rateJunoAnswerAction } from "./actions";
import type {
  AnswerInspectionFilter,
  JunoAnswerInspectionRow,
} from "./inspection";

const STATUS_TONES: Record<JunoAnswerInspectionRow["status"], StatusTone> = {
  answered: "success",
  handoff: "warning",
  skipped: "neutral",
  failed: "danger",
};

const STATUS_LABELS: Record<JunoAnswerInspectionRow["status"], string> = {
  answered: "Answered",
  handoff: "Handed off",
  skipped: "Skipped",
  failed: "Failed",
};

function formatUtc(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

function confidence(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function filterHref(
  workspaceSlug: string,
  productSlug: string,
  filter: Partial<AnswerInspectionFilter>,
): string {
  const params = new URLSearchParams();
  if (filter.lowConfidenceOnly) params.set("low", "1");
  if (filter.status) params.set("status", filter.status);
  const query = params.toString();
  return `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/conversations/answers${query ? `?${query}` : ""}`;
}

/**
 * Answer inspection.
 *
 * This is a read surface over immutable answer rows: the trace, model, prompt
 * version and cost are what the customer actually received, not a replay
 * against today's knowledge. Thumbs are team judgement; adding a case copies
 * the already-redacted question into the evaluation set.
 */
export function JunoAnswersView({
  workspaceSlug,
  productSlug,
  rows,
  filter,
  confidenceFloor,
  lowConfidenceThreshold,
  lowConfidenceCount,
  canManage,
  saved,
  error,
}: {
  workspaceSlug: string;
  productSlug: string;
  rows: JunoAnswerInspectionRow[];
  filter: AnswerInspectionFilter;
  confidenceFloor: number;
  lowConfidenceThreshold: number;
  lowConfidenceCount: number;
  canManage: boolean;
  saved?: string | undefined;
  error?: string | undefined;
}) {
  const inbox = `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/conversations`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Answer inspection"
        description="Every AI answer with the passages it retrieved, the scores behind its confidence, the model and prompt version, cost, and what happened next. Only your team can see this page."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={inbox}>
              <ArrowLeft aria-hidden="true" />
              Conversations
            </Link>
          </Button>
        }
        meta={
          <>
            <span>{rows.length} answers shown</span>
            <span aria-hidden="true">·</span>
            <span>{lowConfidenceCount} need a closer look</span>
            <span aria-hidden="true">·</span>
            <span>
              Low-confidence band: below {Math.round(lowConfidenceThreshold * 100)}%
              (floor {Math.round(confidenceFloor * 100)}%)
            </span>
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
          {saved === "eval"
            ? "Added to the evaluation set."
            : "Feedback saved on that answer."}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
        <Button
          asChild
          size="sm"
          variant={!filter.lowConfidenceOnly && !filter.status ? "secondary" : "ghost"}
        >
          <Link href={filterHref(workspaceSlug, productSlug, {})}>All answers</Link>
        </Button>
        <Button
          asChild
          size="sm"
          variant={filter.lowConfidenceOnly ? "secondary" : "ghost"}
        >
          <Link
            href={filterHref(workspaceSlug, productSlug, {
              lowConfidenceOnly: true,
              status: filter.status,
            })}
          >
            Low confidence
          </Link>
        </Button>
        {(["answered", "handoff", "skipped", "failed"] as const).map((status) => (
          <Button
            key={status}
            asChild
            size="sm"
            variant={filter.status === status ? "secondary" : "ghost"}
          >
            <Link href={filterHref(workspaceSlug, productSlug, { status })}>
              {STATUS_LABELS[status]}
            </Link>
          </Button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No answers match"
          description="Try clearing the low-confidence filter or choosing another outcome. Answers appear here as soon as Mira handles a conversation."
        />
      ) : (
        <ol className="space-y-3">
          {rows.map((row) => {
            const conversationHref = `${inbox}/${encodeURIComponent(row.conversationId)}`;
            const sources = row.retrievedSources ?? [];

            return (
              <li key={row.id}>
                <article className="overflow-hidden rounded-lg border bg-card">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/20 px-4 py-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={STATUS_TONES[row.status]}>
                          {STATUS_LABELS[row.status]}
                        </StatusBadge>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          Confidence {confidence(row.confidence)}
                        </span>
                        {row.handoffReason ? (
                          <span className="text-xs text-muted-foreground">
                            Reason: {row.handoffReason.replaceAll("_", " ")}
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-sm font-medium text-foreground">
                        <Link href={conversationHref} className="hover:underline">
                          {row.conversationSubject}
                        </Link>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.customerName ?? row.customerEmail ?? "Unknown customer"} ·{" "}
                        {formatUtc(row.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={rateJunoAnswerAction}>
                        <input
                          type="hidden"
                          name="workspaceSlug"
                          value={workspaceSlug}
                        />
                        <input type="hidden" name="productSlug" value={productSlug} />
                        <input type="hidden" name="answerId" value={row.id} />
                        <input type="hidden" name="rating" value="up" />
                        <Button
                          type="submit"
                          size="sm"
                          variant={row.feedbackRating === "up" ? "secondary" : "outline"}
                          aria-label="Mark this answer helpful"
                        >
                          <ThumbsUp aria-hidden="true" />
                          Helpful
                        </Button>
                      </form>
                      <form action={rateJunoAnswerAction}>
                        <input
                          type="hidden"
                          name="workspaceSlug"
                          value={workspaceSlug}
                        />
                        <input type="hidden" name="productSlug" value={productSlug} />
                        <input type="hidden" name="answerId" value={row.id} />
                        <input type="hidden" name="rating" value="down" />
                        <Button
                          type="submit"
                          size="sm"
                          variant={row.feedbackRating === "down" ? "secondary" : "outline"}
                          aria-label="Mark this answer unhelpful"
                        >
                          <ThumbsDown aria-hidden="true" />
                          Not helpful
                        </Button>
                      </form>
                    </div>
                  </div>

                  <div className="space-y-4 p-4">
                    <div>
                      <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Customer question
                      </h3>
                      <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">
                        {row.question}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Answer
                      </h3>
                      <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                        {row.answer ??
                          (row.handoffReason
                            ? `No answer was sent; the conversation was handed off (${row.handoffReason.replaceAll("_", " ")}).`
                            : "No answer was sent.")}
                      </p>
                    </div>

                    <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground sm:grid-cols-4">
                      <p>
                        <span className="block font-medium text-foreground">Model</span>
                        {row.model ?? "—"}
                      </p>
                      <p>
                        <span className="block font-medium text-foreground">
                          Prompt version
                        </span>
                        {row.promptVersion ?? "—"}
                      </p>
                      <p>
                        <span className="block font-medium text-foreground">Cost</span>
                        {row.costCents}¢
                      </p>
                      <p>
                        <span className="block font-medium text-foreground">
                          Team signal
                        </span>
                        {row.feedbackRating
                          ? `${row.feedbackRating === "up" ? "Helpful" : "Not helpful"}${
                              row.feedbackByName ? ` by ${row.feedbackByName}` : ""
                            }`
                          : "Not rated"}
                      </p>
                    </div>

                    <details className="rounded-md border bg-muted/20 px-3 py-2">
                      <summary className="cursor-pointer text-xs font-medium text-foreground">
                        Retrieved passages and scores ({sources.length})
                      </summary>
                      {sources.length === 0 ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          This answer has no stored retrieval trace. It predates
                          inspection or was produced without a knowledge hit.
                        </p>
                      ) : (
                        <ol className="mt-2 space-y-2">
                          {sources.map((source, index) => (
                            <li
                              key={`${source.sourceId}-${index}`}
                              className="rounded border bg-card p-2 text-xs"
                            >
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <p className="font-medium text-foreground">
                                  {index + 1}. {source.title}
                                </p>
                                <span className="tabular-nums text-muted-foreground">
                                  score {source.score.toFixed(3)}
                                </span>
                              </div>
                              <p className="mt-0.5 text-muted-foreground">
                                {source.sourceName}
                                {source.url ? ` · ${source.url}` : ""}
                              </p>
                              <p className="mt-1 line-clamp-4 whitespace-pre-line text-muted-foreground">
                                {source.excerpt}
                              </p>
                            </li>
                          ))}
                        </ol>
                      )}
                    </details>

                    {canManage ? (
                      <details className="rounded-md border border-dashed px-3 py-2">
                        <summary className="cursor-pointer text-xs font-medium text-foreground">
                          Add this question to the evaluation set
                        </summary>
                        <form action={addJunoAnswerEvalAction} className="mt-3 space-y-3">
                          <input
                            type="hidden"
                            name="workspaceSlug"
                            value={workspaceSlug}
                          />
                          <input type="hidden" name="productSlug" value={productSlug} />
                          <input type="hidden" name="answerId" value={row.id} />
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            The exact redacted question is used. Add phrases a correct
                            answer must contain, separated by commas.
                          </p>
                          <div className="grid gap-1.5">
                            <Label htmlFor={`expected-${row.id}`}>
                              Expected phrases (optional)
                            </Label>
                            <Input
                              id={`expected-${row.id}`}
                              name="expectedKeywords"
                              placeholder="invite, team settings"
                              maxLength={500}
                            />
                          </div>
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              name="expectHandoff"
                              defaultChecked={row.status === "handoff"}
                            />
                            A correct result is a handoff, not an answer
                          </label>
                          <Button type="submit" size="sm" variant="outline">
                            Add to evaluation
                          </Button>
                        </form>
                      </details>
                    ) : null}
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
