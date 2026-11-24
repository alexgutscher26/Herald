"use client";

import { ArrowLeft, ArrowUp, Paperclip, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Markdown } from "@/components/shared/markdown";
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
import { cn } from "@/lib/utils";

import { WidgetCloseButton } from "./frame-bridge";
import { conversationApiPath, conversationStreamPath } from "./conversations-api";
import { WidgetMessagesListView } from "./messages-list-view";

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
  | { phase: "compose" }
  | { phase: "thread"; id: string };

type FeedbackCard = {
  id: string;
  kind: "create" | "vote" | "follow";
  title: string;
  query: string;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "H";
}

/**
 * Keep an existing signed image URL while it is still comfortably valid.
 * Polling re-signs every attachment URL; without this, an inline image would
 * reload on every poll even when nothing in the thread changed.
 */
function mergeCustomerMessages(
  current: CustomerMessage[],
  next: CustomerMessage[],
): CustomerMessage[] {
  const previous = new Map(current.map((message) => [message.id, message]));
  const now = Date.now();

  return next.map((message) => {
    const old = previous.get(message.id);
    if (!old?.attachments || !message.attachments) return message;

    const oldAttachments = new Map(
      old.attachments.map((attachment) => [attachment.id, attachment]),
    );
    return {
      ...message,
      attachments: message.attachments.map((attachment) => {
        const prior = oldAttachments.get(attachment.id);
        if (!prior) return attachment;
        const expires = Number(
          new URL(prior.url, window.location.origin).searchParams.get("expires"),
        );
        return Number.isFinite(expires) && expires - now > 60_000
          ? { ...attachment, url: prior.url }
          : attachment;
      }),
    };
  });
}

function MessagesSubheader({
  hostOrigin,
  onBack,
  backLabel,
  closeLabel,
}: {
  hostOrigin: string | null;
  onBack: () => void;
  backLabel: string;
  closeLabel: string;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 pb-1 pt-1">
      <button
        type="button"
        aria-label={backLabel}
        className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
      </button>
      <WidgetCloseButton hostOrigin={hostOrigin} label={closeLabel} />
    </div>
  );
}

