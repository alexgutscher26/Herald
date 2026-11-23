"use client";

import { Mail, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { toastUndoable } from "@/components/shared/action-toast";

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

import {
  createTopicAction,
  deleteTopicAction,
  setTopicActiveAction,
} from "./topic-actions";

type TopicAdminView = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  active: boolean;
  builtIn: boolean;
  tag: boolean;
};

export function TopicManager({
  workspaceSlug,
  productSlug,
  canWrite,
  topics,
}: {
  workspaceSlug: string;
  productSlug: string;
  canWrite: boolean;
  topics: TopicAdminView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  function create(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createTopicAction({
        workspaceSlug,
        productSlug,
        form: {
          name,
          key: "",
          description,
          position: topics.length,
          active: true,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      setDescription("");
      router.refresh();
    });
  }

  function toggle(topic: TopicAdminView, active: boolean): void {
    startTransition(async () => {
      const result = await setTopicActiveAction({
        workspaceSlug,
        productSlug,
        topicId: topic.id,
        active,
      });
      if (!result.ok) {
        toast.error("Could not update that topic", { description: result.error });
        return;
      }
      toastUndoable({
        message: active ? `"${topic.name}" enabled` : `"${topic.name}" disabled`,
        description: active
          ? "Subscribers can choose this topic again."
          : "The topic stays on existing preferences but can no longer be selected.",
        onUndo: () => toggle(topic, !active),
      });
      router.refresh();
    });
  }

  function remove(topic: TopicAdminView): void {
    startTransition(async () => {
      const result = await deleteTopicAction({
        workspaceSlug,
        productSlug,
        topicId: topic.id,
      });
      if (!result.ok) {
        toast.error("Could not delete that topic", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-4" aria-hidden="true" />
          Email topics
        </CardTitle>
        <CardDescription>
          Each list has its own preference and unsubscribe on the public preference page.
          Product updates and win-back are built in; add survey or announcement lists when
          you need them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y rounded-md border">
          {topics.map((topic) => (
            <li
              key={topic.id}
              className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{topic.name}</p>
                  {topic.builtIn ? <Badge variant="secondary">Built in</Badge> : null}
                  {topic.tag ? <Badge variant="outline">Release tag</Badge> : null}
                  {!topic.active ? <Badge variant="outline">Off</Badge> : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <code className="text-[11px]">{topic.key}</code>
                  {topic.description ? ` · ${topic.description}` : ""}
                </p>
              </div>
              {canWrite ? (
                <div className="flex items-center gap-2">
                  {topic.builtIn || topic.tag ? (
                    <span className="text-xs text-muted-foreground">
                      {topic.tag ? "Managed by release tags" : "Always available"}
                    </span>
                  ) : (
                    <>
                      <Switch
                        checked={topic.active}
                        onCheckedChange={(checked) => toggle(topic, checked)}
                        disabled={pending}
                        aria-label={`${topic.active ? "Disable" : "Enable"} ${topic.name}`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(topic)}
                        disabled={pending}
                        aria-label={`Delete ${topic.name}`}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        {canWrite ? (
          <form onSubmit={create} className="grid gap-3 border-t pt-4 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="new-topic-name">New topic</Label>
              <Input
                id="new-topic-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Survey invitations"
                maxLength={80}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-topic-description">Description</Label>
              <Input
                id="new-topic-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What someone receives from this list."
                maxLength={280}
              />
            </div>
            <Button type="submit" variant="outline" disabled={pending || name.trim().length < 2}>
              <Plus aria-hidden="true" />
              Add topic
            </Button>
          </form>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
