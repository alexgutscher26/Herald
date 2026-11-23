"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { DualTimestamp } from "@/components/shared/dual-timestamp";
import { ListDensityToggle } from "@/components/shared/list-density-toggle";
import {
  usePageShortcuts,
  type KeyboardShortcut,
} from "@/components/shared/keyboard-shortcuts";
import { BellRing, Inbox, Search } from "lucide-react";
import { toast } from "sonner";

import { toastActionFailure } from "@/components/shared/action-toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useAnnounce } from "@/features/accessibility/live-announcer";
import { useDensity } from "@/lib/list-preferences";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  bulkAssignConversationsAction,
  bulkSetConversationStatusAction,
  bulkSnoozeConversationsAction,
  bulkTagConversationsAction,
  markConversationNotSpamAction,
  markConversationNotificationsReadAction,
} from "./actions";
import { conversationStatusLabel } from "./commands";
import {
  CONVERSATION_VIEWS,
  inboxHref,
  type ConversationView,
  type InboxFilters,
} from "./filters";
import { ConversationLive } from "./conversation-live";
import type {
  AssignableMember,
  ConversationListItem,
  DueReminder,
  InboxCounts,
  OperatorConversationNotification,
  ConversationTagOption,
} from "./queries";

type BulkStatus = "resolved" | "open" | "spam" | "archived";

const VIEW_LABELS: Record<ConversationView, string> = {
  queue: "Queue",
  open: "Open",
  all: "All",
  snoozed: "Snoozed",
  resolved: "Resolved",
  spam: "Spam",
  archived: "Archived",
};

function slaLabel(sla: { remainingMinutes: number; breached: boolean }): string {
  if (sla.breached) return "SLA breached";
  if (sla.remainingMinutes >= 60) {
    return `${Math.ceil(sla.remainingMinutes / 60)}h left`;
  }
  return `${Math.max(1, sla.remainingMinutes)}m left`;
}

const INBOX_SHORTCUTS: KeyboardShortcut[] = [
  { keys: "j / ↓", action: "Focus the next conversation" },
  { keys: "k / ↑", action: "Focus the previous conversation" },
  { keys: "/", action: "Focus the search field" },
];

/**
 * Operator inbox.
 *
 * Filters live in the URL, so a tab, a search and an assignment filter are all
 * shareable and survive a refresh. Bulk actions take the selected ids and run
 * through the same server action as the thread header.
 */
