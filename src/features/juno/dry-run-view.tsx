"use client";

import { useState, useTransition, type FormEvent } from "react";
import { FlaskConical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/shared/status-badge";

import { dryRunJunoRetrievalAction } from "./actions";
import type { JunoDryRunResult } from "./dry-run";

/**
 * Team-only retrieval preview.
 *
 * It uses the production retrieval path but never generates an answer and never
 * writes usage. The result is deliberately read-only: no conversation, message
 * or audit row is created.
 */
export function JunoDryRunPanel({
  workspaceSlug,
  productSlug,
}: {
  workspaceSlug: string;
  productSlug: string;
}) {
  const [query, setQuery] = useState("");
  const [includeInternal, setIncludeInternal] = useState(false);
  const [result, setResult] = useState<JunoDryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const response = await dryRunJunoRetrievalAction({
        workspaceSlug,
        productSlug,
        query,
        includeInternal,
      });
      if (!response.ok) {
        setResult(null);
        setError(response.error);
        return;
      }
      setResult(response.data);
    });
  }

  return (
    <div className="mt-5 rounded-lg border border-dashed border-border/80 bg-muted/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FlaskConical className="size-4" aria-hidden="true" />
            Dry run retrieval
          </h3>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
            See which passages and scores a question would retrieve. No chat
            model call, answer, conversation or usage is created. A configured
            embedding endpoint may still run.
          </p>
        </div>
        <StatusBadge tone="neutral">No model call</StatusBadge>
      </div>

      <form onSubmit={run} className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1 space-y-1.5">
          <Label htmlFor="juno-dry-run-query">Question</Label>
          <Input
            id="juno-dry-run-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="How do I export a CSV?"
            maxLength={500}
          />
        </div>
        <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeInternal}
            onChange={(event) => setIncludeInternal(event.target.checked)}
            className="size-4 rounded border-input accent-[var(--primary)]"
          />
          Include internal sources
        </label>
        <Button type="submit" size="sm" disabled={pending || query.trim().length < 2}>
          {pending ? "Retrieving…" : "Show retrieval"}
        </Button>
      </form>

      {error ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge tone={result.clearsFloor ? "success" : "warning"}>
              {result.clearsFloor
                ? "Clears the confidence floor"
                : "Below the confidence floor"}
            </StatusBadge>
            <span>
              Floor {Math.round(result.confidenceFloor * 100)}% ·{" "}
              {result.audience === "internal" ? "internal sources" : "public sources"} ·{" "}
              {result.results.length} passages
            </span>
          </div>
          {result.results.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No passage matched. In production this would hand off as a
              knowledge gap.
            </p>
          ) : (
            <ol className="space-y-2">
              {result.results.map((entry) => (
                <li key={`${entry.rank}-${entry.title}`} className="rounded-md border bg-card p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {entry.rank}. {entry.title}
                    </p>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      score {entry.score.toFixed(3)} · lexical {" "}
                      {entry.lexical.toFixed(3)} · vector {entry.vector.toFixed(3)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {entry.sourceName}
                    {entry.url ? ` · ${entry.url}` : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-xs leading-5 text-muted-foreground">
                    {entry.excerpt}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
}
