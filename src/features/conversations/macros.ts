import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { user } from "@/db/schema/auth";
import {
  conversationMacros,
  conversationTagLinks,
  conversationTags,
  conversations,
  type ConversationStatus,
} from "@/db/schema/conversations";
import { workspaceMembers } from "@/db/schema/workspaces";
import {
  isMacroStatus,
  MACRO_STATUSES,
  normalizeTagName,
  type ConversationMacroRow,
  type MacroStatus,
} from "./macro-rules";
import type { ServiceResult } from "./service";
import {
  appendTeamMessage,
  assignConversation,
  setConversationStatus,
} from "./service";

/**
 * Reusable multi-step conversation actions.
 *
 * The reply is sent through the normal message service, so email fallback,
 * Slack mirroring, takeover, draft clearing and read state stay identical to a
 * hand-written reply. The remaining steps are independent metadata updates.
 */

export type { ConversationMacroRow, MacroStatus } from "./macro-rules";
export { isMacroStatus, normalizeTagName } from "./macro-rules";

export async function listConversationMacros(
  productId: string,
): Promise<ConversationMacroRow[]> {
  const rows = await db
    .select({
      id: conversationMacros.id,
      name: conversationMacros.name,
      replyBody: conversationMacros.replyBody,
      tagName: conversationMacros.tagName,
      status: conversationMacros.status,
      assigneeId: conversationMacros.assigneeId,
      assigneeName: user.name,
    })
    .from(conversationMacros)
    .leftJoin(user, eq(conversationMacros.assigneeId, user.id))
    .where(eq(conversationMacros.productId, productId))
    .orderBy(asc(conversationMacros.name));

  return rows;
}

export async function createConversationMacro(input: {
  productId: string;
  workspaceId: string;
  name: string;
  replyBody: string;
  tagName?: string | null;
  status?: MacroStatus | null;
  assigneeId?: string | null;
  now?: Date;
}): Promise<ServiceResult<{ id: string }>> {
  const name = input.name.trim().slice(0, 80);
  if (name === "") return { ok: false, error: "Give the macro a name." };
  const replyBody = input.replyBody.trim().slice(0, 10_000);

  const tagName =
    input.tagName === undefined || input.tagName === null || input.tagName.trim() === ""
      ? null
      : normalizeTagName(input.tagName);
  if (input.tagName?.trim() && tagName === null) {
    return {
      ok: false,
      error: "Tags use letters, numbers, spaces, hyphens or underscores, up to 32 characters.",
    };
  }

  const status =
    input.status === undefined || input.status === null ? null : input.status;
  if (status !== null && !MACRO_STATUSES.includes(status)) {
    return { ok: false, error: "Choose a valid status for this macro." };
  }

  if (input.assigneeId) {
    const member = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.assigneeId),
        ),
      )
      .limit(1);
    if (!member[0]) {
      return { ok: false, error: "That person is not a member of this workspace." };
    }
  }

  try {
    const inserted = await db
      .insert(conversationMacros)
      .values({
        productId: input.productId,
        name,
        replyBody,
        tagName,
        status,
        assigneeId: input.assigneeId || null,
        updatedAt: input.now ?? new Date(),
      })
      .returning({ id: conversationMacros.id });
    const macro = inserted[0];
    if (!macro) return { ok: false, error: "The macro could not be saved." };
    return { ok: true, data: { id: macro.id } };
  } catch {
    return { ok: false, error: "A macro with that name already exists." };
  }
}

export async function deleteConversationMacro(input: {
  productId: string;
  macroId: string;
}): Promise<ServiceResult<{ deleted: boolean }>> {
  const deleted = await db
    .delete(conversationMacros)
    .where(
      and(
        eq(conversationMacros.id, input.macroId),
        eq(conversationMacros.productId, input.productId),
      ),
    )
    .returning({ id: conversationMacros.id });
  return { ok: true, data: { deleted: deleted.length > 0 } };
}

export async function applyConversationMacro(input: {
  productId: string;
  workspaceId: string;
  conversationId: string;
  macroId: string;
  userId: string;
  now?: Date;
}): Promise<
  ServiceResult<{
    replied: boolean;
    tagName: string | null;
    status: ConversationStatus | null;
    assigneeId: string | null;
  }>
> {
  const rows = await db
    .select()
    .from(conversationMacros)
    .where(
      and(
        eq(conversationMacros.id, input.macroId),
        eq(conversationMacros.productId, input.productId),
      ),
    )
    .limit(1);
  const macro = rows[0];
  if (!macro) return { ok: false, error: "That macro no longer exists." };

  const conversation = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.productId, input.productId),
      ),
    )
    .limit(1);
  if (!conversation[0]) {
    return { ok: false, error: "That conversation no longer exists." };
  }

  const now = input.now ?? new Date();
  let replied = false;
  if (macro.replyBody.trim() !== "") {
    const reply = await appendTeamMessage({
      productId: input.productId,
      conversationId: input.conversationId,
      userId: input.userId,
      body: macro.replyBody,
      // A stored reply beginning with `/` is content, not a slash command.
      kind: "message",
      now,
    });
    if (!reply.ok) return reply;
    replied = true;
  }

  if (macro.tagName) {
    const tagName = normalizeTagName(macro.tagName);
    if (tagName) {
      const inserted = await db
        .insert(conversationTags)
        .values({ productId: input.productId, name: tagName })
        .onConflictDoNothing()
        .returning({ id: conversationTags.id });
      const tagId =
        inserted[0]?.id ??
        (
          await db
            .select({ id: conversationTags.id })
            .from(conversationTags)
            .where(
              and(
                eq(conversationTags.productId, input.productId),
                eq(conversationTags.name, tagName),
              ),
            )
            .limit(1)
        )[0]?.id;
      if (tagId) {
        await db
          .insert(conversationTagLinks)
          .values({
            conversationId: input.conversationId,
            productId: input.productId,
            tagId,
          })
          .onConflictDoNothing();
      }
    }
  }

  if (macro.status && isMacroStatus(macro.status)) {
    const status = await setConversationStatus({
      productId: input.productId,
      conversationId: input.conversationId,
      status: macro.status,
      now,
    });
    if (!status.ok) {
      console.error("[conversations] macro status step failed", status.error);
    }
  }

  if (macro.assigneeId) {
    const assigned = await assignConversation({
      productId: input.productId,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      assigneeId: macro.assigneeId,
      now,
    });
    if (!assigned.ok) {
      console.error("[conversations] macro assignment step failed", assigned.error);
    }
  }

  return {
    ok: true,
    data: {
      replied,
      tagName: macro.tagName,
      status: macro.status,
      assigneeId: macro.assigneeId,
    },
  };
}