export function WidgetMessagesView({
  workspaceSlug,
  productSlug,
  productName,
  hostOrigin,
  initial,
}: {
  workspaceSlug: string;
  productSlug: string;
  productName: string;
  hostOrigin: string | null;
  initial: CustomerThreads;
}) {
  const { t, locale } = usePublicI18n();
  const intakeQuestions: IntakeQuestionView[] =
    initial.state === "not_found" ? [] : initial.intake;
  const [state, setState] = useState<State>({ phase: "list" });
  const [threads, setThreads] = useState<CustomerThread[]>(
    initial.state === "ready" ? initial.threads : [],
  );
  const [messages, setMessages] = useState<CustomerMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedbackCard, setFeedbackCard] = useState<FeedbackCard | null>(null);
  const [csat, setCsat] = useState<CustomerCsat | null>(null);
  const [junoPending, setJunoPending] = useState(false);
  const [intakeAnswers, setIntakeAnswers] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState("");
  const knownUnread = useRef<number | null>(null);
  const knownMessageIds = useRef<Set<string> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const base = conversationApiPath({ workspaceSlug, productSlug });
  const subview = state.phase !== "list";
  const productInitial = initialFor(productName);
  const canSend = draft.trim() !== "" || imageFile !== null;

  useEffect(() => {
    if (!imagePreview) return;
    return () => URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  const threadId = state.phase === "thread" ? state.id : null;

  // Follow the newest message and Juno's typing bubble, but only while the
  // reader is already at the bottom: a poll must not yank somebody who scrolled
  // back through the history.
  useEffect(() => {
    if (!threadId) return;
    const node = logRef.current;
    if (!node || !pinnedToBottom.current) return;
    node.scrollTo({
      top: node.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [junoPending, messages.length, threadId]);

  // The brand header and tab bar belong to the list. Compose and thread views
  // take over the whole panel, with only the attribution footer remaining.
  useEffect(() => {
    if (!subview) return;
    const root = document.documentElement;
    root.setAttribute("data-herald-messages-subview", "true");
    return () => root.removeAttribute("data-herald-messages-subview");
  }, [subview]);

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
      setMessages((current) => mergeCustomerMessages(current, nextMessages));
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
      pinnedToBottom.current = true;
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
        setMessages((current) =>
          mergeCustomerMessages(current, data.messages ?? []),
        );
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
    if (busy) return;
    if (!canSend) {
      setError("Write a message first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const subject = draft
        .trim()
        .split(/\r?\n/, 1)[0]
        ?.replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
      const sourceUrl = document.referrer || undefined;
      const timezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;

      let response: Response;
      if (imageFile) {
        const form = new FormData();
        form.set("workspaceSlug", workspaceSlug);
        form.set("productSlug", productSlug);
        if (subject) form.set("subject", subject);
        form.set("body", draft);
        if (sourceUrl) form.set("sourceUrl", sourceUrl);
        if (timezone) form.set("timezone", timezone);
        form.set("intake", JSON.stringify(intakeAnswers));
        form.set("image", imageFile, imageFile.name);
        response = await fetch(base, {
          method: "POST",
          headers: { origin: window.location.origin },
          body: form,
        });
      } else {
        response = await fetch(base, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: window.location.origin,
          },
          body: JSON.stringify({
            workspaceSlug,
            productSlug,
            subject: subject || undefined,
            body: draft,
            sourceUrl,
            timezone,
            intake: intakeAnswers,
          }),
        });
      }

      const data = (await response.json().catch(() => null)) as
        | { conversationId?: string; error?: string }
        | null;
      if (!response.ok || !data?.conversationId) {
        setError(data?.error ?? "Could not send the message.");
        return;
      }
      setDraft("");
      clearImage();
      await refreshList();
      await openThread(data.conversationId);
    } finally {
      setBusy(false);
    }
  }

  function chooseImage(file: File) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setError(t("widget.imageUploadError"));
      return;
    }
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      setError(t("widget.imageTooLarge"));
      return;
    }
    setError(null);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function clearImage() {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function reply() {
    if (busy || state.phase !== "thread" || !canSend) return;
    setBusy(true);
    setError(null);
    try {
      const threadPath = conversationApiPath({
        workspaceSlug,
        productSlug,
        conversationId: state.id,
      });
      let response: Response;
      if (imageFile) {
        const form = new FormData();
        form.set("body", draft);
        form.set("image", imageFile, imageFile.name);
        response = await fetch(threadPath, {
          method: "POST",
          headers: { origin: window.location.origin },
          body: form,
        });
      } else {
        response = await fetch(threadPath, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: window.location.origin,
          },
          body: JSON.stringify({ body: draft }),
        });
      }
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        setError(data?.error ?? "Could not send the message.");
        return;
      }
      setDraft("");
      clearImage();
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

  function backToList() {
    setState({ phase: "list" });
    setDraft("");
    clearImage();
    setError(null);
    setFeedbackCard(null);
  }

  function openCompose() {
    setState({ phase: "compose" });
    setDraft("");
    clearImage();
    setError(null);
    setFeedbackCard(null);
  }

  function renderImagePreview() {
    if (!imagePreview || !imageFile) return null;
    return (
      <div className="mb-2 flex items-center gap-2 rounded-xl bg-muted/50 p-1.5">
        {/* The blob URL is local to this composer and revoked on change. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imagePreview}
          alt=""
          className="size-14 shrink-0 rounded-lg object-cover"
        />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {imageFile.name}
        </span>
        <button
          type="button"
          aria-label={t("widget.removeImage")}
          onClick={clearImage}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    );
  }

  function renderIntakeQuestions() {
    if (intakeQuestions.length === 0) return null;

    return (
      <details className="rounded-xl border border-border/80 bg-muted/20 px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
          Help us route this (optional)
        </summary>
        <div className="mt-2 space-y-2">
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
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Every question is optional; you can send your message without answering.
        </p>
      </details>
    );
  }

  function renderList() {
    return (
      <WidgetMessagesListView
        items={threads.map((thread) => ({
          id: thread.id,
          subject: thread.subject,
          preview: thread.preview,
          dateLabel: formatPublicDate(locale, thread.updatedAt),
          unread: thread.unread,
          unreadAria: `${thread.unread} unread message${
            thread.unread === 1 ? "" : "s"
          }`,
        }))}
        labels={{
          title: t("widget.messagesTitle"),
          emptyTitle: t("widget.messagesEmptyTitle"),
          emptyBody: t("widget.messagesBody"),
          newConversation: t("widget.newConversation"),
        }}
        productInitial={productInitial}
        onOpenThread={(id) => void openThread(id)}
        onNewConversation={openCompose}
      />
    );
  }

  function renderCompose() {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <MessagesSubheader
          hostOrigin={hostOrigin}
          onBack={backToList}
          backLabel={t("widget.backToMessages")}
          closeLabel={t("widget.close")}
        />

        <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 pb-1">
          <div className="min-h-3 flex-1" />

          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-[15px] font-semibold text-foreground">
            {productInitial}
          </span>

          <div className="px-1">
            <h1 className="text-[22px] font-bold leading-[1.1] tracking-[-0.035em]">
              {t("widget.composeTitle")}
            </h1>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {t("widget.sendMessageBody")}
            </p>
          </div>

          <div className="rounded-[20px] border border-border/80 bg-card p-3 shadow-sm">
            {renderImagePreview()}
            <textarea
              aria-label={t("widget.messagePlaceholder")}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "widget-message-error" : undefined}
              className="min-h-[4.5rem] w-full resize-none bg-transparent p-0 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
              placeholder={t("widget.messagePlaceholder")}
              rows={2}
              maxLength={4000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void start();
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                aria-label={t("widget.attachImage")}
                title={t("widget.attachImage")}
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
              >
                <Paperclip className="size-4" strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={t("widget.send")}
                disabled={busy || !canSend}
                onClick={() => void start()}
                className={cn(
                  "flex size-9 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  canSend && !busy
                    ? "bg-foreground text-background hover:opacity-90"
                    : "bg-muted text-muted-foreground/55",
                )}
              >
                <ArrowUp className="size-4" strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>

          {renderIntakeQuestions()}

          {error ? (
            <p id="widget-message-error" role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  function renderThread(id: string) {
    const thread = threads.find((item) => item.id === id);

    return (
      <div className="flex h-full min-h-0 flex-col">
        <MessagesSubheader
          hostOrigin={hostOrigin}
          onBack={backToList}
          backLabel={t("widget.backToMessages")}
          closeLabel={t("widget.close")}
        />

        <div
          ref={logRef}
          onScroll={() => {
            const node = logRef.current;
            if (!node) return;
            pinnedToBottom.current =
              node.scrollHeight - node.scrollTop - node.clientHeight < 48;
          }}
          role="log"
          aria-label="Conversation messages"
          aria-live="polite"
          aria-relevant="additions text"
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-1 py-2"
        >
          {thread ? (
            <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {thread.subject}
            </p>
          ) : null}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`widget-message-in max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                message.author === "customer"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              {message.body ? (
                message.fromJuno ? (
                  // Juno writes Markdown. Render bold, lists and links instead
                  // of leaking ** and <tags> into a plain paragraph.
                  <Markdown
                    skipHtml
                    className="message-markdown text-sm"
                  >
                    {message.body}
                  </Markdown>
                ) : (
                  <p className="whitespace-pre-wrap break-words">
                    {message.body}
                  </p>
                )
              ) : null}
              {message.attachments && message.attachments.length > 0 ? (
                <ul className="mt-2 space-y-1 border-t border-current/15 pt-1.5">
                  {message.attachments.map((attachment) => (
                    <li key={attachment.id}>
                      {attachment.isImage ? (
                        <a
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="block"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={attachment.url}
                            alt={attachment.fileName}
                            className="max-h-48 w-auto max-w-full rounded-lg border border-current/15"
                          />
                        </a>
                      ) : null}
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-[11px] underline"
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

          {junoPending ? (
            <div
              role="status"
              aria-label={t("widget.junoTyping")}
              className="widget-message-in flex max-w-[85%] items-center gap-2.5 rounded-2xl bg-muted px-3 py-2.5"
            >
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[9px] font-bold text-foreground"
              >
                J
              </span>
              <span
                aria-hidden="true"
                className="text-[11px] font-medium text-muted-foreground"
              >
                Juno
              </span>
              <span aria-hidden="true" className="flex items-center gap-1">
                <span className="widget-typing-dot size-1.5 rounded-full bg-muted-foreground" />
                <span className="widget-typing-dot size-1.5 rounded-full bg-muted-foreground" />
                <span className="widget-typing-dot size-1.5 rounded-full bg-muted-foreground" />
              </span>
            </div>
          ) : null}

          {error ? (
            <p id="widget-message-error" role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        {csat?.canRate &&
          threads.find((thread) => thread.id === id)?.status === "resolved" && (
            <div className="space-y-2 border-t bg-muted/30 px-1 py-3">
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
          <p className="border-t bg-muted/20 px-1 py-2 text-xs text-muted-foreground">
            Thanks for rating this conversation {csat.rating}/5.
          </p>
        )}

        {feedbackCard && (
          <div className="space-y-2 border-t bg-muted/30 px-1 py-3">
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

        <div className="shrink-0 border-t border-border/60 px-1 py-3">
          <div className="rounded-[20px] border border-border/80 bg-card p-2.5 shadow-sm">
            {renderImagePreview()}
            <textarea
              aria-label="Write a reply"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "widget-message-error" : undefined}
              className="min-h-12 w-full resize-none bg-transparent p-0 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
              placeholder="Write a reply…"
              rows={2}
              maxLength={4000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void reply();
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                aria-label={t("widget.attachImage")}
                title={t("widget.attachImage")}
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
              >
                <Paperclip className="size-4" strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={t("widget.send")}
                disabled={busy || !canSend}
                onClick={() => void reply()}
                className={cn(
                  "flex size-9 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  canSend && !busy
                    ? "bg-foreground text-background hover:opacity-90"
                    : "bg-muted text-muted-foreground/55",
                )}
              >
                <ArrowUp className="size-4" strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (initial.state === "not_found") {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {t("widget.messagesUnavailable")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) chooseImage(file);
          event.target.value = "";
        }}
      />
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {state.phase === "list"
        ? renderList()
        : state.phase === "compose"
          ? renderCompose()
          : renderThread(state.id)}
    </div>
  );
}
