import { Sparkles } from "lucide-react";

import { SettingsSection } from "@/components/shared/settings-section";
import { StatusBadge } from "@/components/shared/status-badge";

import { listRecentSuggestions } from "./auxiliary";

type SuggestionRow = Awaited<ReturnType<typeof listRecentSuggestions>>[number];

function tagsFrom(payload: Record<string, unknown>): string[] {
  return Array.isArray(payload.tags)
    ? payload.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
}

function matchesFrom(
  payload: Record<string, unknown>,
): { id: string; title: string; score: number }[] {
  if (!Array.isArray(payload.matches)) return [];
  return payload.matches.flatMap((match) => {
    if (!match || typeof match !== "object") return [];
    const value = match as Record<string, unknown>;
    return typeof value.id === "string" && typeof value.title === "string"
      ? [
          {
            id: value.id,
            title: value.title,
            score: typeof value.score === "number" ? value.score : 0,
          },
        ]
      : [];
  });
}

/**
 * Suggestions are read-only on purpose: applying a tag or merging a duplicate
 * stays a human decision in the feedback screen.
 */
export function JunoSuggestionsView({ suggestions }: { suggestions: SuggestionRow[] }) {
  return (
    <SettingsSection
      icon={Sparkles}
      title="Auxiliary AI suggestions"
      description="New public requests are labelled and checked for duplicates in separate jobs, each with its own prompt and budget check. Nothing is applied automatically."
      badge={
        <StatusBadge tone={suggestions.length > 0 ? "accent" : "neutral"}>
          {suggestions.length} recent
        </StatusBadge>
      }
    >
      {suggestions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/15 px-4 py-5 text-sm text-muted-foreground">
          No suggestions yet. They appear here after new public requests are processed.
        </div>
      ) : (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/80">
          {suggestions.map((row) => {
            const tags = tagsFrom(row.payload);
            const matches = matchesFrom(row.payload);
            return (
              <li key={row.id} className="px-3.5 py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{row.postTitle}</span>
                    <StatusBadge tone={row.kind === "tags" ? "accent" : "neutral"}>
                      {row.kind === "tags" ? "Tags" : "Duplicates"}
                    </StatusBadge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(row.createdAt).toLocaleDateString()}
                  </span>
                </div>

                {row.kind === "tags" ? (
                  tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-border/80 bg-muted/25 px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      No existing tag fit.
                    </p>
                  )
                ) : matches.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {matches.map((match) => (
                      <li key={match.id} className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{match.title}</span>
                        <span className="rounded-full bg-muted/40 px-1.5 py-0.5 tabular-nums">
                          {Math.round(match.score * 100)}% similar
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No likely duplicate found.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SettingsSection>
  );
}
