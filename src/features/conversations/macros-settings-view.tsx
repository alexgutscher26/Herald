import { Trash2, Wand2 } from "lucide-react";

import { SettingsSection } from "@/components/shared/settings-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { AssignableMember } from "./queries";
import type { ConversationMacroRow } from "./macro-rules";
import {
  createConversationMacroAction,
  deleteConversationMacroAction,
} from "./macro-actions";

const TEXTAREA_CLASS =
  "min-h-24 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-none outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";
const SELECT_CLASS =
  "h-9 rounded-full border border-input bg-card px-2.5 text-sm shadow-none transition-colors focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * A macro is a reply and up to three metadata steps. Every step is optional;
 * empty fields leave the conversation untouched. The apply control lives on the
 * thread, not here.
 */
export function ConversationMacrosSettingsView({
  workspaceSlug,
  productSlug,
  macros,
  members,
  canManage,
}: {
  workspaceSlug: string;
  productSlug: string;
  macros: ConversationMacroRow[];
  members: AssignableMember[];
  canManage: boolean;
}) {
  return (
    <SettingsSection
      icon={Wand2}
      title="Conversation macros"
      description="Reusable multi-step actions: send a reply, add a tag, set a status and assign an operator. Empty fields leave that part of the conversation unchanged."
      badge={
        <span className="text-xs text-muted-foreground">
          {macros.length} macro{macros.length === 1 ? "" : "s"}
        </span>
      }
    >
      {macros.length > 0 ? (
        <ul className="space-y-2">
          {macros.map((macro) => (
            <li
              key={macro.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-[10px] border border-border/80 bg-muted/10 px-3.5 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{macro.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[
                    macro.replyBody ? "reply" : null,
                    macro.tagName ? `tag: ${macro.tagName}` : null,
                    macro.status ? `status: ${macro.status}` : null,
                    macro.assigneeName ? `assign: ${macro.assigneeName}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No steps configured"}
                </p>
              </div>
              <form action={deleteConversationMacroAction}>
                <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                <input type="hidden" name="productSlug" value={productSlug} />
                <input type="hidden" name="macroId" value={macro.id} />
                <Button
                  type="submit"
                  size="sm"
                  variant="ghost"
                  disabled={!canManage}
                  aria-label={`Delete ${macro.name}`}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No macros yet. Build one below, then apply it from a conversation.
        </p>
      )}

      <form action={createConversationMacroAction} className="mt-5 space-y-4 border-t border-border/70 pt-5">
        <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
        <input type="hidden" name="productSlug" value={productSlug} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="macro-name">Name</Label>
            <Input
              id="macro-name"
              name="name"
              placeholder="Refund approved"
              maxLength={80}
              disabled={!canManage}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="macro-tag">Add tag (optional)</Label>
            <Input
              id="macro-tag"
              name="tagName"
              placeholder="billing"
              maxLength={32}
              disabled={!canManage}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="macro-status">Set status (optional)</Label>
            <select
              id="macro-status"
              name="status"
              defaultValue=""
              disabled={!canManage}
              className={SELECT_CLASS}
            >
              <option value="">Leave unchanged</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="spam">Spam</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="macro-assignee">Assign to (optional)</Label>
            <select
              id="macro-assignee"
              name="assigneeId"
              defaultValue=""
              disabled={!canManage}
              className={SELECT_CLASS}
            >
              <option value="">Leave unchanged</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="macro-reply">Reply (optional)</Label>
          <textarea
            id="macro-reply"
            name="replyBody"
            maxLength={10_000}
            placeholder="Write the customer-facing reply this macro sends."
            disabled={!canManage}
            className={TEXTAREA_CLASS}
          />
        </div>

        <div className="flex justify-end border-t border-border/70 pt-4">
          <Button type="submit" size="sm" disabled={!canManage}>
            Create macro
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}
