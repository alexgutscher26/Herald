/**
 * Pure enterprise sign-in policy. Kept free of database and request imports so
 * the downgrade path can be unit-tested directly.
 */

export type SsoAccessDecision = "allow" | "sso_required";

export function ssoAccessDecision(input: {
  enforced: boolean;
  providerId: string | null;
  hasLinkedAccount: boolean;
}): SsoAccessDecision {
  // Enforcement without a provider cannot be satisfied, so it is treated as
  // off rather than locking every member out of the workspace.
  if (!input.enforced || !input.providerId) return "allow";
  return input.hasLinkedAccount ? "allow" : "sso_required";
}

/** SCIM may provision the three non-owner roles, never an owner. */
export function isScimAssignableRole(value: unknown): boolean {
  return value === "admin" || value === "editor" || value === "viewer";
}
