"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";

import { applyConversationMacro } from "./macros";
import {
  appendTeamMessage,
  addConversationTag,
  assignConversation,
  assignNextConversation,
  blockConversationSender,
  bulkAssignConversations,
  bulkSetConversationStatus,
  bulkSnoozeConversations,
  bulkTagConversations,
  completeConversationReminder,
  markConversationNotSpam,
  mergeConversation,
  removeConversationTag,
  saveConversationDraft,
  setConversationReminder,
  setConversationStatus,
  snoozeConversation,
} from "./service";
import { linkConversationToCompany } from "./company-link";
import { saveSpamRules } from "./spam-settings";
import { markConversationNotificationsRead } from "./queries";
import {
  createRequestFromConversation,
  linkConversationMessageToRequest,
} from "./handoff";

/**
 * Conversation server actions.
 *
 * Each action authenticates, checks `conversation:write`, resolves the product
 * from the URL slugs and only then calls the service with the authorized
 * product id. The service never sees a client-supplied tenant identifier.
 */

const baseSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  conversationId: z.uuid("That conversation id is not valid."),
});

const moderationStatusSchema = z.enum(["open", "resolved", "spam", "archived"]);

function revalidate(workspaceSlug: string, productSlug: string) {
  revalidatePath(`/app/${workspaceSlug}/${productSlug}`, "layout");
}

export async function replyConversationAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  body: string;
  attachmentIds?: string[];
}): Promise<ActionResult<{ messageId: string | null; status: string }>> {
  const parsed = baseSchema
    .extend({
      body: z.string().max(10_000),
      attachmentIds: z.array(z.uuid()).max(5).optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the reply.",
    };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await appendTeamMessage({
      productId: authorized.context.product.id,
      conversationId: parsed.data.conversationId,
      userId: authorized.context.user.id,
      body: parsed.data.body,
      attachmentIds: parsed.data.attachmentIds,
    });
    if (!result.ok) return result;

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] reply failed", error);
    return { ok: false, error: "Could not send that reply. Please try again." };
  }
}

export async function setConversationStatusAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  status: "open" | "resolved" | "spam" | "archived";
}): Promise<ActionResult<{ updated: number }>> {
  const parsed = baseSchema
    .extend({ status: moderationStatusSchema })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose a status." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await setConversationStatus({
      productId: authorized.context.product.id,
      conversationId: parsed.data.conversationId,
      status: parsed.data.status,
    });
    if (!result.ok) return result;

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] status change failed", error);
    return { ok: false, error: "Could not change that conversation." };
  }
}

export async function bulkSetConversationStatusAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationIds: string[];
  status: "open" | "resolved" | "spam" | "archived";
}): Promise<ActionResult<{ updated: number }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      conversationIds: z
        .array(z.uuid("That conversation id is not valid."))
        .min(1, "Select at least one conversation.")
        .max(100, "Select at most 100 conversations."),
      status: moderationStatusSchema,
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Select conversations first.",
    };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await bulkSetConversationStatus({
      productId: authorized.context.product.id,
      conversationIds: parsed.data.conversationIds,
      status: parsed.data.status,
    });
    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result };
  } catch (error) {
    console.error("[conversations] bulk status failed", error);
    return { ok: false, error: "Could not update those conversations." };
  }
}

export async function assignConversationAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  assigneeId: string | null;
}): Promise<ActionResult<{ assigneeId: string | null }>> {
  const parsed = baseSchema
    .extend({ assigneeId: z.string().min(1).max(120).nullable() })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose an assignee." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await assignConversation({
      productId: authorized.context.product.id,
      workspaceId: authorized.context.workspace.id,
      conversationId: parsed.data.conversationId,
      assigneeId: parsed.data.assigneeId,
    });
    if (!result.ok) return result;

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] assignment failed", error);
    return { ok: false, error: "Could not assign that conversation." };
  }
}

