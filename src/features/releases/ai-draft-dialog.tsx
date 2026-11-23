"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

import type { AiDraftCandidate, AiDraftRewriteOutput } from "./action-types";
import {
  createAiDraftAction,
  listAiDraftCandidatesAction,
  rewriteAiDraftAction,
} from "./ai-draft-actions";

const MAX_SELECTED = 12;

/**
 * AI draft picker.
 *
 * The server decides which shipped requests are eligible and the generated
 * entry is always created as a draft. The dialog never offers a publish action;
 * the user reviews the editable draft in the normal release editor.
 */

export function AiDraftDialog({
  open,
  onOpenChange,
  workspaceSlug,
  productSlug,
  mode = "create",
  releaseId,
  onRewritten,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  productSlug: string;
  mode?: "create" | "rewrite";
  /** Required in rewrite mode. */
  releaseId?: string;
  onRewritten?: (draft: AiDraftRewriteOutput) => void;
}) {
  const router = useRouter();
  const rewrite = mode === "rewrite";
  const [candidates, setCandidates] = useState<AiDraftCandidate[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [focus, setFocus] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loading = !rewrite && candidates === null;

  function handleOpenChange(next: boolean) {
    if (!next) {
      setCandidates(null);
      setSelected([]);
      setFocus("");
      setError(null);
    }
    onOpenChange(next);
  }

  useEffect(() => {
    if (!open || rewrite || candidates !== null) return;

    let cancelled = false;
    void listAiDraftCandidatesAction({ workspaceSlug, productSlug })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error);
          setCandidates([]);
          return;
        }
        setCandidates(result.data);
        setSelected(result.data.slice(0, 8).map((candidate) => candidate.id));
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load completed requests.");
        setCandidates([]);
      });

    return () => {
      cancelled = true;
    };
  }, [open, rewrite, candidates, workspaceSlug, productSlug]);

  function toggleCandidate(id: string, checked: boolean) {
    setSelected((current) => {
      if (!checked) return current.filter((value) => value !== id);
      if (current.includes(id) || current.length >= MAX_SELECTED) return current;
      return [...current, id];
    });
  }

  async function handleGenerate() {
    if (generating) return;
    if (rewrite && !releaseId) {
      setError("This draft is no longer available. Reload the editor and try again.");
      return;
    }
    if (!rewrite && selected.length === 0) return;

    setGenerating(true);
    setError(null);
    try {
      if (rewrite) {
        const result = await rewriteAiDraftAction({
          workspaceSlug,
          productSlug,
          releaseId: releaseId ?? "",
          focus,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }

        handleOpenChange(false);
        toast.success("Draft rewritten", {
          description: "Review the new copy before publishing.",
        });
        onRewritten?.(result.data);
        router.refresh();
        return;
      }

      const result = await createAiDraftAction({
        workspaceSlug,
        productSlug,
        feedbackIds: selected,
        focus,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      handleOpenChange(false);
      toast.success("AI draft created", {
        description: "Review the body and linked requests before publishing.",
      });
      router.push(
        `/app/${workspaceSlug}/${productSlug}/releases/${result.data.releaseId}/edit`,
      );
      router.refresh();
    } catch {
      setError(
        rewrite
          ? "Could not rewrite the draft. Please try again."
          : "Could not generate a draft. Please try again.",
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !generating && handleOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            {rewrite ? "Rewrite this draft with AI" : "Draft a changelog with AI"}
          </DialogTitle>
          <DialogDescription>
            {rewrite
              ? "The AI rewrites this draft in place from its current copy and eligible linked requests. Nothing is published, scheduled or emailed."
              : "Choose shipped requests and the AI writes an editable draft. Nothing is published, scheduled or emailed."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading completed requests…
            </p>
          ) : null}

          {!loading && error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          {!rewrite && !loading && !error && (candidates ?? []).length === 0 ? (
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              No shipped requests yet. Move a request to Shipped first, then come back.
            </p>
          ) : null}

          {!rewrite && !loading && (candidates ?? []).length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Completed requests ({selected.length} of {MAX_SELECTED} selected)
              </p>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                {(candidates ?? []).map((candidate) => {
                  const id = `ai-draft-${candidate.id}`;
                  return (
                    <label
                      key={candidate.id}
                      htmlFor={id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-sm px-1.5 py-1.5 hover:bg-muted/50"
                    >
                      <Checkbox
                        id={id}
                        checked={selected.includes(candidate.id)}
                        onCheckedChange={(checked) =>
                          toggleCandidate(candidate.id, checked === true)
                        }
                        className="mt-0.5"
                        disabled={
                          generating ||
                          (!selected.includes(candidate.id) && selected.length >= MAX_SELECTED)
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{candidate.title}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {candidate.voteCount} {candidate.voteCount === 1 ? "vote" : "votes"}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!loading && (rewrite || (candidates ?? []).length > 0) ? (
            <div className="space-y-1.5">
              <label htmlFor="ai-draft-focus" className="text-xs font-medium">
                Anything to emphasise? <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                id="ai-draft-focus"
                value={focus}
                onChange={(event) => setFocus(event.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Keep it short and benefit-led…"
                disabled={generating}
              />
            </div>
          ) : null}

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {rewrite
              ? "The rewrite is saved to this draft. The slug, authors, channels, cover and linked requests are preserved, and a person must review the copy before publishing."
              : "The draft is saved privately with links to the selected requests. A person must review and publish it."}
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={generating}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading || generating || (!rewrite && selected.length === 0)}
          >
            {generating ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles aria-hidden="true" />
            )}
            {generating
              ? rewrite
                ? "Rewriting…"
                : "Drafting…"
              : rewrite
                ? "Rewrite draft"
                : "Generate draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
