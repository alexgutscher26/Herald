"use client";

import { Plus, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/shared/page-header";
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
import { createSegmentAction, deleteSegmentAction } from "@/features/segments/actions";
import { describeSegmentRule, type SegmentRule } from "@/features/segments/rules";
import type { SegmentSummary } from "@/features/segments/service";

type DraftRule = {
  type: "trait" | "plan" | "activity";
  key: string;
  traitOperator: "equals" | "contains" | "in" | "exists";
  planOperator: "equals" | "in";
  activityOperator: "performed" | "not_performed";
  value: string;
  event: string;
  withinDays: string;
};

function emptyRule(): DraftRule {
  return {
    type: "trait",
    key: "plan",
    traitOperator: "equals",
    planOperator: "equals",
    activityOperator: "performed",
    value: "",
    event: "",
    withinDays: "30",
  };
}

function toRule(draft: DraftRule): SegmentRule | null {
  if (draft.type === "trait") {
    if (!draft.key.trim()) return null;
    if (draft.traitOperator !== "exists" && !draft.value.trim()) return null;
    return {
      type: "trait",
      key: draft.key.trim(),
      operator: draft.traitOperator,
      value: draft.value.trim(),
    };
  }
  if (draft.type === "plan") {
    if (!draft.value.trim()) return null;
    return { type: "plan", operator: draft.planOperator, value: draft.value.trim() };
  }
  if (!draft.event.trim()) return null;
  return {
    type: "activity",
    event: draft.event.trim(),
    operator: draft.activityOperator,
    withinDays: Math.min(Math.max(Number.parseInt(draft.withinDays, 10) || 30, 1), 365),
  };
}

export function SegmentsView({
  workspaceSlug,
  productSlug,
  segments,
  canWrite,
}: {
  workspaceSlug: string;
  productSlug: string;
  segments: SegmentSummary[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [drafts, setDrafts] = useState<DraftRule[]>([emptyRule()]);
  const [error, setError] = useState<string | null>(null);

  function updateDraft(index: number, patch: Partial<DraftRule>): void {
    setDrafts((current) =>
      current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)),
    );
  }

  function save(event: FormEvent): void {
    event.preventDefault();
    setError(null);

    const rules = drafts.map(toRule).filter((rule): rule is SegmentRule => rule !== null);
    if (rules.length === 0) {
      setError("Add at least one complete rule.");
      return;
    }

    startTransition(async () => {
      const result = await createSegmentAction({
        workspaceSlug,
        productSlug,
        name,
        description,
        rules,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      setDescription("");
      setDrafts([emptyRule()]);
      router.refresh();
    });
  }

  function remove(segment: SegmentSummary): void {
    startTransition(async () => {
      const result = await deleteSegmentAction({
        workspaceSlug,
        productSlug,
        segmentId: segment.id,
      });
      if (!result.ok) {
        toast.error("Could not delete that segment", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Segments"
        description="Reusable audiences built from customer traits, plan and product activity. One definition, used by outbound messages and win-back campaigns."
        meta={<span>{segments.length} saved</span>}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4" aria-hidden="true" />
              Saved segments
            </CardTitle>
            <CardDescription>
              Counts are evaluated against current workspace customers and this product&apos;s
              events, so a segment can change size between sends.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {segments.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No segments yet"
                description="Build one on the right, then choose it when creating an outbound message or a win-back campaign."
              />
            ) : (
              segments.map((segment) => (
                <div key={segment.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{segment.name}</p>
                      {segment.description ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {segment.description}
                        </p>
                      ) : null}
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {segment.rules.map((rule, index) => (
                          <li
                            key={`${segment.id}-${index}`}
                            className="rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                          >
                            {describeSegmentRule(rule)}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium tabular-nums">
                        {segment.count.toLocaleString("en")}
                      </span>
                      {canWrite ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => remove(segment)}
                          aria-label={`Delete ${segment.name}`}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {canWrite ? (
          <Card>
            <CardHeader>
              <CardTitle>New segment</CardTitle>
              <CardDescription>
                Traits match customer attributes; plan matches the <code>plan</code> trait;
                activity matches product events recorded by the API or SDK.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={save} className="space-y-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="segment-name">Name</Label>
                  <Input
                    id="segment-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={120}
                    placeholder="Pro accounts active last month"
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="segment-description">Description (optional)</Label>
                  <Input
                    id="segment-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    maxLength={500}
                  />
                </div>

                <fieldset className="space-y-3 rounded-lg border p-3">
                  <legend className="px-1 text-sm font-medium">Rules</legend>
                  {drafts.map((draft, index) => (
                    <div key={index} className="space-y-2 rounded-md border bg-muted/20 p-2.5">
                      <div className="flex items-center gap-2">
                        <select
                          aria-label={`Rule ${index + 1} type`}
                          value={draft.type}
                          onChange={(event) =>
                            updateDraft(index, {
                              type: event.target.value as DraftRule["type"],
                            })
                          }
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        >
                          <option value="trait">Trait</option>
                          <option value="plan">Plan</option>
                          <option value="activity">Activity</option>
                        </select>
                        {drafts.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setDrafts((current) =>
                                current.filter((_, position) => position !== index),
                              )
                            }
                            aria-label={`Remove rule ${index + 1}`}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        ) : null}
                      </div>

                      {draft.type === "trait" ? (
                        <div className="grid gap-2 sm:grid-cols-[1fr_120px_1fr]">
                          <Input
                            aria-label={`Rule ${index + 1} trait key`}
                            value={draft.key}
                            onChange={(event) => updateDraft(index, { key: event.target.value })}
                            placeholder="plan"
                          />
                          <select
                            aria-label={`Rule ${index + 1} operator`}
                            value={draft.traitOperator}
                            onChange={(event) =>
                              updateDraft(index, {
                                traitOperator: event.target
                                  .value as DraftRule["traitOperator"],
                              })
                            }
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                          >
                            <option value="equals">equals</option>
                            <option value="contains">contains</option>
                            <option value="in">is one of</option>
                            <option value="exists">exists</option>
                          </select>
                          <Input
                            aria-label={`Rule ${index + 1} trait value`}
                            value={draft.value}
                            onChange={(event) => updateDraft(index, { value: event.target.value })}
                            placeholder="pro, team"
                            disabled={draft.traitOperator === "exists"}
                          />
                        </div>
                      ) : null}

                      {draft.type === "plan" ? (
                        <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
                          <select
                            aria-label={`Rule ${index + 1} plan operator`}
                            value={draft.planOperator}
                            onChange={(event) =>
                              updateDraft(index, {
                                planOperator: event.target.value as DraftRule["planOperator"],
                              })
                            }
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                          >
                            <option value="equals">is</option>
                            <option value="in">is one of</option>
                          </select>
                          <Input
                            aria-label={`Rule ${index + 1} plan value`}
                            value={draft.value}
                            onChange={(event) => updateDraft(index, { value: event.target.value })}
                            placeholder="pro, scale"
                          />
                        </div>
                      ) : null}

                      {draft.type === "activity" ? (
                        <div className="grid gap-2 sm:grid-cols-[1fr_130px_80px]">
                          <Input
                            aria-label={`Rule ${index + 1} event name`}
                            value={draft.event}
                            onChange={(event) => updateDraft(index, { event: event.target.value })}
                            placeholder="report_exported"
                          />
                          <select
                            aria-label={`Rule ${index + 1} activity operator`}
                            value={draft.activityOperator}
                            onChange={(event) =>
                              updateDraft(index, {
                                activityOperator: event.target
                                  .value as DraftRule["activityOperator"],
                              })
                            }
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                          >
                            <option value="performed">performed</option>
                            <option value="not_performed">not performed</option>
                          </select>
                          <Input
                            aria-label={`Rule ${index + 1} window in days`}
                            type="number"
                            min={1}
                            max={365}
                            value={draft.withinDays}
                            onChange={(event) =>
                              updateDraft(index, { withinDays: event.target.value })
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDrafts((current) => [...current, emptyRule()])}
                    disabled={drafts.length >= 10}
                  >
                    <Plus aria-hidden="true" />
                    Add rule
                  </Button>
                </fieldset>

                {error ? (
                  <p role="alert" className="text-xs font-medium text-destructive">
                    {error}
                  </p>
                ) : null}

                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save segment"}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-5 text-sm text-muted-foreground">
              You can read segments but not create them. Ask an admin for settings access.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
