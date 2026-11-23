import "server-only";

import { NextResponse } from "next/server";

import { isEnterpriseSsoRequired } from "@/db/queries/enterprise";
import { findMembershipBySlug, findProductInWorkspace } from "@/db/queries/workspaces";
import type { Product, Workspace } from "@/db/schema";
import { isSameOriginRequest } from "@/features/customer-session/origin";
import { getSessionUser, type AuthedUser } from "@/lib/authz";
import {
  permissionsFor,
  type Permission,
  type WorkspaceRole,
} from "@/lib/permissions";

/**
 * Authorization for dashboard route handlers.
 *
 * Pages and server actions use `requireProductContext`, which redirects and
 * renders 404/403 boundaries. A route handler must not redirect a fetch to an
 * HTML sign-in page, so this helper returns the same outcomes as JSON. Unknown
 * workspaces and products are indistinguishable 404s.
 */

export type AppApiContext = {
  user: AuthedUser;
  workspace: Workspace;
  product: Product;
  role: WorkspaceRole;
  permissions: readonly Permission[];
};

export type AppApiAuthorization =
  | { ok: true; context: AppApiContext }
  | { ok: false; response: NextResponse };

const NO_STORE = { "cache-control": "private, no-store" } as const;

function failure(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export type WorkspaceApiAuthorization =
  | { ok: true; user: AuthedUser; workspace: Workspace; role: WorkspaceRole }
  | { ok: false; response: NextResponse };

/**
 * Authorize a workspace-level dashboard route.
 *
 * Token management lives at `/api/app/{workspace}/api-tokens`, outside a
 * product. It resolves membership from the session's own user id and checks
 * the permission on the server, exactly like the product helper.
 */
export async function authorizeWorkspaceApi(input: {
  request: Request;
  workspaceSlug: string;
  permission: Permission;
  mutation?: boolean;
}): Promise<WorkspaceApiAuthorization> {
  if (input.mutation) {
    const expectedOrigin = new URL(input.request.url).origin;
    const sameOrigin = isSameOriginRequest({
      origin: input.request.headers.get("origin"),
      secFetchSite: input.request.headers.get("sec-fetch-site"),
      expectedOrigin,
    });
    if (!sameOrigin) {
      return { ok: false, response: failure(403, "This request must come from the app.") };
    }
  }

  const user = await getSessionUser();
  if (!user) return { ok: false, response: failure(401, "Sign in to continue.") };

  const membership = await findMembershipBySlug(input.workspaceSlug, user.id);
  if (!membership) return { ok: false, response: failure(404, "Not found.") };

  if (await isEnterpriseSsoRequired(membership.workspace.id, user.id)) {
    return { ok: false, response: failure(403, "Sign in with single sign-on to continue.") };
  }

  const permissions = membership.effectivePermissions ?? permissionsFor(membership.role);
  if (!permissions.includes(input.permission)) {
    return { ok: false, response: failure(403, "You do not have permission to do that.") };
  }

  return {
    ok: true,
    user,
    workspace: membership.workspace,
    role: membership.role,
  };
}

export async function authorizeAppApi(input: {
  request: Request;
  workspaceSlug: string;
  productSlug: string;
  permission: Permission;
  mutation?: boolean;
}): Promise<AppApiAuthorization> {
  if (input.mutation) {
    const expectedOrigin = new URL(input.request.url).origin;
    const sameOrigin = isSameOriginRequest({
      origin: input.request.headers.get("origin"),
      secFetchSite: input.request.headers.get("sec-fetch-site"),
      expectedOrigin,
    });
    if (!sameOrigin) {
      return { ok: false, response: failure(403, "This request must come from the app.") };
    }
  }

  const user = await getSessionUser();
  if (!user) return { ok: false, response: failure(401, "Sign in to continue.") };

  const membership = await findMembershipBySlug(input.workspaceSlug, user.id);
  if (!membership) return { ok: false, response: failure(404, "Not found.") };

  if (await isEnterpriseSsoRequired(membership.workspace.id, user.id)) {
    return { ok: false, response: failure(403, "Sign in with single sign-on to continue.") };
  }

  const product = await findProductInWorkspace(membership.workspace.id, input.productSlug);
  if (!product) return { ok: false, response: failure(404, "Not found.") };

  const permissions = membership.effectivePermissions ?? permissionsFor(membership.role);
  if (!permissions.includes(input.permission)) {
    return { ok: false, response: failure(403, "You do not have permission to do that.") };
  }

  return {
    ok: true,
    context: {
      user,
      workspace: membership.workspace,
      product,
      role: membership.role,
      permissions,
    },
  };
}
