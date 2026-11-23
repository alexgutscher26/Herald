import "server-only";

import {
  createCustomerSession,
  mergeGuestCustomer,
  revokeCustomerSession,
  toCustomerSessionView,
  type ActiveCustomerSession,
  type CustomerSessionView,
} from "@/features/customer-session/session";
import { isValidEmail } from "@/lib/email";

import { resolveCustomerIdentity } from "./customers";
import { workspaceHasFeature } from "@/features/entitlements/entitlements";

import { getSsoRuntimeSettings } from "./identity-settings";
import { parseCustomerIdentity, verifyHs256Jwt } from "./jwt";

/**
 * Signed identity (SSO) for public pages and the widget.
 *
 * The token is verified with the workspace's own secret before any database
 * read. A disabled configuration, a wrong secret, an unsupported algorithm, an
 * expired token or a missing claim all fail closed. The identity is then merged
 * onto an existing guest session in the same workspace, so signing in never
 * forks the visitor's history.
 */

export type SsoIdentifyResult =
  | {
      ok: true;
      customerId: string;
      cookieValue: string;
      session: CustomerSessionView;
    }
  | { ok: false; reason: "disabled" | "invalid" | "banned" | "conflict" };

export async function identifyWithSso(input: {
  workspace: { id: string; slug: string };
  token: string;
  activeSession: ActiveCustomerSession | null;
}): Promise<SsoIdentifyResult> {
  const token = input.token.trim();
  if (token.length === 0 || token.length > 8192) {
    return { ok: false, reason: "invalid" };
  }

  const [settings, ssoEntitled] = await Promise.all([
    getSsoRuntimeSettings(input.workspace.id, input.workspace.slug),
    workspaceHasFeature(input.workspace.id, "sso"),
  ]);
  if (!ssoEntitled || !settings.enabled || settings.secrets.length === 0) {
    return { ok: false, reason: "disabled" };
  }

  // During a rotation the outgoing secret still verifies, so a token minted
  // moments before the change is not rejected while the app redeploys.
  let verified: ReturnType<typeof verifyHs256Jwt> | null = null;
  for (const secret of settings.secrets) {
    const attempt = verifyHs256Jwt({
      token,
      secret,
      issuer: settings.issuer,
      audience: settings.audience,
    });
    if (attempt.ok) {
      verified = attempt;
      break;
    }
  }
  if (!verified || !verified.ok) return { ok: false, reason: "invalid" };

  const identity = parseCustomerIdentity(verified.payload);
  if (identity.email !== null && !isValidEmail(identity.email)) {
    return { ok: false, reason: "invalid" };
  }

  const resolved = await resolveCustomerIdentity(input.workspace.id, {
    externalId: identity.subject,
    email: identity.email,
    name: identity.name,
    avatarUrl: identity.avatarUrl,
    traits: identity.traits,
    companies: identity.companies,
    verifyEmail: true,
  });

  if (!resolved.ok) return { ok: false, reason: resolved.reason };

  const active =
    input.activeSession?.session.workspaceId === input.workspace.id
      ? input.activeSession
      : null;

  if (
    active &&
    active.session.guest &&
    active.customer.id !== resolved.customer.id
  ) {
    await mergeGuestCustomer({
      guestCustomerId: active.customer.id,
      targetCustomerId: resolved.customer.id,
      workspaceId: input.workspace.id,
    });
  } else if (active) {
    // Rotate on privilege change: the previous session must not stay valid.
    await revokeCustomerSession(active.session.id).catch(() => {});
  }

  const session = await createCustomerSession({
    workspaceId: input.workspace.id,
    customerId: resolved.customer.id,
  });
  if (!session) return { ok: false, reason: "banned" };

  return {
    ok: true,
    customerId: resolved.customer.id,
    cookieValue: session.cookieValue,
    session: toCustomerSessionView(session.active),
  };
}