export function ConversationsView({
  workspaceSlug,
  productSlug,
  filters,
  items,
  counts,
  reminders,
  notifications,
  members,
  tags,
  workspaceTimezone,
  currentUserId,
}: {
  workspaceSlug: string;
  productSlug: string;
  filters: InboxFilters;
  items: ConversationListItem[];
  counts: InboxCounts;
  reminders: DueReminder[];
  notifications: OperatorConversationNotification[];
  members: AssignableMember[];
  tags: ConversationTagOption[];
  workspaceTimezone: string;
  currentUserId: string;
}) {
  const router = useRouter();
  const announce = useAnnounce();
  usePageShortcuts(INBOX_SHORTCUTS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const knownThreadIds = useRef<Set<string> | null>(null);
  const knownUnread = useRef<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [density] = useDensity("inbox");
  const [bulkAssignee, setBulkAssignee] = useState("unassigned");
  const [bulkTag, setBulkTag] = useState("");
  const [bulkMinutes, setBulkMinutes] = useState("1440");

  useEffect(() => {
    const unreadTotal = items.reduce((total, item) => total + item.unreadForTeam, 0);
    const ids = new Set(items.map((item) => item.id));

    if (knownThreadIds.current === null) {
      knownThreadIds.current = ids;
      knownUnread.current = unreadTotal;
      return;
    }

    const newThreads = items.filter((item) => !knownThreadIds.current?.has(item.id));
    if (newThreads.length > 0) {
      announce(
        `${newThreads.length} new conversation${
          newThreads.length === 1 ? "" : "s"
        } in the inbox. ${unreadTotal} unread message${
          unreadTotal === 1 ? "" : "s"
        } from customers.`,
      );
    } else if (unreadTotal > (knownUnread.current ?? 0)) {
      announce(
        `${unreadTotal} unread message${
          unreadTotal === 1 ? "" : "s"
        } from customers in the inbox.`,
      );
    }

    knownThreadIds.current = ids;
    knownUnread.current = unreadTotal;
  }, [announce, items]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        document.getElementById("conversation-search")?.focus();
        return;
      }

      const forward = event.key === "j" || event.key === "ArrowDown";
      const backward = event.key === "k" || event.key === "ArrowUp";
      if (!forward && !backward) return;

      const rows = Array.from(
        document.querySelectorAll<HTMLElement>("[data-conversation-row] a[href]"),
      );
      if (rows.length === 0) return;
      const current = rows.indexOf(document.activeElement as HTMLElement);
      // Arrow keys keep their normal scroll behaviour until a row has focus.
      if (current === -1 && (event.key === "ArrowDown" || event.key === "ArrowUp")) return;

      event.preventDefault();
      const delta = forward ? 1 : -1;
      const nextIndex = current === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, current + delta));
      rows[nextIndex]?.focus();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const base = `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/conversations`;

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function markNotificationsRead() {
    startTransition(async () => {
      const result = await markConversationNotificationsReadAction({
        workspaceSlug,
        productSlug,
      });
      if (!result.ok) {
        announce(result.error, "assertive");
        toastActionFailure(result);
        return;
      }
      announce("All conversation notifications marked read.");
      router.refresh();
    });
  }

  function runBulk(status: BulkStatus) {
    if (selected.size === 0) return;
    startTransition(async () => {
      const result = await bulkSetConversationStatusAction({
        workspaceSlug,
        productSlug,
        conversationIds: [...selected],
        status,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      toast.success(
        `${result.data.updated} conversation${result.data.updated === 1 ? "" : "s"} updated.`,
      );
      setSelected(new Set());
      router.refresh();
    });
  }

  function runBulkAssign() {
    if (selected.size === 0) return;
    startTransition(async () => {
      const result = await bulkAssignConversationsAction({
        workspaceSlug,
        productSlug,
        conversationIds: [...selected],
        assigneeId: bulkAssignee === "unassigned" ? null : bulkAssignee,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      toast.success(`${result.data.updated} conversation${result.data.updated === 1 ? "" : "s"} assigned.`);
      setSelected(new Set());
      router.refresh();
    });
  }

  function runBulkTag() {
    if (selected.size === 0 || bulkTag.trim() === "") return;
    startTransition(async () => {
      const result = await bulkTagConversationsAction({
        workspaceSlug,
        productSlug,
        conversationIds: [...selected],
        tagName: bulkTag,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      toast.success(`Tagged ${result.data.updated} conversation${result.data.updated === 1 ? "" : "s"} with “${result.data.tagName}”.`);
      setBulkTag("");
      setSelected(new Set());
      router.refresh();
    });
  }

  function runBulkSnooze() {
    if (selected.size === 0) return;
    startTransition(async () => {
      const result = await bulkSnoozeConversationsAction({
        workspaceSlug,
        productSlug,
        conversationIds: [...selected],
        minutes: Number(bulkMinutes),
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      toast.success(`${result.data.updated} conversation${result.data.updated === 1 ? "" : "s"} snoozed.`);
      setSelected(new Set());
      router.refresh();
    });
  }

  function releaseSpam(conversationId: string) {
    startTransition(async () => {
      const result = await markConversationNotSpamAction({
        workspaceSlug,
        productSlug,
        conversationId,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <ConversationLive
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        currentUserId={currentUserId}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="[font-family:var(--font-archivo)] text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground">Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Customer conversations from the widget and support email. Internal notes stay
            inside the team.
          </p>
          <Link
            href={`/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
              productSlug,
            )}/conversations/answers`}
            className="mt-2 inline-flex text-xs font-medium text-primary hover:underline"
          >
            Answer inspection →
          </Link>
          <Link
            href={`/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
              productSlug,
            )}/conversations/spam-rules`}
            className="mt-2 ml-3 inline-flex text-xs font-medium text-primary hover:underline"
          >
            Spam rules →
          </Link>
        </div>
        <form action={base} method="get" className="flex w-full gap-2 sm:w-auto">
          {filters.view !== "queue" ? (
            <input type="hidden" name="view" value={filters.view} />
          ) : null}
          {filters.assignee !== "any" ? (
            <input type="hidden" name="assignee" value={filters.assignee} />
          ) : null}
          {filters.tag ? <input type="hidden" name="tag" value={filters.tag} /> : null}
          <div className="relative flex-1 sm:w-72">
            <Search
              className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="conversation-search"
              name="q"
              defaultValue={filters.query}
              placeholder="Search subject, customer or message"
              aria-label="Search conversations"
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      {notifications.length > 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-start gap-3 p-4">
            <BellRing className="mt-0.5 size-4 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">
                  New since you last looked
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={markNotificationsRead}
                >
                  Mark all read
                </Button>
              </div>
              <ul className="space-y-1 text-sm">
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    <Link
                      href={`${base}/${notification.conversationId}`}
                      className="text-primary hover:underline"
                    >
                      {notification.title}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">
                      {notification.body} ·{" "}
                      <DualTimestamp iso={notification.createdAt} timeZone={workspaceTimezone} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {reminders.length > 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-start gap-3 p-4">
            <BellRing className="mt-0.5 size-4 text-warning" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-sm font-medium text-foreground">
                Your reminders are due
              </p>
              <ul className="space-y-1 text-sm">
                {reminders.map((reminder) => (
                  <li key={reminder.id}>
                    <Link
                      href={`${base}/${reminder.conversationId}`}
                      className="text-primary hover:underline"
                    >
                      {reminder.subject}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">
                      due <DualTimestamp iso={reminder.remindAt} timeZone={workspaceTimezone} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center gap-1 overflow-x-auto border-b [scrollbar-width:none]">
        {CONVERSATION_VIEWS.map((view) => {
          const active = filters.view === view;
          return (
            <Link
              key={view}
              href={inboxHref(base, filters, { view })}
              aria-current={active ? "page" : undefined}
              className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm ${
                active
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {VIEW_LABELS[view]}
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums">
                {counts[view]}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted-foreground" htmlFor="assignee-filter">
          Assignment
        </label>
        <Select
          value={filters.assignee}
          onValueChange={(value) => {
            const assignee =
              value === "me" ? "me" : value === "unassigned" ? "unassigned" : "any";
            router.push(inboxHref(base, filters, { assignee }));
          }}
        >
          <SelectTrigger id="assignee-filter" className="h-8 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Anyone</SelectItem>
            <SelectItem value="me">Assigned to me</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
          </SelectContent>
        </Select>
        <label className="text-sm text-muted-foreground" htmlFor="tag-filter">
          Tag
        </label>
        <Select
          value={filters.tag || "any"}
          onValueChange={(value) =>
            router.push(inboxHref(base, filters, { tag: value === "any" ? "" : value }))
          }
        >
          <SelectTrigger id="tag-filter" className="h-8 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any tag</SelectItem>
            {tags.map((tag) => (
              <SelectItem key={tag.name} value={tag.name}>
                {tag.name} ({tag.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {items.length} shown
          {members.length > 0 ? ` · ${members.length} team members` : ""}
        </span>
        <ListDensityToggle surface="inbox" label="Inbox" />
      </div>

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium text-foreground">
            {selected.size} selected
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => runBulk("resolved")}
          >
            Resolve
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => runBulk("open")}
          >
            Reopen
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => runBulk("spam")}
          >
            Spam
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => runBulk("archived")}
          >
            Archive
          </Button>
          <Select value={bulkAssignee} onValueChange={setBulkAssignee}>
            <SelectTrigger className="h-8 w-40">
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
            disabled={pending}
            onClick={runBulkAssign}
          >
            Assign
          </Button>
          <Input
            value={bulkTag}
            onChange={(event) => setBulkTag(event.target.value)}
            placeholder="Tag name"
            aria-label="Bulk tag name"
            className="h-8 w-32"
            maxLength={32}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || bulkTag.trim() === ""}
            onClick={runBulkTag}
          >
            Tag
          </Button>
          <Select value={bulkMinutes} onValueChange={setBulkMinutes}>
            <SelectTrigger className="h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="60">1 hour</SelectItem>
              <SelectItem value="240">4 hours</SelectItem>
              <SelectItem value="1440">1 day</SelectItem>
              <SelectItem value="4320">3 days</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={runBulkSnooze}
          >
            Snooze
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <Inbox className="size-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">
                Nothing in {VIEW_LABELS[filters.view].toLowerCase()}
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {filters.query
                  ? `No conversation matches “${filters.query}”.`
                  : "New customer threads appear here as soon as they arrive."}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((item) => (
                <li
                  key={item.id}
                  data-conversation-row
                  className={`flex items-start gap-3 px-4 ${
                    density === "compact" ? "py-1.5" : "py-3"
                  }`}
                >
                  <Checkbox
                    checked={selected.has(item.id)}
                    onCheckedChange={(value) => toggle(item.id, value === true)}
                    aria-label={`Select ${item.subject}`}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`${base}/${item.id}`}
                        className="truncate font-medium text-foreground hover:underline"
                      >
                        {item.subject}
                      </Link>
                      {item.unreadForTeam > 0 ? (
                        <Badge variant="secondary">
                          {item.unreadForTeam} unread
                        </Badge>
                      ) : null}
                      <Badge variant="outline">
                        {conversationStatusLabel(item.status)}
                      </Badge>
                      {item.status === "snoozed" && item.snoozedUntil ? (
                        <span className="text-xs text-muted-foreground">
                          until <DualTimestamp iso={item.snoozedUntil} timeZone={workspaceTimezone} />
                        </span>
                      ) : null}
                      {item.sla ? (
                        <Badge variant={item.sla.breached ? "destructive" : "outline"}>
                          {slaLabel(item.sla)}
                        </Badge>
                      ) : null}
                      {filters.view === "spam" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          disabled={pending}
                          onClick={() => releaseSpam(item.id)}
                        >
                          Not spam
                        </Button>
                      ) : null}
                    </div>
                    {density === "compact" ? null : (
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {item.lastMessagePreview || "No messages yet."}
                      </p>
                    )}
                    <p
                      className={`truncate text-xs text-muted-foreground ${
                        density === "compact" ? "mt-0.5" : "mt-1"
                      }`}
                    >
                      {item.customer.name}
                      {item.customer.email ? ` · ${item.customer.email}` : ""}
                      {item.assigneeName ? ` · ${item.assigneeName}` : " · Unassigned"}
                      {" · "}
                      <DualTimestamp iso={item.lastMessageAt} timeZone={workspaceTimezone} />
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