export async function assignNextConversationAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
}): Promise<
  ActionResult<{ assigneeId: string; assigneeName: string }>
> {
  const parsed = baseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That conversation id is not valid." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await assignNextConversation({
      productId: authorized.context.product.id,
      workspaceId: authorized.context.workspace.id,
      conversationId: parsed.data.conversationId,
    });
    if (!result.ok) return result;

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] round-robin assignment failed", error);
    return { ok: false, error: "Could not assign that conversation." };
  }
}

export async function applyConversationMacroAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  macroId: string;
}): Promise<ActionResult<{ replied: boolean }>> {
  const parsed = baseSchema
    .extend({ macroId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That macro id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await applyConversationMacro({
      productId: authorized.context.product.id,
      workspaceId: authorized.context.workspace.id,
      conversationId: parsed.data.conversationId,
      macroId: parsed.data.macroId,
      userId: authorized.context.user.id,
    });
    if (!result.ok) return result;

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { replied: result.data.replied } };
  } catch (error) {
    console.error("[conversations] macro failed", error);
    return { ok: false, error: "Could not apply that macro." };
  }
}

export async function snoozeConversationAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  minutes: number;
}): Promise<ActionResult<{ snoozedUntil: string }>> {
  const parsed = baseSchema
    .extend({ minutes: z.number().int().min(5).max(43_200) })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Snooze between 5 minutes and 30 days." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await snoozeConversation({
      productId: authorized.context.product.id,
      conversationId: parsed.data.conversationId,
      minutes: parsed.data.minutes,
    });
    if (!result.ok) return result;

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] snooze failed", error);
    return { ok: false, error: "Could not snooze that conversation." };
  }
}

export async function blockConversationSenderAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
}): Promise<ActionResult<{ blocked: true }>> {
  const parsed = baseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That conversation id is not valid." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await blockConversationSender({
      productId: authorized.context.product.id,
      workspaceId: authorized.context.workspace.id,
      conversationId: parsed.data.conversationId,
      userId: authorized.context.user.id,
    });
    if (!result.ok) return result;

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] block sender failed", error);
    return { ok: false, error: "Could not block that sender." };
  }
}

export async function setConversationReminderAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  remindAt: string;
}): Promise<ActionResult<{ reminderId: string }>> {
  const parsed = baseSchema
    .extend({ remindAt: z.string().min(1, "Choose a reminder time.") })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose a reminder time." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await setConversationReminder({
      productId: authorized.context.product.id,
      conversationId: parsed.data.conversationId,
      userId: authorized.context.user.id,
      remindAt: new Date(parsed.data.remindAt),
    });
    if (!result.ok) return result;

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] reminder failed", error);
    return { ok: false, error: "Could not save that reminder." };
  }
}

export async function saveConversationDraftAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  body: string;
}): Promise<ActionResult<{ saved: boolean }>> {
  const parsed = baseSchema
    .extend({ body: z.string().max(10_000) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "The draft is too long." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    return await saveConversationDraft({
      productId: authorized.context.product.id,
      conversationId: parsed.data.conversationId,
      userId: authorized.context.user.id,
      body: parsed.data.body,
    });
  } catch (error) {
    console.error("[conversations] draft save failed", error);
    return { ok: false, error: "Could not save the draft." };
  }
}

export async function markConversationNotificationsReadAction(input: {
  workspaceSlug: string;
  productSlug: string;
}): Promise<ActionResult<{ updated: number }>> {
  const parsed = z
    .object({ workspaceSlug: z.string().min(1), productSlug: z.string().min(1) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the request." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:read",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await markConversationNotificationsRead({
      productId: authorized.context.product.id,
      userId: authorized.context.user.id,
    });
    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result };
  } catch (error) {
    console.error("[conversations] notification read failed", error);
    return { ok: false, error: "Could not update notifications." };
  }
}

export async function createRequestFromConversationAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  boardId: string;
}): Promise<ActionResult<{ postId: string }>> {
  const parsed = baseSchema
    .extend({ boardId: z.uuid("Choose a board.") })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose a board." };
  }

  // Filing a public request needs feedback write, not only inbox access.
  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await createRequestFromConversation({
      productId: authorized.context.product.id,
      conversationId: parsed.data.conversationId,
      userId: authorized.context.user.id,
      boardId: parsed.data.boardId,
    });
    if (!result.ok) return result;

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    revalidatePath(
      `/p/${parsed.data.workspaceSlug}/${parsed.data.productSlug}`,
      "layout",
    );
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] handoff failed", error);
    return { ok: false, error: "Could not create the request. Please try again." };
  }
}

export async function linkConversationMessageToRequestAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  messageId: string;
  postId: string;
}): Promise<ActionResult<{ insightId: string }>> {
  const parsed = baseSchema
    .extend({
      conversationId: z.uuid("That conversation id is not valid."),
      messageId: z.uuid("Choose a message."),
      postId: z.uuid("Choose a request."),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose a request." };
  }

  // Attaching evidence changes what the team will cite later.
  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await linkConversationMessageToRequest({
      productId: authorized.context.product.id,
      conversationId: parsed.data.conversationId,
      messageId: parsed.data.messageId,
      postId: parsed.data.postId,
      userId: authorized.context.user.id,
    });
    if (!result.ok) return result;

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    revalidatePath(
      `/p/${parsed.data.workspaceSlug}/${parsed.data.productSlug}`,
      "layout",
    );
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] link failed", error);
    return { ok: false, error: "Could not link that message. Please try again." };
  }
}

export async function completeConversationReminderAction(input: {
  workspaceSlug: string;
  productSlug: string;
  reminderId: string;
}): Promise<ActionResult<{ updated: number }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      reminderId: z.uuid("That reminder id is not valid."),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That reminder id is not valid." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await completeConversationReminder({
      userId: authorized.context.user.id,
      reminderId: parsed.data.reminderId,
    });
    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result };
  } catch (error) {
    console.error("[conversations] reminder completion failed", error);
    return { ok: false, error: "Could not complete that reminder." };
  }
}

const bulkConversationIds = z
  .array(z.uuid("That conversation id is not valid."))
  .min(1, "Select at least one conversation.")
  .max(100, "Select at most 100 conversations.");

export async function bulkAssignConversationsAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationIds: string[];
  assigneeId: string | null;
}): Promise<ActionResult<{ updated: number }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      conversationIds: bulkConversationIds,
      assigneeId: z.string().min(1).max(120).nullable(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Select conversations first." };
  }
  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await bulkAssignConversations({
      productId: authorized.context.product.id,
      workspaceId: authorized.context.workspace.id,
      conversationIds: parsed.data.conversationIds,
      assigneeId: parsed.data.assigneeId,
    });
    if (!result.ok) return result;
    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] bulk assignment failed", error);
    return { ok: false, error: "Could not assign those conversations." };
  }
}

export async function bulkTagConversationsAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationIds: string[];
  tagName: string;
}): Promise<ActionResult<{ updated: number; tagName: string }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      conversationIds: bulkConversationIds,
      tagName: z.string().min(1).max(32),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a tag." };
  }
  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await bulkTagConversations({
      productId: authorized.context.product.id,
      conversationIds: parsed.data.conversationIds,
      tagName: parsed.data.tagName,
    });
    if (!result.ok) return result;
    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] bulk tag failed", error);
    return { ok: false, error: "Could not tag those conversations." };
  }
}

export async function bulkSnoozeConversationsAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationIds: string[];
  minutes: number;
}): Promise<ActionResult<{ updated: number; snoozedUntil: string }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      conversationIds: bulkConversationIds,
      minutes: z.number().int().min(5).max(43_200),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Snooze between 5 minutes and 30 days." };
  }
  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await bulkSnoozeConversations({
      productId: authorized.context.product.id,
      conversationIds: parsed.data.conversationIds,
      minutes: parsed.data.minutes,
    });
    if (!result.ok) return result;
    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] bulk snooze failed", error);
    return { ok: false, error: "Could not snooze those conversations." };
  }
}

