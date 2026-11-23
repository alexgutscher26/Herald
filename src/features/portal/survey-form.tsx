"use client";

import { useMemo, useState } from "react";

import type { SurveyQuestion } from "@/db/schema/engagement";
import { visibleSurveyQuestions } from "@/features/engagement/survey-logic";

const VISITOR_KEY = "herald-survey-visitor";

function visitorKey(): string {
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing && existing.length >= 8) return existing;
    const created =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `visitor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(VISITOR_KEY, created);
    return created;
  } catch {
    return `visitor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

export function PortalSurveyForm({
  workspaceSlug,
  productSlug,
  slug,
  kind,
  questions,
}: {
  workspaceSlug: string;
  productSlug: string;
  slug: string;
  kind: "nps" | "csat" | "custom";
  questions: SurveyQuestion[];
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [optIn, setOptIn] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  // The shared rule cascades: changing the first answer collapses every
  // follow-up that depended on it, not only the immediate next question.
  const visible = useMemo(
    () => visibleSurveyQuestions(questions, answers),
    [questions, answers],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setMessage(null);
    try {
      const response = await fetch(`/api/public/surveys/${encodeURIComponent(slug)}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceSlug,
          productSlug,
          visitorKey: visitorKey(),
          answers,
          optIn,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setState("error");
        setMessage(data.error ?? "Could not save your response.");
        return;
      }
      setState("sent");
    } catch {
      setState("error");
      setMessage("Could not reach the survey. Try again.");
    }
  }

  if (state === "sent") {
    return (
      <div className="rounded-lg border border-success/30 bg-success-muted p-5 text-sm text-success">
        <p className="font-medium">Thank you.</p>
        <p className="mt-1">
          Your response is recorded.{optIn ? " A feedback request will follow in the portal." : ""}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6 rounded-lg border bg-card p-5">
      {visible.map((question) => (
        <fieldset key={question.id} className="space-y-2">
          <legend className="text-sm font-medium">
            {question.prompt}
            {question.required ? <span className="ml-1 text-destructive">*</span> : null}
          </legend>
          {question.type === "rating" ? (
            <div className="flex flex-wrap gap-1.5">
              {Array.from(
                { length: kind === "nps" ? 11 : 5 },
                (_, index) => (kind === "nps" ? index : index + 1),
              ).map((value) => (
                <label
                  key={value}
                  className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md border text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground"
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={question.id}
                    value={String(value)}
                    checked={answers[question.id] === String(value)}
                    onChange={() =>
                      setAnswers((current) => ({ ...current, [question.id]: String(value) }))
                    }
                  />
                  {value}
                </label>
              ))}
            </div>
          ) : question.type === "choice" ? (
            <div className="space-y-2">
              {(question.options ?? []).map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={question.id}
                    value={option}
                    checked={answers[question.id] === option}
                    onChange={() =>
                      setAnswers((current) => ({ ...current, [question.id]: option }))
                    }
                  />
                  {option}
                </label>
              ))}
            </div>
          ) : (
            <textarea
              name={question.id}
              rows={3}
              value={answers[question.id] ?? ""}
              onChange={(event) =>
                setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
              }
              className="w-full rounded-md border border-input bg-background p-3 text-sm"
            />
          )}
        </fieldset>
      ))}

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={optIn}
          onChange={(event) => setOptIn(event.target.checked)}
          className="mt-1"
        />
        <span>
          Share this as a feedback request with the team. Your answers are only connected
          to a request when you choose this.
        </span>
      </label>

      {message ? <p className="text-sm text-destructive">{message}</p> : null}
      <button
        type="submit"
        disabled={state === "sending"}
        className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {state === "sending" ? "Sending…" : "Submit response"}
      </button>
    </form>
  );
}
