import { PenLine } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The widget Messages list.
 *
 * Shared by the live conversation panel and the settings preview so the
 * preview's empty state, thread rows and floating compose button match the
 * real widget. The preview passes no threads; the live panel passes real ones.
 */

export type WidgetMessagesListThread = {
  id: string;
  subject: string;
  preview: string;
  dateLabel: string;
  unread: number;
  unreadAria: string;
};

export type WidgetMessagesListLabels = {
  title: string;
  emptyTitle: string;
  emptyBody: string;
  newConversation: string;
};

function MessagesSkeleton() {
  return (
    <div aria-hidden="true" className="divide-y divide-border">
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className={cn(
            "flex items-center gap-3 py-3",
            row === 2 && "opacity-40",
          )}
        >
          <span className="size-11 shrink-0 rounded-full bg-muted/70" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-2.5 w-2/5 rounded-full bg-muted/70" />
            <span className="block h-2.5 w-3/4 rounded-full bg-muted/50" />
          </span>
          <span className="h-2 w-8 shrink-0 rounded-full bg-muted/60" />
        </div>
      ))}
    </div>
  );
}

export function WidgetMessagesListView({
  items,
  labels,
  productInitial,
  onOpenThread,
  onNewConversation,
}: {
  items: WidgetMessagesListThread[];
  labels: WidgetMessagesListLabels;
  productInitial: string;
  onOpenThread?: (id: string) => void;
  onNewConversation: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col pb-1">
      <h1 className="shrink-0 px-1 pb-4 pt-1 text-[28px] font-bold leading-none tracking-[-0.04em]">
        {labels.title}
      </h1>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {items.length === 0 ? (
          <>
            <MessagesSkeleton />
            <div className="flex min-h-[10rem] flex-col items-center justify-center px-7 py-6 text-center">
              <p className="text-[15px] font-semibold leading-tight">
                {labels.emptyTitle}
              </p>
              <p className="mt-1.5 max-w-[15rem] text-[13px] leading-relaxed text-muted-foreground">
                {labels.emptyBody}
              </p>
            </div>
          </>
        ) : (
          <ul className="divide-y divide-border/40">
            {items.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-1 py-3 text-left transition-colors duration-200 hover:bg-muted/40"
                  onClick={() => onOpenThread?.(thread.id)}
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-semibold text-foreground">
                    {productInitial}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold">
                        {thread.subject}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {thread.dateLabel}
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-muted-foreground">
                      {thread.preview}
                    </span>
                  </span>
                  {thread.unread > 0 ? (
                    <span
                      aria-label={thread.unreadAria}
                      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground"
                    >
                      {thread.unread}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 pt-3">
        <button
          type="button"
          onClick={onNewConversation}
          className="mx-auto flex h-12 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[13.5px] font-semibold text-background shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <PenLine className="size-4" strokeWidth={1.9} aria-hidden="true" />
          {labels.newConversation}
        </button>
      </div>
    </div>
  );
}
