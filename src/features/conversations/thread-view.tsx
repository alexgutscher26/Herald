"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowLeft,
  BellRing,
  Building2,
  Download,
  Paperclip,
  ShieldBan,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { toastActionFailure } from "@/components/shared/action-toast";
import { useAnnounce } from "@/features/accessibility/live-announcer";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DualTimestamp } from "@/components/shared/dual-timestamp";
import { Markdown } from "@/components/shared/markdown";
import {
  usePageShortcuts,
  type KeyboardShortcut,
} from "@/components/shared/keyboard-shortcuts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { handToJunoAction } from "@/features/juno/actions";
import { publicChangelogEntryPath, publicRequestPath } from "@/features/public/paths";

import {
  applyConversationMacroAction,
  addConversationTagAction,
  assignConversationAction,
  assignNextConversationAction,
  blockConversationSenderAction,
  completeConversationReminderAction,
  createRequestFromConversationAction,
  linkConversationMessageToRequestAction,
  linkConversationCompanyAction,
  mergeConversationAction,
  removeConversationTagAction,
  replyConversationAction,
  saveConversationDraftAction,
  setConversationReminderAction,
  setConversationStatusAction,
  snoozeConversationAction,
} from "./actions";
import { conversationStatusLabel } from "./commands";
import { ConversationLive, type OnlineOperator } from "./conversation-live";
import type { ConversationMacroRow } from "./macro-rules";
import type {
  AssignableMember,
  ConversationThread,
  MergeCandidate,
} from "./queries";

