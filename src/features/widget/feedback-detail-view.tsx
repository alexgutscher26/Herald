import { ArrowLeft, ArrowUp, BadgeCheck, CircleDot, X } from "lucide-react";

import type { PublicFeedbackStatus } from "@/features/public/types";
import { cn } from "@/lib/utils";

/**
 * Focused feedback request screen.
 *
 * The live embed currently keeps its request panel inside the tabbed shell;
 * this view is the focused mobile-style detail shown in the customizer, with
 * the back/close header, request summary, voters and comments. It is
 * presentational so the preview can use sample data without a second fetch.
 */

const STATUS_DOTS: Record<PublicFeedbackStatus, string> = {
  open: "text-amber-400",
  under_review: "text-orange-400",
  planned: "text-sky-400",
  in_progress: "text-violet-400",
  shipped: "text-emerald-400",
  closed: "text-muted-foreground",
};

const AVATAR_TONES = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
];

function avatarTone(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function Avatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const tone = avatarTone(name);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        className,
      )}
      style={{ backgroundColor: `${tone}33`, color: tone }}
    >
      {initials(name)}
    </span>
  );
}

export type WidgetFeedbackDetailComment = {
  id: string;
  authorName: string;
  body: string;
  ageLabel: string;
  voteCount: number;
};

export type WidgetFeedbackDetailRequest = {
  title: string;
  body: string;
  authorName: string;
  status: PublicFeedbackStatus;
  statusLabel: string;
  voteCount: number;
};

export function WidgetFeedbackDetailView({
  request,
  comments,
  voters,
  labels,
  onBack,
  onClose,
  showAttribution,
}: {
  request: WidgetFeedbackDetailRequest;
  comments: WidgetFeedbackDetailComment[];
  voters: string[];
  labels: {
    header: string;
    commentPlaceholder: string;
    reply: string;
    attribution: string;
  };
  onBack: () => void;
  onClose: () => void;
  showAttribution: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to feedback"
          className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>
        <p className="text-[18px] font-semibold tracking-tight">
          {labels.header}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close widget preview"
          className="ml-auto inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      <div className="widget-scrollbars-hidden min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        <div className="flex items-center gap-3 pt-2">
          <span className="relative shrink-0">
            <Avatar
              name={request.authorName}
              className="size-10 text-[12px]"
            />
            <span className="absolute -bottom-1 -right-1 flex size-[18px] items-center justify-center rounded-full bg-white text-sky-500 shadow-sm ring-2 ring-background">
              <BadgeCheck className="size-3.5" strokeWidth={2.4} aria-hidden="true" />
            </span>
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-tight">
              {request.authorName}
            </p>
            <p className="mt-0.5 text-[13px] leading-none text-muted-foreground">
              1y
            </p>
          </div>
        </div>

        <h1 className="mt-5 break-words text-[30px] font-bold leading-[1.06] tracking-[-0.035em]">
          {request.title}
        </h1>
        <p className="mt-3 whitespace-pre-line break-words text-[16.5px] leading-[1.5] text-foreground/90">
          {request.body}
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex h-9 items-center gap-2 rounded-full border border-border/80 bg-card px-3 text-[14px] font-semibold">
            <CircleDot
              className={cn("size-3.5", STATUS_DOTS[request.status])}
              aria-hidden="true"
            />
            {request.statusLabel}
          </span>

          <div className="ml-auto flex items-center gap-3">
            <span className="flex -space-x-2" aria-hidden="true">
              {voters.slice(0, 4).map((voter) => (
                <Avatar
                  key={voter}
                  name={voter}
                  className="size-8 text-[10px] ring-2 ring-background"
                />
              ))}
            </span>
            <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/80 px-3 text-[13px] font-semibold tabular-nums">
              <ArrowUp className="size-4" strokeWidth={2} aria-hidden="true" />
              {request.voteCount}
            </span>
          </div>
        </div>

        <div className="mt-7 border-t border-dashed border-border/70" />

        <div className="mt-6 rounded-[20px] border border-border/70 bg-card/40 p-4">
          <p className="text-[15px] leading-none text-muted-foreground/80">
            {labels.commentPlaceholder}
          </p>
          <div className="mt-10 flex justify-end">
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-full bg-muted/60 text-muted-foreground"
            >
              <ArrowUp className="size-4" strokeWidth={2} />
            </span>
          </div>
        </div>

        <ul className="mt-6 space-y-5">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-3">
              <Avatar
                name={comment.authorName}
                className="size-9 text-[11px]"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[15px] font-semibold leading-tight">
                    {comment.authorName}
                  </span>
                  <span className="text-[13px] leading-none text-muted-foreground">
                    {comment.ageLabel}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-line break-words text-[15px] leading-relaxed">
                  {comment.body}
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-[14px] font-medium text-muted-foreground">
                    {labels.reply}
                  </span>
                  <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/80 px-3 text-[13px] font-semibold tabular-nums">
                    <ArrowUp
                      className="size-3.5"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                    {comment.voteCount}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {showAttribution ? (
        <p className="shrink-0 pb-1.5 text-center text-[8.5px] leading-tight text-muted-foreground/80">
          {labels.attribution}
        </p>
      ) : null}
    </div>
  );
}
