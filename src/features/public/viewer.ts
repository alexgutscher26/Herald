import "server-only";

import { cookies } from "next/headers";

import { CUSTOMER_SESSION_COOKIE } from "@/features/customer-session/config";
import { findActiveCustomerSession } from "@/features/customer-session/session";

import { hasCompanyMembership } from "./privacy";
import type { PublicViewer } from "./queries";
import { resolvePublicWorkspace } from "./resolver";

/**
 * Resolve the public viewer for a server-rendered page.
 *
 * Returns `null` when there is no session. The cookie is workspace-agnostic,
 * so callers must compare `workspaceId` with the board they resolved; the
 * query layer does that before trusting the viewer id.
 */
export async function getPublicViewer(): Promise<PublicViewer | null> {
  const store = await cookies();
  const active = await findActiveCustomerSession(
    store.get(CUSTOMER_SESSION_COOKIE)?.value ?? null,
  );

  if (!active) return null;

  return {
    customerId: active.customer.id,
    workspaceId: active.session.workspaceId,
    identified: !active.session.guest && active.customer.email !== null,
    hasCompany: await hasCompanyMembership(active.customer.id),
  };
}

/** What the public header may show about the current visitor. */
export type PublicViewerIdentity = {
  name: string | null;
  email: string | null;
  guest: boolean;
  identified: boolean;
};

/**
 * Resolve the signed-in visitor for one public workspace.
 *
 * The session cookie is workspace-agnostic, so the workspace is resolved again
 * from the URL and the session is ignored when the two do not match. This is
 * what keeps a session from one workspace from showing a profile on another.
 */
export async function getPublicViewerIdentity(
  workspaceSlug: string,
): Promise<PublicViewerIdentity | null> {
  const store = await cookies();
  const active = await findActiveCustomerSession(
    store.get(CUSTOMER_SESSION_COOKIE)?.value ?? null,
  );
  if (!active) return null;

  const workspace = await resolvePublicWorkspace(workspaceSlug);
  if (!workspace || active.session.workspaceId !== workspace.id) return null;

  return {
    name: active.customer.name,
    email: active.customer.email,
    guest: active.session.guest,
    identified: !active.session.guest && active.customer.email !== null,
  };
}
