"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowLeft } from "lucide-react";
import { toastActionFailure } from "@/components/shared/action-toast";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ConversationSpamRules } from "@/db/schema/support";

import { saveSpamRulesAction } from "./actions";
import type { SpamFeedbackRow } from "./spam-settings";

export function SpamRulesView({
  workspaceSlug,
  productSlug,
  initialRules,
  feedback,
}: {
  workspaceSlug: string;
  productSlug: string;
  initialRules: ConversationSpamRules;
  feedback: SpamFeedbackRow[];
}) {
  const [rules, setRules] = useState(initialRules);
  const [keywords, setKeywords] = useState(initialRules.keywords.join("\n"));
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await saveSpamRulesAction({
        workspaceSlug,
        productSlug,
        rules: {
          ...rules,
          keywords: keywords
            .split(/[\n,]/)
            .map((word) => word.trim())
            .filter(Boolean),
        },
      });
      if (!result.ok) {
        toastActionFailure(result);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
            productSlug,
          )}/conversations`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to inbox
        </Link>
        <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.02em] text-foreground">
          Spam rules
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Screening runs before a thread enters Queue. These rules are lexical and
          deliberately conservative; a false positive is one review in Spam, not a
          deleted message.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Screening</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rules.enabled}
              onChange={(event) =>
                setRules((current) => ({ ...current, enabled: event.target.checked }))
              }
            />
            Screen new conversations and replies
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="spam-min-score">Score required to hold</Label>
              <Input
                id="spam-min-score"
                type="number"
                min={1}
                max={10}
                value={rules.minimumScore}
                onChange={(event) =>
                  setRules((current) => ({
                    ...current,
                    minimumScore: Number(event.target.value),
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="spam-links">Links before the rule fires</Label>
              <Input
                id="spam-links"
                type="number"
                min={2}
                max={20}
                value={rules.linkThreshold}
                onChange={(event) =>
                  setRules((current) => ({
                    ...current,
                    linkThreshold: Number(event.target.value),
                  }))
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="spam-keywords">Keyword phrases (one per line)</Label>
            <Textarea
              id="spam-keywords"
              rows={7}
              value={keywords}
              onChange={(event) => setKeywords(event.target.value)}
              placeholder={"viagra\ncasino\nbuy backlinks"}
            />
            <p className="text-xs text-muted-foreground">
              Whole words or phrases, case-insensitive. Up to 50 entries.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ["shouting", "Shouting"],
                ["repetition", "Repeated characters"],
                ["moneyPromise", "Money promise"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={rules[key]}
                  onChange={(event) =>
                    setRules((current) => ({ ...current, [key]: event.target.checked }))
                  }
                />
                {label}
              </label>
            ))}
          </div>

          <Button type="button" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save rules"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">False-positive feedback</CardTitle>
        </CardHeader>
        <CardContent>
          {feedback.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No operator has overruled a spam verdict yet.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {feedback.map((row) => (
                <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 last:border-0">
                  <span>
                    Conversation{" "}
                    <Link
                      href={`/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
                        productSlug,
                      )}/conversations/${row.conversationId}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {row.conversationId.slice(0, 8)}
                    </Link>{" "}
                    was marked not spam.
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {row.reasons ?? "no reason"} · {new Date(row.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
