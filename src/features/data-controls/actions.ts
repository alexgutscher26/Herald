"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { authorizeWorkspaceAction } from "@/features/live/workspace-action-auth";
import type { ActionResult } from "@/features/live/action-result";

import {
  cancelWorkspaceDeletion,
  eraseCustomerData,
  requestWorkspaceDeletion,
  transferWorkspaceOwnership,
} from "./service";

function settingsPath(workspaceSlug: string): string {
  return `/app/${encodeURIComponent(workspaceSlug)}/settings`;
}

export async function requestWorkspaceDeletionAction(input: {
  workspaceSlug: string;
  reason?: string;
  /** Typed by the owner: the workspace name, checked here and not only in the UI. */
  confirmName: string;
}): Promise<ActionResult<{ purgeAfter: string }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      reason: z.string().trim().max(500).optional(),
      confirmName: z.string().trim().min(1, "Type the workspace name to confirm.").max(120),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the deletion request." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "workspace:delete",
  );
  if ("error" in authorized) return authorized.error;
  if (parsed.data.confirmName !== authorized.context.workspace.name) {
    return {
      ok: false,
      error: `Type "${authorized.context.workspace.name}" to confirm the deletion.`,
    };
  }

  const result = await requestWorkspaceDeletion({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    reason: parsed.data.reason,
  });
  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return { ok: true, data: { purgeAfter: result.purgeAfter.toISOString() } };
}

export async function cancelWorkspaceDeletionAction(input: {
  workspaceSlug: string;
}): Promise<ActionResult<{ cancelled: true }>> {
  const parsed = z.object({ workspaceSlug: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the workspace." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "workspace:delete",
  );
  if ("error" in authorized) return authorized.error;

  const cancelled = await cancelWorkspaceDeletion({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
  });
  if (!cancelled) return { ok: false, error: "No pending deletion was found." };

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return { ok: true, data: { cancelled: true } };
}

export async function transferOwnershipAction(input: {
  workspaceSlug: string;
  memberId: string;
  /** Typed by the owner: the workspace name, checked here and not only in the UI. */
  confirmName: string;
}): Promise<ActionResult<{ transferred: true }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      memberId: z.uuid(),
      confirmName: z.string().trim().min(1, "Type the workspace name to confirm.").max(120),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a teammate." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "member:manage",
  );
  if ("error" in authorized) return authorized.error;
  if (parsed.data.confirmName !== authorized.context.workspace.name) {
    return {
      ok: false,
      error: `Type "${authorized.context.workspace.name}" to confirm the transfer.`,
    };
  }

  const result = await transferWorkspaceOwnership({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    targetMemberId: parsed.data.memberId,
  });
  if (!result.ok) return result;

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return { ok: true, data: { transferred: true } };
}

/**
 * Erase one customer and the records that cascade from them. Owner-only: this
 * is a destructive privacy operation, not ordinary customer management.
 */
export async function eraseCustomerDataAction(input: {
  workspaceSlug: string;
  email: string;
}): Promise<ActionResult<{ deleted: boolean }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      email: z.email("Enter the customer's email address."),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the email." };
  }

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "workspace:delete",
  );
  if ("error" in authorized) return authorized.error;

  const result = await eraseCustomerData({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    email: parsed.data.email,
  });
  if (!result.deleted) return { ok: false, error: "No customer with that email was found." };

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return { ok: true, data: { deleted: true } };
}
