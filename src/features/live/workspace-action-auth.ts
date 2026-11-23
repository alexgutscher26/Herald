import "server-only";

import { actionFailure, type ActionFailure } from "@/lib/action-result";
import { requireWorkspaceContext, type WorkspaceContext } from "@/lib/authz";
import { PermissionDeniedError, type Permission } from "@/lib/permissions";

import { assertSameOriginAction } from "./action-origin";

/** Resolve an authorized workspace for a server action without leaking a 500. */
export async function authorizeWorkspaceAction(
  workspaceSlug: string,
  permission: Permission,
): Promise<{ context: WorkspaceContext } | { error: ActionFailure }> {
  await assertSameOriginAction();
  try {
    return { context: await requireWorkspaceContext(workspaceSlug, permission) };
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return { error: actionFailure(error.message) };
    }
    throw error;
  }
}
