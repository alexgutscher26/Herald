"use client";

import { ExternalLink, Map as MapIcon, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import {
  deleteRoadmapAction,
  saveRoadmapAction,
  setRoadmapPublishedAction,
} from "./actions";

export type RoadmapBoardOption = {
  id: string;
  name: string;
  slug: string;
  visibility: "public" | "private";
  archivedAt: string | null;
};

export type RoadmapAdminItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: "public" | "unlisted";
  position: number;
  publishedAt: string | null;
  boardIds: string[];
};

const EMPTY = {
  id: null as string | null,
  name: "",
  slug: "",
  description: "",
  visibility: "public" as "public" | "unlisted",
  position: 0,
  published: true,
  boardIds: [] as string[],
};

export function RoadmapManager({
  workspaceSlug,
  productSlug,
  boards,
  roadmaps,
  canManage,
}: {
  workspaceSlug: string;
  productSlug: string;
  boards: RoadmapBoardOption[];
  roadmaps: RoadmapAdminItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const publicBoards = boards.filter(
    (board) => board.visibility === "public" && board.archivedAt === null,
  );

  function edit(roadmap: RoadmapAdminItem): void {
    setForm({
      id: roadmap.id,
      name: roadmap.name,
      slug: roadmap.slug,
      description: roadmap.description ?? "",
      visibility: roadmap.visibility,
      position: roadmap.position,
      published: roadmap.publishedAt !== null,
      boardIds: roadmap.boardIds,
    });
    setError(null);
  }

  function save(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveRoadmapAction({
        workspaceSlug,
        productSlug,
        roadmapId: form.id,
        form: {
          name: form.name,
          slug: form.slug,
          description: form.description,
          visibility: form.visibility,
          position: form.position,
          published: form.published,
          boardIds: form.boardIds,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setForm(EMPTY);
      router.refresh();
    });
  }

  function togglePublished(roadmap: RoadmapAdminItem): void {
    startTransition(async () => {
      const result = await setRoadmapPublishedAction({
        workspaceSlug,
        productSlug,
        roadmapId: roadmap.id,
        published: roadmap.publishedAt === null,
      });
      if (!result.ok) {
        toast.error("Could not change publication", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  function remove(roadmap: RoadmapAdminItem): void {
    startTransition(async () => {
      const result = await deleteRoadmapAction({
        workspaceSlug,
        productSlug,
        roadmapId: roadmap.id,
      });
      if (!result.ok) {
        toast.error("Could not delete the roadmap", { description: result.error });
        return;
      }
      if (form.id === roadmap.id) setForm(EMPTY);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapIcon className="size-4" aria-hidden="true" />
          Public roadmap views
        </CardTitle>
        <CardDescription>
          Publish more than one view over public boards. A segment-specific view only appears
          to visitors who can already see its gated boards; unlisted views are link-only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {roadmaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No named views yet. The default /roadmap still shows every public board.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {roadmaps.map((roadmap) => (
              <li
                key={roadmap.id}
                className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{roadmap.name}</p>
                    <Badge variant="secondary">
                      {roadmap.visibility === "public" ? "Listed" : "Unlisted"}
                    </Badge>
                    <Badge variant={roadmap.publishedAt ? "secondary" : "outline"}>
                      {roadmap.publishedAt ? "Published" : "Draft"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    /roadmap/{roadmap.slug} · {roadmap.boardIds.length} board
                    {roadmap.boardIds.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {roadmap.publishedAt ? (
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        href={`/p/${workspaceSlug}/${productSlug}/roadmap/${roadmap.slug}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink aria-hidden="true" />
                        View
                      </Link>
                    </Button>
                  ) : null}
                  {canManage ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => edit(roadmap)}
                        disabled={pending}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => togglePublished(roadmap)}
                        disabled={pending}
                      >
                        {roadmap.publishedAt ? "Unpublish" : "Publish"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(roadmap)}
                        disabled={pending}
                        aria-label={`Delete ${roadmap.name}`}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          <form onSubmit={save} className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {form.id ? "Edit view" : "New view"}
              </h3>
              {form.id ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setForm(EMPTY)}>
                  Cancel edit
                </Button>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="roadmap-name">Name</Label>
                <Input
                  id="roadmap-name"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "roadmap-form-error" : undefined}
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Enterprise roadmap"
                  maxLength={80}
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="roadmap-slug">URL slug</Label>
                <Input
                  id="roadmap-slug"
                  value={form.slug}
                  onChange={(event) => setForm({ ...form, slug: event.target.value })}
                  placeholder="enterprise"
                  maxLength={48}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="roadmap-description">Description</Label>
              <Textarea
                id="roadmap-description"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                maxLength={280}
                rows={2}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="roadmap-visibility">Visibility</Label>
                <select
                  id="roadmap-visibility"
                  value={form.visibility}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      visibility: event.target.value as "public" | "unlisted",
                    })
                  }
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="public">Listed and crawlable</option>
                  <option value="unlisted">Link-only</option>
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="roadmap-position">Position</Label>
                <Input
                  id="roadmap-position"
                  type="number"
                  min={0}
                  max={9999}
                  value={form.position}
                  onChange={(event) =>
                    setForm({ ...form, position: Number(event.target.value) })
                  }
                />
              </div>
              <label className="flex items-end gap-2 pb-1 text-sm">
                <Switch
                  checked={form.published}
                  onCheckedChange={(published) => setForm({ ...form, published })}
                />
                Publish this view
              </label>
            </div>

            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Boards</legend>
              <p className="text-xs text-muted-foreground">
                Only public boards are eligible. Gated boards stay gated for each visitor.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {publicBoards.map((board) => (
                  <label key={board.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.boardIds.includes(board.id)}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          boardIds: event.target.checked
                            ? [...form.boardIds, board.id]
                            : form.boardIds.filter((id) => id !== board.id),
                        })
                      }
                    />
                    {board.name}
                  </label>
                ))}
              </div>
              {publicBoards.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Create a public board first. A view with no boards shows empty columns.
                </p>
              ) : null}
            </fieldset>

            <Button type="submit" disabled={pending || form.name.trim().length < 2}>
              <Plus aria-hidden="true" />
              {pending ? "Saving…" : form.id ? "Save view" : "Create view"}
            </Button>
            {error ? (
              <p id="roadmap-form-error" role="alert" className="text-xs font-medium text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
