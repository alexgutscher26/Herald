import { ClipboardCheck } from "lucide-react";

import { SettingsSection } from "@/components/shared/settings-section";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  addJunoEvalCaseAction,
  deleteJunoEvalCaseAction,
  runJunoEvaluationAction,
} from "./actions";
import { listEvalStatus } from "./evaluation";

type EvalRow = Awaited<ReturnType<typeof listEvalStatus>>[number];

function resultLabel(row: EvalRow): string {
  if (row.passed === null) return "Not run";
  return row.passed ? "Pass" : "Fail";
}

function resultTone(row: EvalRow): StatusTone {
  if (row.passed === null) return "neutral";
  return row.passed ? "success" : "danger";
}

/**
 * Golden set and regression gate.
 *
 * The same card shows the questions, the latest result and the controls. A
 * model change is refused by the server until every current question has a
 * passing run, so the button here is the only legitimate way to unlock one.
 */
export function JunoEvaluationView({
  workspaceSlug,
  productSlug,
  cases,
  canManage,
}: {
  workspaceSlug: string;
  productSlug: string;
  cases: EvalRow[];
  canManage: boolean;
}) {
  const lastRun = cases
    .map((row) => row.ranAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);

  return (
    <SettingsSection
      icon={ClipboardCheck}
      title="Evaluation"
      description="A small golden set per product. A model change is refused until the latest run passes every current question; each run records the model and prompt version."
      badge={
        <StatusBadge tone="neutral">
          {cases.length} {cases.length === 1 ? "question" : "questions"}
        </StatusBadge>
      }
      action={
        cases.length > 0 ? (
          <form action={runJunoEvaluationAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
            <input type="hidden" name="productSlug" value={productSlug} />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                name="includeInternal"
                className="size-4 accent-primary"
                disabled={!canManage}
              />
              Include internal-only sources
            </label>
            <Button type="submit" size="sm" variant="outline" disabled={!canManage}>
              Run evaluation
            </Button>
          </form>
        ) : null
      }
    >
      <p className="text-xs text-muted-foreground">
        {lastRun ? `Last run ${new Date(lastRun).toLocaleString()}` : "No run yet"}
      </p>

      {cases.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/15 px-4 py-5 text-sm leading-6 text-muted-foreground">
          Add a question covered by your sources and one that should hand off to build the
          regression gate.
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border/70 overflow-hidden rounded-lg border border-border/80">
          {cases.map((row) => (
            <li
              key={row.caseId}
              className="flex flex-wrap items-start justify-between gap-3 px-3.5 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm text-foreground">{row.question}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {row.expectHandoff ? "Expects a handoff" : "Expects a cited answer"}
                  {row.reason ? ` · ${row.reason}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tone={resultTone(row)}>{resultLabel(row)}</StatusBadge>
                {canManage ? (
                  <form action={deleteJunoEvalCaseAction}>
                    <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                    <input type="hidden" name="productSlug" value={productSlug} />
                    <input type="hidden" name="caseId" value={row.caseId} />
                    <Button type="submit" size="sm" variant="ghost">
                      Remove
                    </Button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form
          action={addJunoEvalCaseAction}
          className="mt-4 space-y-3 rounded-lg border border-dashed border-border bg-muted/15 p-4"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Add a test question
          </p>
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          <input type="hidden" name="productSlug" value={productSlug} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="eval-question">Customer question</Label>
              <Input
                id="eval-question"
                name="question"
                required
                minLength={3}
                maxLength={500}
                placeholder="How do I invite a teammate?"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="eval-keywords">
                Expected phrases (comma separated)
              </Label>
              <Input
                id="eval-keywords"
                name="expectedKeywords"
                placeholder="invite, settings"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                name="expectHandoff"
                className="size-4 accent-primary"
              />
              This question must hand off
            </label>
            <Button type="submit" size="sm">
              Add question
            </Button>
          </div>
        </form>
      ) : null}
    </SettingsSection>
  );
}
