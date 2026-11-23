import Link from "next/link";
import { Check, Lightbulb } from "lucide-react";

import { SettingsSection } from "@/components/shared/settings-section";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";

import { completeJunoKnowledgeTaskAction } from "./actions";
import type { JunoKnowledgeTaskRow } from "./knowledge-tasks";

/** Open knowledge-gap tasks created by thumbs-down on an answer. */
export function JunoKnowledgeTasksView({
  workspaceSlug,
  productSlug,
  tasks,
  canManage,
}: {
  workspaceSlug: string;
  productSlug: string;
  tasks: JunoKnowledgeTaskRow[];
  canManage: boolean;
}) {
  const inbox = `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/conversations`;

  return (
    <SettingsSection
      id="juno-knowledge-tasks"
      icon={Lightbulb}
      title="Knowledge gaps"
      description="A thumbs-down on an answer opens a task to add the missing source. Redacted questions only; no customer text is copied into this list."
      badge={
        <StatusBadge tone={tasks.length > 0 ? "warning" : "neutral"}>
          {tasks.length} open
        </StatusBadge>
      }
    >
      {tasks.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">
          No open gaps. Mark an answer “Not helpful” in answer inspection and it
          will appear here.
        </p>
      ) : (
        <ol className="space-y-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/80 bg-muted/15 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{task.question}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <Link href={`${inbox}/${encodeURIComponent(task.conversationId)}`} className="hover:underline">
                    {task.conversationSubject}
                  </Link>{" "}
                  · opened {new Date(task.createdAt).toLocaleDateString()}
                </p>
              </div>
              {canManage ? (
                <form action={completeJunoKnowledgeTaskAction}>
                  <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                  <input type="hidden" name="productSlug" value={productSlug} />
                  <input type="hidden" name="taskId" value={task.id} />
                  <Button type="submit" size="sm" variant="outline">
                    <Check aria-hidden="true" />
                    Mark done
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </SettingsSection>
  );
}
