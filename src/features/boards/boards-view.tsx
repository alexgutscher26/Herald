"use client";

import {
  Archive,
  ExternalLink,
  LayoutGrid,
  Pencil,
  Plus,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  archiveBoardAction,
  createBoardAction,
  restoreBoardAction,
  updateBoardAction,
} from "@/features/boards/actions";
import type { BoardRecord } from "@/features/boards/types";
import { publicBoardPath } from "@/features/public/paths";
import type { PlanId } from "@/features/entitlements/plans";
import { toastActionFailure } from "@/features/billing/action-toast";
import { toastUndoable } from "@/components/shared/action-toast";

/**
 * Board management UI.
 *
 * The action results are the source of truth: the create/edit dialog stays open
 * with the server's field error, and the list refreshes from the server after
 * a successful write. Nothing here decides authorization or plan limits.
 */

type FormState = {
  name: string;
  slug: string;
  description: string;
  icon: string;
  color: string;
  position: string;
  visibility: "public" | "private";
  guestPosting: boolean;
  requireApproval: "none" | "first_time" | "all";
  comments: "open" | "moderated" | "closed";
  blockSensitiveInfo: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  slug: "",
  description: "",
  icon: "",
  color: "",
  position: "0",
  visibility: "public",
  guestPosting: false,
  requireApproval: "none",
  comments: "open",
  blockSensitiveInfo: false,
};

const APPROVAL_LABELS: Record<FormState["requireApproval"], string> = {
  none: "No approval",
  first_time: "First-time authors",
  all: "Every request",
};

const COMMENT_LABELS: Record<FormState["comments"], string> = {
  open: "Open",
  moderated: "Moderated",
  closed: "Closed",
};

function formFor(board: BoardRecord): FormState {
  return {
    name: board.name,
    slug: board.slug,
    description: board.description ?? "",
    icon: board.icon ?? "",
    color: board.color ?? "",
    position: String(board.position),
    visibility: board.visibility,
    guestPosting: board.guestPosting,
    requireApproval: board.settings.moderation.requireApproval,
    comments: board.settings.moderation.comments,
    blockSensitiveInfo: board.settings.moderation.blockSensitiveInfo,
  };
}

function moderationSummary(board: BoardRecord): string {
  const moderation = board.settings.moderation;
  return `${APPROVAL_LABELS[moderation.requireApproval]} · comments ${
    COMMENT_LABELS[moderation.comments]
  }`;
}

