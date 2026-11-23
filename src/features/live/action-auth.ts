import "server-only";

import { actionFailure, type ActionFailure } from "@/lib/action-result";
import { requireProductContext, type ProductContext } from "@/lib/authz";
import { PermissionDeniedError, type Permission } from "@/lib/permissions";

import { assertSameOriginAction } from "./action-origin";

/**
 * Resolve an authorized product context for a server action.
 *
 * Authentication redirects and 404s are intentionally rethrown: Next.js owns
 * those control-flow signals. A denied permission is returned as a value so
 * the client can show a clear message instead of a 500.
 */
export async function authorizeProductAction(
  workspaceSlug: string,
  productSlug: string,
  permission: Permission,
): Promise<{ context: ProductContext } | { error: ActionFailure }> {
  await assertSameOriginAction();
  try {
    return {
      context: await requireProductContext(workspaceSlug, productSlug, permission),
    };
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return { error: actionFailure(error.message) };
    }
    throw error;
  }
}

export function actionError(error: unknown, fallback: string): ActionFailure {
  if (error instanceof PermissionDeniedError) {
    return actionFailure(error.message);
  }
  if (error instanceof Error && error.message.length > 0) {
    return actionFailure(error.message);
  }
  return actionFailure(fallback);
}