function slaLabel(sla: { remainingMinutes: number; breached: boolean }): string {
  if (sla.breached) return "SLA breached";
  if (sla.remainingMinutes >= 60) {
    return `SLA: ${Math.ceil(sla.remainingMinutes / 60)}h left`;
  }
  return `SLA: ${Math.max(1, sla.remainingMinutes)}m left`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SNOOZE_OPTIONS = [
  { label: "1 hour", minutes: 60 },
  { label: "4 hours", minutes: 240 },
  { label: "1 day", minutes: 1440 },
  { label: "3 days", minutes: 4320 },
] as const;

const THREAD_SHORTCUTS: KeyboardShortcut[] = [
  { keys: "r", action: "Focus the reply box" },
  { keys: "Esc", action: "Leave the reply box" },
];

/**
 * One conversation.
 *
 * The composer applies slash commands on the server (`/resolve`, `/reopen`,
 * `/snooze 2h`, `/note ...`), so the rule is identical whether the team uses
 * the box or a future API. Everything here is a write through a server action;
 * `canWrite` only hides controls, it is not the authorization boundary.
 */
export function ThreadView({
  workspaceSlug,
  productSlug,
  thread,
  members,
  boards,
  requests,
  canWrite,
  workspaceTimezone,
  currentUserId,
  online,
  macros,
  mergeCandidates,
}: {
  workspaceSlug: string;
  productSlug: string;
  thread: ConversationThread;
  members: AssignableMember[];
  boards: { id: string; name: string }[];
  requests: { id: string; title: string }[];
  canWrite: boolean;
  workspaceTimezone: string;
  currentUserId: string;
  online: OnlineOperator[];
  macros: ConversationMacroRow[];
  mergeCandidates: MergeCandidate[];
}) {
  const router = useRouter();
  const announce = useAnnounce();
  usePageShortcuts(THREAD_SHORTCUTS);
  const [handoffBoardId, setHandoffBoardId] = useState(boards[0]?.id ?? "");
  const customerMessages = thread.messages.filter(
    (message) => message.kind === "message" && message.authorType === "customer",
  );
  const [linkPostId, setLinkPostId] = useState(requests[0]?.id ?? "");
  const [linkMessageId, setLinkMessageId] = useState(
    customerMessages[customerMessages.length - 1]?.id ?? "",
  );
  const [body, setBody] = useState(thread.draft);
  const savedBody = useRef(thread.draft);
  const [snoozeMinutes, setSnoozeMinutes] = useState<string>("60");
  const [reminderAt, setReminderAt] = useState("");
  const [pending, startTransition] = useTransition();
  const typingSentAt = useRef(0);
  const [pendingAttachments, setPendingAttachments] = useState<
    Array<{
      id: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      kind: "image" | "file";
      url: string;
    }>
  >([]);
  const [uploading, setUploading] = useState(false);
  const [macroId, setMacroId] = useState("");
  const [tagName, setTagName] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (event.key === "r" && !typing) {
        const reply = document.getElementById("conversation-reply");
        if (reply) {
          event.preventDefault();
          reply.focus();
          reply.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }

      if (event.key === "Escape" && target instanceof HTMLElement && target.id === "conversation-reply") {
        target.blur();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Draft persistence is per operator and per thread. Debounced so a long
  // reply does not cost one server action per keystroke.
  useEffect(() => {
    if (!canWrite || body === savedBody.current) return;
    const timer = window.setTimeout(() => {
      void saveConversationDraftAction({
        workspaceSlug,
        productSlug,
        conversationId: thread.conversation.id,
        body,
      }).then((result) => {
        if (result.ok) savedBody.current = body;
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [body, canWrite, productSlug, thread.conversation.id, workspaceSlug]);

  function handBackToJuno() {
    run(
      () =>
        handToJunoAction({
          workspaceSlug,
          productSlug,
          conversationId: thread.conversation.id,
        }),
      "Handed back to Juno.",
    );
  }

  const base = `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/conversations`;
  const activeReminder = thread.reminders.find(
    (reminder) => reminder.completedAt === null,
  );

  function run(
    operation: () => Promise<{ ok: true } | { ok: false; error: string }>,
    success: string,
    onSuccess?: () => void,
  ) {
    startTransition(async () => {
      const result = await operation();
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      announce(success);
      onSuccess?.();
      router.refresh();
    });
  }

  function send() {
    run(
      () =>
        replyConversationAction({
          workspaceSlug,
          productSlug,
          conversationId: thread.conversation.id,
          body,
          attachmentIds: pendingAttachments.map((attachment) => attachment.id),
        }),
      "Reply saved.",
      () => {
        savedBody.current = "";
        setBody("");
        setPendingAttachments([]);
        typingSentAt.current = 0;
      },
    );
  }

  async function uploadAttachment(file: File) {
    if (pendingAttachments.length >= 5) {
      toast.error("Attach at most 5 files to one message.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(
        `/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
          productSlug,
        )}/conversations/${encodeURIComponent(
          thread.conversation.id,
        )}/attachments`,
        { method: "POST", body: form },
      );
      const data = (await response.json().catch(() => null)) as
        | {
            id?: string;
            filename?: string;
            mimeType?: string;
            sizeBytes?: number;
            kind?: "image" | "file";
            url?: string;
            error?: string;
          }
        | null;
      if (
        !response.ok ||
        !data?.id ||
        !data.filename ||
        !data.mimeType ||
        !data.sizeBytes ||
        !data.kind ||
        !data.url
      ) {
        toast.error(data?.error ?? "Could not upload that file.");
        return;
      }
      setPendingAttachments((current) => [
        ...current,
        {
          id: data.id!,
          filename: data.filename!,
          mimeType: data.mimeType!,
          sizeBytes: data.sizeBytes!,
          kind: data.kind!,
          url: data.url!,
        },
      ]);
    } catch {
      toast.error("Could not upload that file.");
    } finally {
      setUploading(false);
    }
  }

  function changeBody(value: string) {
    setBody(value);
    if (!canWrite || value.trim() === "") return;
    const now = Date.now();
    // Typing is a hint, not a write: one signal every two seconds is enough,
    // and a failure must never interrupt the reply. It expires after 4 s.
    if (now - typingSentAt.current < 2_000) return;
    typingSentAt.current = now;
    void fetch(
      `/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
        productSlug,
      )}/conversations/${encodeURIComponent(thread.conversation.id)}/typing`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typing: true }),
      },
    ).catch(() => {});
  }

  function changeStatus(status: "open" | "resolved" | "spam" | "archived") {
    run(
      () =>
        setConversationStatusAction({
          workspaceSlug,
          productSlug,
          conversationId: thread.conversation.id,
          status,
        }),
      `Conversation ${conversationStatusLabel(status).toLowerCase()}.`,
    );
  }

  function snooze() {
    run(
      () =>
        snoozeConversationAction({
          workspaceSlug,
          productSlug,
          conversationId: thread.conversation.id,
          minutes: Number(snoozeMinutes),
        }),
      "Conversation snoozed.",
    );
  }

  function assign(value: string) {
    run(
      () =>
        assignConversationAction({
          workspaceSlug,
          productSlug,
          conversationId: thread.conversation.id,
          assigneeId: value === "unassigned" ? null : value,
        }),
      "Assignment updated.",
    );
  }

  function assignNext() {
    startTransition(async () => {
      const result = await assignNextConversationAction({
        workspaceSlug,
        productSlug,
        conversationId: thread.conversation.id,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      announce(`Assigned to ${result.data.assigneeName}.`);
      router.refresh();
    });
  }

  function applyMacro() {
    if (!macroId) return;
    startTransition(async () => {
      const result = await applyConversationMacroAction({
        workspaceSlug,
        productSlug,
        conversationId: thread.conversation.id,
        macroId,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      announce(result.data.replied ? "Macro applied and reply sent." : "Macro applied.");
      setMacroId("");
      router.refresh();
    });
  }

  function saveReminder() {
    if (reminderAt === "") {
      toast.error("Choose a reminder time.");
      return;
    }
    run(
      () =>
        setConversationReminderAction({
          workspaceSlug,
          productSlug,
          conversationId: thread.conversation.id,
          remindAt: new Date(reminderAt).toISOString(),
        }),
      "Reminder saved. Only you will see it.",
    );
  }

  function clearReminder() {
    if (!activeReminder) return;
    run(
      () =>
        completeConversationReminderAction({
          workspaceSlug,
          productSlug,
          reminderId: activeReminder.id,
        }),
      "Reminder cleared.",
    );
  }

  function addTag() {
    if (tagName.trim() === "") return;
    run(
      () =>
        addConversationTagAction({
          workspaceSlug,
          productSlug,
          conversationId: thread.conversation.id,
          tagName,
        }),
      "Tag added.",
      () => setTagName(""),
    );
  }

  function removeTag(tagId: string) {
    run(
      () =>
        removeConversationTagAction({
          workspaceSlug,
          productSlug,
          conversationId: thread.conversation.id,
          tagId,
        }),
      "Tag removed.",
    );
  }

  function linkCompany() {
    run(
      () =>
        linkConversationCompanyAction({
          workspaceSlug,
          productSlug,
          conversationId: thread.conversation.id,
        }),
      "Company linked.",
    );
  }

  function mergeInto() {
    if (!mergeTargetId) return;
    run(
      () =>
        mergeConversationAction({
          workspaceSlug,
          productSlug,
          conversationId: thread.conversation.id,
          targetConversationId: mergeTargetId,
        }),
      "Conversation merged.",
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:flex-wrap">
        <div className="min-w-0">
          <Link
            href={base}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to inbox
          </Link>
          <h1 className="mt-1 break-words [font-family:var(--font-archivo)] text-[24px] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:truncate">
            {thread.conversation.subject}
          </h1>
          {thread.tags.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {thread.tags.map((tag) => (
                <Badge key={tag.id} variant="secondary" className="gap-1 pr-1">
                  {tag.name}
                  {canWrite ? (
                    <button
                      type="button"
                      aria-label={`Remove ${tag.name}`}
                      className="rounded p-0.5 hover:bg-background/60"
                      disabled={pending}
                      onClick={() => removeTag(tag.id)}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  ) : null}
                </Badge>
              ))}
            </div>
          ) : null}
          {canWrite ? (
            <div className="mt-2 flex max-w-sm gap-2">
              <Input
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
                placeholder="Add a tag"
                aria-label="New conversation tag"
                maxLength={32}
                className="h-8"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addTag();
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || tagName.trim() === ""}
                onClick={addTag}
              >
                Add
              </Button>
            </div>
          ) : null}
          <p className="mt-1 text-sm text-muted-foreground">
            {thread.customer.name}
            {thread.customer.email ? ` · ${thread.customer.email}` : ""}
            {" · started "}
            <DualTimestamp iso={thread.conversation.createdAt} timeZone={workspaceTimezone} />
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {thread.conversation.sla ? (
            <Badge
              variant={thread.conversation.sla.breached ? "destructive" : "outline"}
            >
              {slaLabel(thread.conversation.sla)}
            </Badge>
          ) : null}
          <Badge
            variant={
              !thread.customer.email
                ? "outline"
                : thread.customer.verifiedAt
                  ? "secondary"
                  : "outline"
            }
          >
            {!thread.customer.email
              ? "Guest"
              : thread.customer.verifiedAt
                ? "Verified email"
                : "Unverified email"}
          </Badge>
          <Badge variant="outline">
            {conversationStatusLabel(thread.conversation.status)}
          </Badge>
          <Button asChild size="sm" variant="outline">
            <a
              href={`${base}/${thread.conversation.id}/export`}
              download
            >
              <Download aria-hidden="true" />
              <span className="hidden sm:inline">Export .md</span>
            </a>
          </Button>
        </div>
      </div>

      <ConversationLive
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        conversationId={thread.conversation.id}
        currentUserId={currentUserId}
        initialOnline={online}
        showPresence
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardContent className="space-y-4 p-4">
            <div
              role="log"
              aria-label="Conversation messages"
              aria-live="polite"
              aria-relevant="additions text"
              className="space-y-3"
            >
              {thread.messages.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No messages yet.
                </p>
              ) : (
                thread.messages.map((message) => (
                  <article
                    key={message.id}
                    className={`min-w-0 rounded-md border px-3 py-2 ${
                      message.kind === "note"
                        ? "border-warning/40 bg-warning-muted"
                        : "bg-background"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {message.authorName}
                      </span>
                      <Badge variant={message.kind === "note" ? "secondary" : "outline"}>
                        {message.kind === "note"
                          ? "Internal note"
                          : message.authorType === "customer"
                            ? "Customer"
                            : message.authorType === "juno"
                              ? "Juno"
                              : "Team"}
                      </Badge>
                      <DualTimestamp iso={message.createdAt} timeZone={workspaceTimezone} />
                    </div>
                    {message.authorType === "juno" ? (
                      <Markdown
                        skipHtml
                        className="message-markdown mt-1.5 text-sm text-foreground"
                      >
                        {message.body}
                      </Markdown>
                    ) : (
                      <p className="mt-1.5 break-words text-sm whitespace-pre-wrap text-foreground">
                        {message.body}
                      </p>
                    )}
                    {message.citations && message.citations.length > 0 ? (
                      <div className="mt-2 border-t pt-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          Sources
                        </p>
                        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                          {message.citations.map((citation) => (
                            <li key={`${citation.sourceName}:${citation.title}:${citation.url ?? ""}`}>
                              {citation.url ? (
                                <a
                                  href={citation.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary hover:underline"
                                >
                                  {citation.title}
                                </a>
                              ) : (
                                citation.title
                              )}{" "}
                              <span>· {citation.sourceName}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>

            {thread.attachments.length > 0 ? (
              <div className="space-y-1 border-t pt-3">
                <p className="text-xs font-medium text-foreground">Attachments</p>
                <ul className="space-y-1 text-sm">
                  {thread.attachments.map((attachment) => (
                    <li key={attachment.id} className="text-muted-foreground">
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <Paperclip className="size-3" aria-hidden="true" />
                        {attachment.filename}
                      </a>{" "}
                      <span className="text-xs">
                        ({attachment.mimeType}, {formatSize(attachment.sizeBytes)})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div id="conversation-composer" className="scroll-mt-24 space-y-2 border-t pt-3">
              <Label htmlFor="conversation-reply">Reply</Label>
              <Textarea
                id="conversation-reply"
                value={body}
                onChange={(event) => changeBody(event.target.value)}
                rows={4}
                maxLength={10_000}
                disabled={!canWrite || pending}
                placeholder="Write a reply, or use /note, /resolve, /reopen or /snooze 2h."
              />
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/50">
                  <Paperclip className="size-3.5" aria-hidden="true" />
                  {uploading ? "Uploading…" : "Attach file"}
                  <input
                    type="file"
                    className="sr-only"
                    accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt"
                    disabled={!canWrite || pending || uploading}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void uploadAttachment(file);
                    }}
                  />
                </label>
                <span className="text-[11px] text-muted-foreground">
                  PNG, JPEG, WebP, GIF, PDF or text · 10 MB
                </span>
              </div>
              {pendingAttachments.length > 0 ? (
                <ul className="space-y-1" aria-live="polite">
                  {pendingAttachments.map((attachment) => (
                    <li
                      key={attachment.id}
                      className="flex items-center justify-between gap-2 rounded border bg-muted/30 px-2 py-1 text-xs"
                    >
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <Paperclip className="size-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">{attachment.filename}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {formatSize(attachment.sizeBytes)}
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${attachment.filename}`}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                        onClick={() =>
                          setPendingAttachments((current) =>
                            current.filter((item) => item.id !== attachment.id),
                          )
                        }
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Slash commands: <code>/note</code>, <code>/resolve</code>,{" "}
                  <code>/reopen</code>, <code>/snooze 2h</code>.
                </p>
                <Button
                  type="button"
                  onClick={send}
                  disabled={
                    !canWrite ||
                    pending ||
                    uploading ||
                    (body.trim() === "" && pendingAttachments.length === 0)
                  }
                >
                  {pending ? "Sending…" : "Send reply"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-sm font-semibold text-foreground">Actions</p>

              <div className="space-y-1.5">
                <Label htmlFor="conversation-assignee">Assignee</Label>
                <Select
                  value={thread.assigneeId ?? "unassigned"}
                  onValueChange={assign}
                  disabled={!canWrite || pending || members.length === 0}
                >
                  <SelectTrigger id="conversation-assignee">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canWrite || pending || members.length === 0}
                  onClick={assignNext}
                >
                  Assign least-loaded
                </Button>
              </div>

              {macros.length > 0 ? (
                <div className="space-y-1.5 border-t border-border/70 pt-3">
                  <Label htmlFor="conversation-macro">Macro</Label>
                  <Select
                    value={macroId}
                    onValueChange={setMacroId}
                    disabled={!canWrite || pending}
                  >
                    <SelectTrigger id="conversation-macro">
                      <SelectValue placeholder="Choose a macro" />
                    </SelectTrigger>
                    <SelectContent>
                      {macros.map((macro) => (
                        <SelectItem key={macro.id} value={macro.id}>
                          {macro.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!canWrite || pending || macroId === ""}
                    onClick={applyMacro}
                  >
                    Apply macro
                  </Button>
                </div>
              ) : null}

              {mergeCandidates.length > 0 ? (
                <div className="space-y-1.5 border-t border-border/70 pt-3">
                  <Label htmlFor="conversation-merge">Merge a duplicate</Label>
                  <Select
                    value={mergeTargetId}
                    onValueChange={setMergeTargetId}
                    disabled={!canWrite || pending}
                  >
                    <SelectTrigger id="conversation-merge">
                      <SelectValue placeholder="Choose a conversation" />
                    </SelectTrigger>
                    <SelectContent>
                      {mergeCandidates.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {candidate.subject}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ConfirmDialog
                    trigger={
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!canWrite || pending || !mergeTargetId}
                      >
                        Merge into selected
                      </Button>
                    }
                    title="Merge this conversation?"
                    description="Messages and tags move to the selected conversation for the same customer, and this thread is archived. The target keeps its subject and assignee."
                    confirmLabel="Merge"
                    onConfirm={mergeInto}
                  />
                  <p className="text-xs text-muted-foreground">
                    Only threads for the same customer are listed.
                  </p>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {thread.conversation.status !== "resolved" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canWrite || pending}
                    onClick={() => changeStatus("resolved")}
                  >
                    Resolve
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!canWrite || pending}
                    onClick={() => changeStatus("open")}
                  >
                    Reopen
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canWrite || pending}
                  onClick={() => changeStatus("archived")}
                >
                  Archive
                </Button>
              </div>

              <div className="space-y-1.5 border-t pt-3">
                <Label htmlFor="conversation-snooze">Snooze</Label>
                <div className="flex gap-2">
                  <Select value={snoozeMinutes} onValueChange={setSnoozeMinutes}>
                    <SelectTrigger id="conversation-snooze" className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SNOOZE_OPTIONS.map((option) => (
                        <SelectItem key={option.minutes} value={String(option.minutes)}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!canWrite || pending}
                    onClick={snooze}
                  >
                    Snooze
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  It leaves Queue and Open until the deadline, then returns.
                </p>
              </div>

              <div className="space-y-1.5 border-t pt-3">
                <Label className="flex items-center gap-1.5" htmlFor="conversation-reminder">
                  <BellRing className="size-3.5" aria-hidden="true" />
                  Personal reminder
                </Label>
                <Input
                  id="conversation-reminder"
                  type="datetime-local"
                  value={reminderAt}
                  onChange={(event) => setReminderAt(event.target.value)}
                  disabled={!canWrite || pending}
                />
                {activeReminder ? (
                  <p className="text-xs text-muted-foreground">
                    Set for <DualTimestamp iso={activeReminder.remindAt} timeZone={workspaceTimezone} />. Only you see it.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Surfaces only for you when it is due.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={saveReminder}
                    disabled={!canWrite || pending}
                  >
                    Save reminder
                  </Button>
                  {activeReminder ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={clearReminder}
                      disabled={!canWrite || pending}
                    >
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-medium text-foreground">Feedback handoff</p>
                {boards.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Create a board first to file the customer&apos;s request.
                  </p>
                ) : (
                  <>
                    <Label htmlFor="conversation-handoff-board">Board</Label>
                    <Select
                      value={handoffBoardId}
                      onValueChange={setHandoffBoardId}
                      disabled={!canWrite || pending}
                    >
                      <SelectTrigger id="conversation-handoff-board" className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {boards.map((board) => (
                          <SelectItem key={board.id} value={board.id}>
                            {board.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <ConfirmDialog
                      trigger={
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!canWrite || pending || handoffBoardId === ""}
                        >
                          Create request
                        </Button>
                      }
                      title="Create a feedback request?"
                      description="The request is filed on the selected board with this customer as the author, using the subject and the customer's first message. An internal note records it in this thread."
                      confirmLabel="Create request"
                      onConfirm={() =>
                        run(
                          () =>
                            createRequestFromConversationAction({
                              workspaceSlug,
                              productSlug,
                              conversationId: thread.conversation.id,
                              boardId: handoffBoardId,
                            }),
                          "Request created.",
                        )
                      }
                    />
                  </>
                )}

                <div className="space-y-2 border-t pt-3">
                  <p className="text-xs font-medium text-foreground">
                    Or link a message to an existing request
                  </p>
                  {requests.length === 0 || customerMessages.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {requests.length === 0
                        ? "There are no open requests in this product yet."
                        : "This thread has no customer message to quote yet."}
                    </p>
                  ) : (
                    <>
                      <Label htmlFor="conversation-link-request">Request</Label>
                      <Select
                        value={linkPostId}
                        onValueChange={setLinkPostId}
                        disabled={!canWrite || pending}
                      >
                        <SelectTrigger id="conversation-link-request" className="h-8">
                          <SelectValue placeholder="Choose a request" />
                        </SelectTrigger>
                        <SelectContent>
                          {requests.map((request) => (
                            <SelectItem key={request.id} value={request.id}>
                              {request.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Label htmlFor="conversation-link-message">Customer message</Label>
                      <Select
                        value={linkMessageId}
                        onValueChange={setLinkMessageId}
                        disabled={!canWrite || pending}
                      >
                        <SelectTrigger id="conversation-link-message" className="h-8">
                          <SelectValue placeholder="Choose a message" />
                        </SelectTrigger>
                        <SelectContent>
                          {customerMessages.map((message) => (
                            <SelectItem key={message.id} value={message.id}>
                              {message.body.replace(/\s+/g, " ").slice(0, 80)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!canWrite || pending || !linkPostId || !linkMessageId}
                        onClick={() =>
                          run(
                            () =>
                              linkConversationMessageToRequestAction({
                                workspaceSlug,
                                productSlug,
                                conversationId: thread.conversation.id,
                                messageId: linkMessageId,
                                postId: linkPostId,
                              }),
                            "Message linked as evidence.",
                          )
                        }
                      >
                        Attach as evidence
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Adds this message to the request&apos;s evidence and counts the customer
                        once. A private note records the link here.
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-medium text-foreground">Spam and abuse</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!canWrite || pending}
                    onClick={() => changeStatus("spam")}
                  >
                    Mark spam
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!canWrite || pending}
                      >
                        <ShieldBan aria-hidden="true" />
                        Block sender
                      </Button>
                    }
                    title="Block this sender?"
                    description="The customer is blocked in this workspace and the conversation moves to Spam. Existing requests are not deleted."
                    confirmLabel="Block sender"
                    onConfirm={() =>
                      run(
                        () =>
                          blockConversationSenderAction({
                            workspaceSlug,
                            productSlug,
                            conversationId: thread.conversation.id,
                          }),
                        "Sender blocked.",
                      )
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-foreground">Juno</p>
                <Badge variant="outline">
                  {!thread.juno
                    ? "Not involved"
                    : thread.juno.state === "active"
                      ? "Active"
                      : thread.juno.state === "resolved"
                        ? "Auto-resolved"
                        : thread.juno.state === "handed_off"
                          ? "Handed off"
                          : "Paused"}
                </Badge>
              </div>
              {thread.juno?.handoffReason ? (
                <p className="text-xs text-muted-foreground">
                  Reason: {thread.juno.handoffReason.replace(/_/g, " ")}. The
                  private note in the thread has the details.
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                A human reply pauses Juno. Handing the thread back lets it pick
                up the next customer message.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canWrite || pending}
                onClick={handBackToJuno}
              >
                Hand to Juno
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 p-4 text-sm">
              <p className="font-semibold text-foreground">Customer</p>
              <p className="text-muted-foreground">
                {thread.customer.name}
                <br />
                {thread.customer.email ?? "No email captured"}
              </p>
              <p className="text-xs text-muted-foreground">
                {thread.customer.activity.posts} requests ·{" "}
                {thread.customer.activity.comments} comments ·{" "}
                {thread.customer.activity.votes} votes
              </p>

              <div className="flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
                <span className="font-medium text-foreground">Company</span>
                {thread.companies.length > 0 ? (
                  thread.companies.map((company) => (
                    <Badge key={company.id} variant="secondary">
                      {company.name}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground">Not linked</span>
                )}
                {canWrite && thread.companies.length === 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={pending}
                    onClick={linkCompany}
                  >
                    <Building2 aria-hidden="true" />
                    Link company
                  </Button>
                ) : null}
              </div>
              {thread.conversation.csat.requested ? (
                <p className="text-xs text-muted-foreground">
                  CSAT:{" "}
                  {thread.conversation.csat.rating === null
                    ? "requested, no rating yet"
                    : `${thread.conversation.csat.rating}/5`}
                </p>
              ) : null}

              {(thread.conversation.sourceUrl ||
                thread.conversation.sourceContext?.referrer) ? (
                <p className="break-all text-xs text-muted-foreground">
                  Started from:{" "}
                  {thread.conversation.sourceUrl ??
                    thread.conversation.sourceContext?.referrer}
                </p>
              ) : null}
              {thread.conversation.sourceContext?.channel === "email" ? (
                <p className="text-xs text-muted-foreground">Started by email</p>
              ) : null}
              {thread.conversation.sourceContext?.locale ? (
                <p className="text-xs text-muted-foreground">
                  Language: {thread.conversation.sourceContext.locale}
                </p>
              ) : null}
              {thread.conversation.sourceContext?.timezone ? (
                <p className="text-xs text-muted-foreground">
                  Timezone: {thread.conversation.sourceContext.timezone}
                </p>
              ) : null}
              {thread.conversation.sourceContext?.userAgent ? (
                <p className="break-all text-xs text-muted-foreground">
                  Browser: {thread.conversation.sourceContext.userAgent.slice(0, 120)}
                </p>
              ) : null}

              {thread.linkedRequests.length > 0 ? (
                <div className="space-y-1 border-t pt-2">
                  <p className="text-xs font-medium text-foreground">
                    Linked requests
                  </p>
                  <ul className="space-y-1 text-xs">
                    {thread.linkedRequests.map((request) => (
                      <li key={request.id}>
                        {request.boardSlug ? (
                          <Link
                            href={publicRequestPath(
                              workspaceSlug,
                              productSlug,
                              request.boardSlug,
                              request.id,
                            )}
                            className="text-primary hover:underline"
                          >
                            {request.title}
                          </Link>
                        ) : (
                          <span>{request.title}</span>
                        )}{" "}
                        <span className="text-muted-foreground">{request.status}</span>
                        {request.release ? (
                          <span className="ml-1 text-muted-foreground">
                            · Shipped in {request.release.title}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {!canWrite ? (
                <p className="text-xs text-muted-foreground">
                  Your role can read conversations but not reply or change state.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4 text-sm">
              <p className="font-semibold text-foreground">Customer timeline</p>

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase">
                  Conversations
                </p>
                {thread.timeline.conversations.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None yet.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {thread.timeline.conversations.slice(0, 6).map((item) => (
                      <li key={item.id} className="flex justify-between gap-2">
                        <Link
                          href={`${base}/${item.id}`}
                          className="truncate text-primary hover:underline"
                        >
                          {item.subject}
                        </Link>
                        <span className="shrink-0 text-muted-foreground">{item.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-1 border-t pt-2">
                <p className="text-xs font-medium text-muted-foreground uppercase">
                  Requests
                </p>
                {thread.timeline.requests.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None yet.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {thread.timeline.requests.slice(0, 6).map((item) => (
                      <li key={item.id} className="flex justify-between gap-2">
                        <span className="truncate">{item.title}</span>
                        <span className="shrink-0 text-muted-foreground">{item.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-1 border-t pt-2">
                <p className="text-xs font-medium text-muted-foreground uppercase">
                  Releases seen
                </p>
                {thread.timeline.releasesSeen.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No signed-in release view recorded.
                  </p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {thread.timeline.releasesSeen.map((release) => (
                      <li key={release.id} className="flex justify-between gap-2">
                        <Link
                          href={publicChangelogEntryPath(
                            workspaceSlug,
                            productSlug,
                            release.slug,
                          )}
                          className="truncate text-primary hover:underline"
                        >
                          {release.title}
                        </Link>
                        <DualTimestamp
                          iso={release.lastViewedAt}
                          timeZone={workspaceTimezone}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-1 border-t pt-2">
                <p className="text-xs font-medium text-muted-foreground uppercase">
                  CSAT history
                </p>
                {thread.timeline.csat.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No ratings yet.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {thread.timeline.csat.map((item) => (
                      <li key={`${item.conversationId}-${item.ratedAt}`} className="flex justify-between gap-2">
                        <span className="truncate">{item.subject}</span>
                        <span className="shrink-0 tabular-nums">
                          {item.rating}/5 ·{" "}
                          <DualTimestamp iso={item.ratedAt} timeZone={workspaceTimezone} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