export function BoardsView({
  workspaceSlug,
  productSlug,
  boards,
  canManage,
  limit,
}: {
  workspaceSlug: string;
  productSlug: string;
  boards: BoardRecord[];
  canManage: boolean;
  limit: { allowed: boolean; current: number; limit: number | null; plan: PlanId };
}) {
  const router = useRouter();
  const active = boards.filter((board) => board.archivedAt === null);
  const archived = boards.filter((board) => board.archivedAt !== null);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BoardRecord | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorBillingUrl, setErrorBillingUrl] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [busyBoardId, setBusyBoardId] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, position: String(active.length) });
    setError(null);
    setErrorBillingUrl(null);
    setSlugError(null);
    setOpen(true);
  }

  function openEdit(board: BoardRecord) {
    setEditing(board);
    setForm(formFor(board));
    setError(null);
    setErrorBillingUrl(null);
    setSlugError(null);
    setOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError(null);
    setErrorBillingUrl(null);
    setSlugError(null);

    const payload = {
      workspaceSlug,
      productSlug,
      name: form.name,
      slug: form.slug,
      description: form.description,
      icon: form.icon,
      color: form.color,
      position: Number(form.position || 0),
      visibility: form.visibility,
      guestPosting: form.guestPosting,
      requireApproval: form.requireApproval,
      comments: form.comments,
      blockSensitiveInfo: form.blockSensitiveInfo,
    };

    try {
      const result = editing
        ? await updateBoardAction({ ...payload, boardId: editing.id })
        : await createBoardAction(payload);

      if (!result.ok) {
        setError(result.error);
        setErrorBillingUrl(result.billingUrl ?? null);
        setSlugError(result.fieldErrors?.slug?.[0] ?? null);
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not save the board. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function archive(board: BoardRecord) {
    setBusyBoardId(board.id);
    try {
      const result = await archiveBoardAction({
        workspaceSlug,
        productSlug,
        boardId: board.id,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      toastUndoable({
        message: `"${board.name}" archived`,
        description:
          "The public URL stopped working. Restore it from Archived boards, or undo now.",
        onUndo: () => void restore(board),
      });
      router.refresh();
    } finally {
      setBusyBoardId(null);
    }
  }

  async function restore(board: BoardRecord) {
    setBusyBoardId(board.id);
    try {
      const result = await restoreBoardAction({
        workspaceSlug,
        productSlug,
        boardId: board.id,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      router.refresh();
    } finally {
      setBusyBoardId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Boards"
        description="Public feedback spaces for this product. Each board has its own URL, visibility and moderation rules."
        actions={
          <Button
            type="button"
            onClick={openCreate}
            disabled={!canManage || !limit.allowed}
            title={canManage ? undefined : "Ask an owner or admin to manage boards."}
          >
            <Plus aria-hidden="true" />
            New board
          </Button>
        }
        meta={
          <>
            <span>
              {active.length} of {limit.limit ?? "∞"} boards used
            </span>
            <span aria-hidden="true">·</span>
            <span className="capitalize">{limit.plan} plan</span>
          </>
        }
      />

      {!canManage ? (
        <div className="rounded-md border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          You can view this product&apos;s boards, but changing them requires the
          owner or admin role.
        </div>
      ) : null}

      {!limit.allowed && canManage ? (
        <div className="rounded-md border border-warning/30 bg-warning-muted px-4 py-3 text-sm text-warning">
          This product has reached its board limit. Archive a board to free a slot,
          or upgrade the workspace to add another.
        </div>
      ) : null}

      {active.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No boards yet"
          description="A board gives customers one place to read and submit feedback. Create the first one to publish a public URL."
          action={
            <Button
              type="button"
              onClick={openCreate}
              disabled={!canManage || !limit.allowed}
            >
              <Plus aria-hidden="true" />
              New board
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {active.map((board) => (
            <li key={board.id}>
              <Card>
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {board.icon ? (
                        <span aria-hidden="true" className="text-base leading-none">
                          {board.icon}
                        </span>
                      ) : null}
                      <h2 className="text-sm font-semibold">{board.name}</h2>
                      <StatusBadge tone={board.visibility === "public" ? "success" : "neutral"}>
                        {board.visibility === "public" ? "Public" : "Private"}
                      </StatusBadge>
                      {board.guestPosting ? (
                        <StatusBadge tone="info">Guest posting</StatusBadge>
                      ) : null}
                    </div>

                    {board.description ? (
                      <p className="max-w-2xl text-sm text-muted-foreground">
                        {board.description}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {board.postCount} {board.postCount === 1 ? "request" : "requests"}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{moderationSummary(board)}</span>
                      <span aria-hidden="true">·</span>
                      <span>Order {board.position}</span>
                    </div>

                    {board.visibility === "public" ? (
                      <Link
                        href={publicBoardPath(workspaceSlug, productSlug, board.slug)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        /p/{workspaceSlug}/{productSlug}/{board.slug}
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </Link>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Private boards are only visible to the team.
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(board)}
                      disabled={!canManage}
                    >
                      <Pencil aria-hidden="true" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!canManage || busyBoardId === board.id}
                      onClick={() => void archive(board)}
                    >
                      <Archive aria-hidden="true" />
                      Archive
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 ? (
        <section className="space-y-3" aria-labelledby="archived-boards">
          <h2 id="archived-boards" className="text-sm font-semibold text-muted-foreground">
            Archived boards
          </h2>
          <ul className="space-y-3">
            {archived.map((board) => (
              <li key={board.id}>
                <Card className="border-dashed">
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium">{board.name}</h3>
                        <StatusBadge tone="neutral">Archived</StatusBadge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        /p/{workspaceSlug}/{productSlug}/{board.slug} · {board.postCount}{" "}
                        {board.postCount === 1 ? "request" : "requests"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        !canManage || busyBoardId === board.id || !limit.allowed
                      }
                      title={
                        !canManage
                          ? "Ask an owner or admin to manage boards."
                          : limit.allowed
                            ? undefined
                            : "The board limit is reached; archive another board first."
                      }
                      onClick={() => void restore(board)}
                    >
                      <RotateCcw aria-hidden="true" />
                      Restore
                    </Button>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit board" : "New board"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Changes to visibility or moderation apply on the next request."
                : "Give the board a name and public URL. You can change everything later."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            {error ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {error}
                {errorBillingUrl ? (
                  <>
                    {" "}
                    <a className="font-medium underline" href={errorBillingUrl}>
                      Compare plans
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="board-name">Name</Label>
                <Input
                  id="board-name"
                  value={form.name}
                  onChange={(event) => set("name", event.target.value)}
                  maxLength={80}
                  required
                  disabled={saving}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="board-slug">Public URL</Label>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-muted-foreground">
                    /p/{workspaceSlug}/{productSlug}/
                  </span>
                  <Input
                    id="board-slug"
                    value={form.slug}
                    onChange={(event) => set("slug", event.target.value)}
                    placeholder="generated-from-the-name"
                    maxLength={48}
                    disabled={saving}
                    aria-invalid={slugError ? true : undefined}
                    aria-describedby={slugError ? "board-slug-error" : undefined}
                  />
                </div>
                {slugError ? (
                  <p id="board-slug-error" className="text-xs text-destructive">
                    {slugError}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Lowercase letters, numbers and single hyphens. Leave blank to derive
                    it from the name.
                  </p>
                )}
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="board-description">Description</Label>
                <Textarea
                  id="board-description"
                  value={form.description}
                  onChange={(event) => set("description", event.target.value)}
                  maxLength={280}
                  rows={2}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">{form.description.length}/280</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="board-icon">Icon</Label>
                <Input
                  id="board-icon"
                  value={form.icon}
                  onChange={(event) => set("icon", event.target.value)}
                  maxLength={8}
                  placeholder="💡"
                  disabled={saving}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="board-color">Accent colour</Label>
                <Input
                  id="board-color"
                  value={form.color}
                  onChange={(event) => set("color", event.target.value)}
                  placeholder="#4f46e5"
                  maxLength={7}
                  disabled={saving}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="board-position">Order</Label>
                <Input
                  id="board-position"
                  type="number"
                  min={0}
                  max={9999}
                  value={form.position}
                  onChange={(event) => set("position", event.target.value)}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  Lower numbers appear first in the board switcher.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="board-visibility">Visibility</Label>
                <Select
                  value={form.visibility}
                  onValueChange={(value) => set("visibility", value as FormState["visibility"])}
                  disabled={saving}
                >
                  <SelectTrigger id="board-visibility">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="private">Private</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 sm:col-span-2">
                <div>
                  <Label htmlFor="board-guest-posting">Guest posting</Label>
                  <p className="text-xs text-muted-foreground">
                    Allow people without a customer account to submit feedback.
                  </p>
                </div>
                <Switch
                  id="board-guest-posting"
                  checked={form.guestPosting}
                  onCheckedChange={(value) => set("guestPosting", value)}
                  disabled={saving}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="board-approval">Request approval</Label>
                <Select
                  value={form.requireApproval}
                  onValueChange={(value) =>
                    set("requireApproval", value as FormState["requireApproval"])
                  }
                  disabled={saving}
                >
                  <SelectTrigger id="board-approval">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No approval</SelectItem>
                    <SelectItem value="first_time">First-time authors</SelectItem>
                    <SelectItem value="all">Every request</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="board-comments">Comments</Label>
                <Select
                  value={form.comments}
                  onValueChange={(value) =>
                    set("comments", value as FormState["comments"])
                  }
                  disabled={saving}
                >
                  <SelectTrigger id="board-comments">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="moderated">Moderated</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 sm:col-span-2">
                <div>
                  <Label htmlFor="board-sensitive-info">Block sensitive information</Label>
                  <p className="text-xs text-muted-foreground">
                    Reject submissions that appear to contain credentials or payment
                    data.
                  </p>
                </div>
                <Switch
                  id="board-sensitive-info"
                  checked={form.blockSensitiveInfo}
                  onCheckedChange={(value) => set("blockSensitiveInfo", value)}
                  disabled={saving}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save board" : "Create board"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