export async function addConversationTagAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  tagName: string;
}): Promise<ActionResult<{ tagName: string }>> {
  const parsed = baseSchema
    .extend({ tagName: z.string().min(1).max(32) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a tag." };
  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await addConversationTag({
      productId: authorized.context.product.id,
      conversationId: parsed.data.conversationId,
      tagName: parsed.data.tagName,
    });
    if (!result.ok) return result;
    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] tag add failed", error);
    return { ok: false, error: "Could not add that tag." };
  }
}

export async function removeConversationTagAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  tagId: string;
}): Promise<ActionResult<{ removed: boolean }>> {
  const parsed = baseSchema
    .extend({ tagId: z.uuid("That tag id is not valid.") })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That tag id is not valid." };
  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await removeConversationTag({
      productId: authorized.context.product.id,
      conversationId: parsed.data.conversationId,
      tagId: parsed.data.tagId,
    });
    if (!result.ok) return result;
    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] tag remove failed", error);
    return { ok: false, error: "Could not remove that tag." };
  }
}

export async function mergeConversationAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  targetConversationId: string;
}): Promise<ActionResult<{ targetConversationId: string; movedMessages: number }>> {
  const parsed = baseSchema
    .extend({ targetConversationId: z.uuid("Choose a conversation to merge into.") })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a conversation to merge into." };
  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await mergeConversation({
      productId: authorized.context.product.id,
      sourceConversationId: parsed.data.conversationId,
      targetConversationId: parsed.data.targetConversationId,
      userId: authorized.context.user.id,
    });
    if (!result.ok) return result;
    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] merge failed", error);
    return { ok: false, error: "Could not merge those conversations." };
  }
}

export async function linkConversationCompanyAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
}): Promise<ActionResult<{ companyId: string; companyName: string }>> {
  const parsed = baseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That conversation id is not valid." };
  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await linkConversationToCompany({
      productId: authorized.context.product.id,
      conversationId: parsed.data.conversationId,
      userId: authorized.context.user.id,
    });
    if (!result.ok) return result;
    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] company link failed", error);
    return { ok: false, error: "Could not link that company." };
  }
}

export async function markConversationNotSpamAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
}): Promise<ActionResult<{ updated: number }>> {
  const parsed = baseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That conversation id is not valid." };
  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await markConversationNotSpam({
      productId: authorized.context.product.id,
      conversationId: parsed.data.conversationId,
      userId: authorized.context.user.id,
    });
    if (!result.ok) return result;
    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[conversations] not-spam failed", error);
    return { ok: false, error: "Could not release that conversation." };
  }
}

export async function saveSpamRulesAction(input: {
  workspaceSlug: string;
  productSlug: string;
  rules: {
    enabled: boolean;
    minimumScore: number;
    linkThreshold: number;
    keywords: string[];
    shouting: boolean;
    repetition: boolean;
    moneyPromise: boolean;
  };
}): Promise<ActionResult<{ saved: boolean }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      rules: z.object({
        enabled: z.boolean(),
        minimumScore: z.number().int().min(1).max(10),
        linkThreshold: z.number().int().min(2).max(20),
        keywords: z.array(z.string().max(80)).max(50),
        shouting: z.boolean(),
        repetition: z.boolean(),
        moneyPromise: z.boolean(),
      }),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the rules." };
  }
  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    await saveSpamRules({
      productId: authorized.context.product.id,
      rules: parsed.data.rules,
    });
    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { saved: true } };
  } catch (error) {
    console.error("[conversations] spam rules save failed", error);
    return { ok: false, error: "Could not save the spam rules." };
  }
}
