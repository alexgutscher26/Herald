"use client";

import { ArrowBigUp, Bell, BellOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { errorMessage, sendJson } from "./client";
import { formatPublicNumber, type PublicMessageKey } from "./i18n";
import { usePublicI18n } from "./i18n/provider";
import type { PublicReaction, PublicReactionKind } from "./types";

/**
 * Vote, follow and reaction controls.
 *
 * Each applies its change optimistically and rolls back on failure, then
 * refreshes the server component so counts and the comment list stay truthful
 * for other visitors' activity.
 */

export function VoteButton({
  requestApiBase,
  initialVoted,
  initialCount,
}: {
  requestApiBase: string;
  initialVoted: boolean;
  initialCount: number;
}) {
  const router = useRouter();
  const { t, locale } = usePublicI18n();
  const [state, setState] = useState({ voted: initialVoted, count: initialCount });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    if (pending) return;

    const previous = state;
    const next = !state.voted;
    setState({ voted: next, count: Math.max(0, state.count + (next ? 1 : -1)) });
    setPending(true);
    setError("");

    const result = await sendJson(
      `${requestApiBase}/vote`,
      next ? "POST" : "DELETE",
    );

    if (!result.ok) {
      setState(previous);
      setError(errorMessage(result, t("request.voteError")));
    } else {
      setState({
        voted: Boolean(result.data.voted),
        count:
          typeof result.data.voteCount === "number"
            ? result.data.voteCount
            : next
              ? previous.count + 1
              : previous.count - 1,
      });
      router.refresh();
    }

    setPending(false);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={state.voted ? "default" : "outline"}
        onClick={toggle}
        disabled={pending}
        aria-pressed={state.voted}
        aria-label={
          state.voted ? t("request.voteRemoveAria") : t("request.voteAddAria")
        }
        className="h-10 gap-2 px-4"
      >
        <ArrowBigUp className="size-5" aria-hidden="true" />
        <span className="tabular-nums">{formatPublicNumber(locale, state.count)}</span>
        <span className="text-sm">
          {state.voted ? t("request.voted") : t("request.vote")}
        </span>
      </Button>
      {error ? (
        <p role="status" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FollowButton({
  requestApiBase,
  initialFollows,
}: {
  requestApiBase: string;
  initialFollows: boolean;
}) {
  const router = useRouter();
  const { t } = usePublicI18n();
  const [follows, setFollows] = useState(initialFollows);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    if (pending) return;

    const previous = follows;
    const next = !follows;
    setFollows(next);
    setPending(true);
    setError("");

    const result = await sendJson(
      `${requestApiBase}/follow`,
      next ? "POST" : "DELETE",
    );

    if (!result.ok) {
      setFollows(previous);
      setError(errorMessage(result, t("request.followError")));
    } else {
      setFollows(Boolean(result.data.follows));
      router.refresh();
    }

    setPending(false);
  }

  const Icon = follows ? BellOff : Bell;

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={toggle}
        disabled={pending}
        aria-pressed={follows}
      >
        <Icon aria-hidden="true" />
        {follows ? t("request.unfollow") : t("request.follow")}
      </Button>
      {error ? (
        <p role="status" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const REACTION_OPTIONS: {
  kind: PublicReactionKind;
  emoji: string;
  labelKey: PublicMessageKey;
}[] = [
  { kind: "like", emoji: "👍", labelKey: "request.reaction.like" },
  { kind: "love", emoji: "❤️", labelKey: "request.reaction.love" },
  { kind: "celebrate", emoji: "🎉", labelKey: "request.reaction.celebrate" },
];

export function ReactionBar({
  requestApiBase,
  endpoint,
  initial,
  disabled = false,
  signInHref,
}: {
  requestApiBase?: string;
  /** Full reaction endpoint; used by release entries, which carry query params. */
  endpoint?: string;
  initial: PublicReaction[];
  /** Counts stay visible; guests are sent to sign in instead of reacting. */
  disabled?: boolean;
  signInHref?: string;
}) {
  const router = useRouter();
  const { t } = usePublicI18n();
  const [reactions, setReactions] = useState(initial);
  const [pending, setPending] = useState<PublicReactionKind | null>(null);
  const [error, setError] = useState("");

  async function toggle(kind: PublicReactionKind) {
    if (pending || disabled) return;

    const previous = reactions;
    const target = reactions.find((reaction) => reaction.kind === kind);
    const nextReacted = !target?.reacted;

    setReactions((current) =>
      current.map((reaction) =>
        reaction.kind === kind
          ? {
              ...reaction,
              reacted: nextReacted,
              count: Math.max(0, reaction.count + (nextReacted ? 1 : -1)),
            }
          : reaction,
      ),
    );
    setPending(kind);
    setError("");

    const api = endpoint ?? `${requestApiBase ?? ""}/reactions`;
    const result = await sendJson(
      nextReacted
        ? api
        : `${api}${api.includes("?") ? "&" : "?"}kind=${kind}`,
      nextReacted ? "POST" : "DELETE",
      nextReacted ? { kind } : undefined,
    );

    if (!result.ok) {
      setReactions(previous);
      setError(errorMessage(result, t("request.reactionError")));
    } else {
      setReactions((current) =>
        current.map((reaction) =>
          reaction.kind === kind
            ? {
                ...reaction,
                reacted: Boolean(result.data.reacted),
                count:
                  typeof result.data.count === "number"
                    ? result.data.count
                    : reaction.count,
              }
            : reaction,
        ),
      );
      router.refresh();
    }

    setPending(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {REACTION_OPTIONS.map((option) => {
        const reaction = reactions.find((item) => item.kind === option.kind);
        const active = reaction?.reacted ?? false;

        return (
          <button
            key={option.kind}
            type="button"
            onClick={() => toggle(option.kind)}
            disabled={pending !== null || disabled}
            aria-pressed={active}
            aria-label={`${t(option.labelKey)} (${reaction?.count ?? 0})`}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              active
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <span aria-hidden="true">{option.emoji}</span>
            <span className="tabular-nums">{reaction?.count ?? 0}</span>
          </button>
        );
      })}
      {error ? (
        <p role="status" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {disabled && signInHref ? (
        <Link href={signInHref} className="text-xs font-medium text-primary hover:underline">
          {t("updates.reactSignIn")}
        </Link>
      ) : null}
    </div>
  );
}
