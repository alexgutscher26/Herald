"use client";

import { ArrowLeft, MessageSquare, Paperclip, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  CustomerCsat,
  CustomerMessage,
  CustomerThread,
  CustomerThreads,
} from "@/features/conversations/customer";
import type { IntakeQuestionView } from "@/features/conversations/intake";
import { formatPublicDate } from "@/features/public/i18n";
import { usePublicI18n } from "@/features/public/i18n/provider";

import { conversationApiPath, conversationStreamPath } from "./conversations-api";

/**
 * Widget conversation panel.
 *
 * The browser only knows the two public slugs and the thread id; every request
 * is scoped by the first-party customer session cookie on the server. Polling
 * (not a socket) keeps the panel honest on a static hosting path: new team
 * messages and unread counts appear within one interval, and closing the panel
 * simply stops the timer.
 */

type State =
  | { phase: "list" }
  | { phase: "thread"; id: string };

type FeedbackCard = {
  id: string;
  kind: "create" | "vote" | "follow";
  title: string;
  query: string;
};

export function WidgetMessagesView({
  workspaceSlug,
  productSlug,
  initial,
  online,
}: {
  workspaceSlug: string;
  productSlug: string;
  initial: CustomerThreads;
  online: boolean;
}) {
  const { t, locale } = usePublicI18n();
  const ready = initial.state === "ready" ? initial : null;
  const intakeQuestions: IntakeQuestionView[] =
    initial.state === "not_found" ? [] : initial.intake;
  const [state, setState] = useState<State>({ phase: "list" });
  const [threads, setThreads] = useState<CustomerThread[]>(ready?.threads ?? []);
  const [email, setEmail] = useState(ready?.email ?? "");
  const [messages, setMessages] = useState<CustomerMessage[]>([]);
  const [subject, setSubject] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isOnline, setIsOnline] = useState(online);
  const [feedbackCard, setFeedbackCard] = useState<FeedbackCard | null>(null);
  const [csat, setCsat] = useState<CustomerCsat | null>(null);
  const [junoPending, setJunoPending] = useState(false);
  const [intakeAnswers, setIntakeAnswers] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState("");
  const knownUnread = useRef<number | null>(null);
  const knownMessageIds = useRef<Set<string> | null>(null);

  const base = conversationApiPath({ workspaceSlug, productSlug });

  const refreshList = useCallback(async () => {
    const response = await fetch(base, { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as CustomerThreads;
    if (data.state === "ready") {
      const unread = data.threads.reduce((total, thread) => total + thread.unread, 0);
      if (knownUnread.current === null) {
        knownUnread.current = unread;
      } else if (unread > knownUnread.current) {
        setAnnouncement(
          `${unread} unread message${unread === 1 ? "" : "s"} from the team.`,
        );
        knownUnread.current = unread;
      } else {
        knownUnread.current = unread;
      }
      setThreads(data.threads);
      setIsOnline(data.online);
      setEmail((current) => current || data.email || "");
    }
  }, [base]);

  const loadThread = useCallback(
    async (id: string, markRead: boolean) => {
      const threadPath = conversationApiPath({
        workspaceSlug,
        productSlug,
        conversationId: id,
      });
      const response = await fetch(threadPath, {
        cache: "no-store",
      });
      if (!response.ok) {
        setError("This conversation could not be loaded.");
        return;
      }
      const data = (await response.json()) as {
        state: string;
        messages?: CustomerMessage[];
        feedbackCard?: FeedbackCard | null;
        csat?: CustomerCsat;
        junoPending?: boolean;
      };
      const nextMessages = data.messages ?? [];
      const ids = new Set(nextMessages.map((message) => message.id));
      if (knownMessageIds.current === null) {
        knownMessageIds.current = ids;
      } else {
        const newReplies = nextMessages.filter(
          (message) =>
            !knownMessageIds.current?.has(message.id) && message.author !== "customer",
        );
        if (newReplies.length > 0) {
          setAnnouncement(
            `${newReplies.length} new message${
              newReplies.length === 1 ? "" : "s"
            } from the support team.`,
          );
        }
        knownMessageIds.current = ids;
      }
      setMessages(nextMessages);
      setFeedbackCard(data.feedbackCard ?? null);
      setCsat(data.csat ?? null);
      setJunoPending(data.junoPending ?? false);
      if (markRead) {
        await fetch(threadPath, {
          method: "PATCH",
          headers: { origin: window.location.origin },
        }).catch(() => undefined);
      }
      await refreshList();
    },
    [refreshList, workspaceSlug, productSlug],
  );

  const openThread = useCallback(
    async (id: string) => {
      knownMessageIds.current = null;
      setState({ phase: "thread", id });
      setError(null);
      await loadThread(id, true);
    },
    [loadThread],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshList();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [refreshList]);

  useEffect(() => {
    if (state.phase !== "thread") return;
    const id = state.id;
    const timer = window.setInterval(() => {
      void (async () => {
        if (document.visibilityState !== "visible") return;
      const response = await fetch(
        conversationApiPath({
          workspaceSlug,
          productSlug,
          conversationId: id,
        }),
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const data = (await response.json()) as {
        messages?: CustomerMessage[];
        feedbackCard?: FeedbackCard | null;
        csat?: CustomerCsat;
        junoPending?: boolean;
      };
      setMessages(data.messages ?? []);
      setFeedbackCard(data.feedbackCard ?? null);
      setCsat(data.csat ?? null);
      setJunoPending(data.junoPending ?? false);
      await refreshList();
      })();
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [refreshList, state, workspaceSlug, productSlug]);

  // Push replaces the poll's latency when the proxy supports SSE. The poll
  // above stays as the fallback; EventSource reconnects on its own after a
  // dropped connection.
  useEffect(() => {
    if (state.phase !== "thread" || typeof EventSource === "undefined") return;
    const id = state.id;
    const source = new EventSource(
      conversationStreamPath({ workspaceSlug, productSlug, conversationId: id }),
    );
    const onConversation = () => {
      void loadThread(id, false);
    };
    source.addEventListener("conversation", onConversation);
    return () => {
      source.removeEventListener("conversation", onConversation);
      source.close();
    };
  }, [loadThread, state, workspaceSlug, productSlug]);

  async function start() {
    if (draft.trim() === "") {
      setError("Write a message first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json", origin: window.location.origin },
        body: JSON.stringify({
          workspaceSlug,
          productSlug,
          subject: subject.trim() || undefined,
          body: draft,
          email: email.trim() || undefined,
          sourceUrl: document.referrer || undefined,
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
          intake: intakeAnswers,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { conversationId?: string; error?: string }
        | null;
      if (!response.ok || !data?.conversationId) {
        setError(data?.error ?? "Could not send the message.");
        return;
      }
      setDraft("");
      setSubject("");
      await refreshList();
      await openThread(data.conversationId);
    } finally {
      setBusy(false);
    }
  }

  async function reply() {
    if (state.phase !== "thread" || draft.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        conversationApiPath({
          workspaceSlug,
          productSlug,
          conversationId: state.id,
        }),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: window.location.origin,
          },
          body: JSON.stringify({ body: draft }),
        },
      );
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        setError(data?.error ?? "Could not send the message.");
        return;
      }
      setDraft("");
      await openThread(state.id);
    } finally {
      setBusy(false);
    }
  }

  async function rate(rating: number) {
    if (state.phase !== "thread" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        conversationApiPath({
          workspaceSlug,
          productSlug,
          conversationId: state.id,
          action: "csat",
        }),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: window.location.origin,
          },
          body: JSON.stringify({ rating }),
        },
      );
      const data = (await response.json().catch(() => null)) as
        | { error?: string; rating?: number }
        | null;
      if (!response.ok) {
        setError(data?.error ?? "Could not save that rating.");
        return;
      }
      setCsat({ requested: true, rating: data?.rating ?? rating, canRate: false });
    } finally {
      setBusy(false);
    }
  }

  async function respondFeedback(
    actionId: string,
    decision: "confirm" | "decline",
  ) {
    if (state.phase !== "thread") return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        conversationApiPath({
          workspaceSlug,
          productSlug,
          conversationId: state.id,
          action: "feedback",
        }),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: window.location.origin,
          },
          body: JSON.stringify({ actionId, decision }),
        },
      );
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        setError(data?.error ?? "Could not update that card.");
        return;
      }
      await openThread(state.id);
    } finally {
      setBusy(false);
    }
  }

  const feedbackPrompt = feedbackCard
    ? feedbackCard.kind === "create"
      ? `File “${feedbackCard.title}” as a request?`
      : feedbackCard.kind === "vote"
        ? `Vote for “${feedbackCard.title}”?`
        : `Follow “${feedbackCard.title}”?`
    : "";

  if (initial.state === "not_found") {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {t("widget.messagesUnavailable")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          {state.phase === "thread" && (
            <button
              type="button"
              aria-label="Back to conversations"
              className="rounded p-1 hover:bg-muted"
              onClick={() => {
                setState({ phase: "list" });
                setDraft("");
                setError(null);
                setFeedbackCard(null);
              }}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">
            {state.phase === "thread"
              ? threads.find((thread) => thread.id === state.id)?.subject ??
                t("widget.messagesTitle")
              : t("widget.messagesTitle")}
          </h2>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isOnline ? "bg-emerald-500" : "bg-muted-foreground/40"
            }`}
          />
          {isOnline ? "Team online" : "Away"}
        </span>
      </div>

      {state.phase === "list" ? (
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {threads.length > 0 && (
            <ul className="divide-y">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-muted/40"
                    onClick={() => void openThread(thread.id)}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {thread.subject}
                      </span>
                      {thread.unread > 0 && (
                        <span
                          aria-label={`${thread.unread} unread message${
                            thread.unread === 1 ? "" : "s"
                          }`}
                          className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground"
                        >
                          {thread.unread}
                        </span>
                      )}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {thread.preview}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatPublicDate(locale, thread.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 border-t p-4">
            {threads.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("widget.messagesBody")}
              </p>
            )}
            <input
              aria-label="Subject (optional)"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Subject (optional)"
              maxLength={160}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
            <textarea
              aria-label="How can we help?"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "widget-message-error" : undefined}
              className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="How can we help?"
              maxLength={4000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            {!ready?.email && (
              <input
                type="email"
                aria-label="Email for replies (optional)"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Email for replies (optional)"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
            {intakeQuestions.length > 0 && (
              <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Help us route this (optional)
                </p>
                {intakeQuestions.map((question) =>
                  question.kind === "select" ? (
                    <label key={question.id} className="block space-y-1">
                      <span className="text-xs font-medium">{question.label}</span>
                      <select
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        value={intakeAnswers[question.key] ?? ""}
                        onChange={(event) =>
                          setIntakeAnswers((current) => ({
                            ...current,
                            [question.key]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Prefer not to say</option>
                        {question.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label key={question.id} className="block space-y-1">
                      <span className="text-xs font-medium">{question.label}</span>
                      <input
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        maxLength={500}
                        value={intakeAnswers[question.key] ?? ""}
                        onChange={(event) =>
                          setIntakeAnswers((current) => ({
                            ...current,
                            [question.key]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  ),
                )}
                <p className="text-[10px] text-muted-foreground">
                  Every question is optional; you can send your message without answering.
                </p>
              </div>
            )}
            {error && (
              <p id="widget-message-error" role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <Button size="sm" className="w-full" disabled={busy} onClick={() => void start()}>
              <Send className="mr-1.5 h-3.5 w-3.5" />
              {busy ? "Sending…" : "Start conversation"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div
            role="log"
            aria-label="Conversation messages"
            aria-live="polite"
            aria-relevant="additions text"
            className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-4"
          >
            {messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  message.author === "customer"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {message.body ? (
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                ) : null}
                {message.attachments && message.attachments.length > 0 ? (
                  <ul className="mt-2 space-y-1 border-t border-current/15 pt-1.5">
                    {message.attachments.map((attachment) => (
                      <li key={attachment.id}>
                        <a
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex max-w-full items-center gap-1 break-all text-[11px] underline"
                        >
                          <Paperclip className="size-3 shrink-0" aria-hidden="true" />
                          {attachment.fileName}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {message.citations && message.citations.length > 0 ? (
                  <div className="mt-2 border-t border-border/50 pt-1.5">
                    <p className="text-[10px] font-medium">Sources</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {message.citations.map((citation, index) => (
                        <li key={`${citation.title}-${index}`} className="text-[10px]">
                          {citation.url ? (
                            <a
                              className="underline"
                              href={citation.url}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              {citation.title}
                            </a>
                          ) : (
                            citation.title
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <p
                  className={`mt-1 text-[10px] ${
                    message.author === "customer"
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground"
                  }`}
                >
                  {formatPublicDate(locale, message.createdAt)}
                </p>
              </div>
            ))}
            {junoPending && (
              <div
                role="status"
                className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
              >
                Juno is typing…
              </div>
            )}
            {error && (
              <p id="widget-message-error" role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          {csat?.canRate &&
            threads.find((thread) => thread.id === state.id)?.status === "resolved" && (
              <div className="space-y-2 border-t bg-muted/30 p-4">
                <p className="text-sm font-medium">How was this conversation?</p>
                <p className="text-xs text-muted-foreground">
                  Optional. One rating per resolution; reopened threads can be rated once more.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      key={rating}
                      type="button"
                      aria-label={`Rate ${rating} out of 5`}
                      className="size-9 rounded-md border bg-background text-sm font-medium hover:bg-muted disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void rate(rating)}
                    >
                      {rating}
                    </button>
                  ))}
                </div>
              </div>
            )}
          {csat?.rating !== null && csat?.rating !== undefined && (
            <p className="border-t bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
              Thanks for rating this conversation {csat.rating}/5.
            </p>
          )}
          {feedbackCard && (
            <div className="space-y-2 border-t bg-muted/30 p-4">
              <p className="text-sm font-medium">{feedbackPrompt}</p>
              <p className="text-xs text-muted-foreground">
                Juno only does this if you confirm.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void respondFeedback(feedbackCard.id, "confirm")}
                >
                  Confirm
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  className="border bg-background text-foreground hover:bg-muted"
                  onClick={() => void respondFeedback(feedbackCard.id, "decline")}
                >
                  Not now
                </Button>
              </div>
            </div>
          )}
          <div className="space-y-2 border-t p-4">
            <textarea
              aria-label="Write a reply"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "widget-message-error" : undefined}
              className="min-h-16 w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Write a reply…"
              maxLength={4000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button
              size="sm"
              className="w-full"
              disabled={busy || draft.trim() === ""}
              onClick={() => void reply()}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              {busy ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
