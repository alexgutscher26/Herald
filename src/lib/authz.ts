import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { isEnterpriseSsoRequired } from "@/db/queries/enterprise";
import { findMembershipBySlug, findProductInWorkspace } from "@/db/queries/workspaces";
import type { Product, Workspace } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import {
  permissionsFor,
  requireEffectivePermission,
  type Permission,
  type WorkspaceRole,
} from "@/lib/permissions";
import { DEFAULT_AUTHENTICATED_PATH, withRedirectParam } from "@/lib/redirect";

/**
 * Server-side authorization helpers.
 *
 * These are the only sanctioned way to turn a URL parameter into an
 * authorized workspace/product context. They are called from layouts, pages,
 * server actions and route handlers — never from client components, and never
 * from middleware/proxy alone.
 *
 * Order of operations for every helper:
 *   1. authenticate the session,
 *   2. resolve membership from the database using the user's own id,
 *   3. resolve the product *within that workspace*,
 *   4. assert the permission the caller actually needs (a denied permission
 *      raises `PermissionDeniedError`, rendered as a 403 by the dashboard
 *      error boundary).
 *
 * Unknown workspaces and products return 404 rather than 403 so that
 * membership in another tenant is never disclosed.
 */

export type AuthedUser = {
  id: string;
  name: string;
  email: string;
};

/** Read the session without redirecting. Returns `null` when signed out. */
export async function getSessionUser(): Promise<AuthedUser | null> {
  // Read the request headers *first*: this is the dynamic API that tells
  // Next.js this route cannot be statically prerendered. Initialising
  // Better Auth (which reads environment configuration) before it would make
  // a build without env vars fail at prerender time instead of at request
  // time, which is the wrong place to report a runtime configuration error.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  const user = session?.user;
  if (!user?.id) return null;
  return { id: user.id, name: user.name, email: user.email };
}

/**
 * Require an authenticated user, or send them to the sign-in page.
 * The return destination is hard-coded to `/app`, never derived from input.
 */
export async function requireUser(): Promise<AuthedUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect(withRedirectParam("/sign-in", DEFAULT_AUTHENTICATED_PATH));
  }
  return user;
}

export type WorkspaceContext = {
  user: AuthedUser;
  workspace: Workspace;
  role: WorkspaceRole;
  /** Base role ∪ assigned custom role, resolved from the database. */
  permissions: readonly Permission[];
  customRoleId: string | null;
  customRoleName: string | null;
};

/**
 * An enforced-SSO workspace admits only sessions linked to its SAML provider.
 * Existing sessions are not destroyed; they are redirected to sign-in, where
 * the SSO button completes the upgrade. Turning enforcement off restores the
 * password path immediately.
 */
async function assertEnterpriseAccess(
  workspaceId: string,
  userId: string,
  destination: string,
): Promise<void> {
  if (await isEnterpriseSsoRequired(workspaceId, userId)) {
    redirect(withRedirectParam("/sign-in?sso=required", destination));
  }
}

/** Resolve an authorized workspace context from a URL slug. */
export async function requireWorkspaceContext(
  workspaceSlug: string,
  permission?: Permission,
): Promise<WorkspaceContext> {
  const user = await requireUser();
  const membership = await findMembershipBySlug(workspaceSlug, user.id);
  if (!membership) notFound();

  const role = membership.role as WorkspaceRole;
  const permissions =
    membership.effectivePermissions ?? permissionsFor(role);
  requireEffectivePermission(role, permissions, "workspace:read");

  await assertEnterpriseAccess(
    membership.workspace.id,
    user.id,
    `/app/${encodeURIComponent(workspaceSlug)}`,
  );

  if (permission) requireEffectivePermission(role, permissions, permission);

  return {
    user,
    workspace: membership.workspace,
    role,
    permissions,
    customRoleId: membership.customRoleId ?? null,
    customRoleName: membership.customRoleName ?? null,
  };
}

export type ProductContext = WorkspaceContext & {
  product: Product;
};

/**
 * Resolve an authorized product context from URL params.
 *
 * @param permission optional permission the calling page/action requires.
 *                   When supplied and denied, throws `PermissionDeniedError`.
 */
export async function requireProductContext(
  workspaceSlug: string,
  productSlug: string,
  permission?: Permission,
): Promise<ProductContext> {
  const user = await requireUser();

  const membership = await findMembershipBySlug(workspaceSlug, user.id);
  if (!membership) notFound();

  const role = membership.role as WorkspaceRole;
  const permissions =
    membership.effectivePermissions ?? permissionsFor(role);
  requireEffectivePermission(role, permissions, "workspace:read");

  const product = await findProductInWorkspace(membership.workspace.id, productSlug);
  if (!product) notFound();

  await assertEnterpriseAccess(
    membership.workspace.id,
    user.id,
    `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(productSlug)}`,
  );

  if (permission) requireEffectivePermission(role, permissions, permission);

  return {
    user,
    workspace: membership.workspace,
    role,
    permissions,
    customRoleId: membership.customRoleId ?? null,
    customRoleName: membership.customRoleName ?? null,
    product,
  };
}

// Cross-record tenant checks (assertSameProduct / assertSameWorkspace) live in
// `@/lib/tenancy`, which stays pure so it can be unit-tested without a request
// context. Server code should call them before writing any join table row.