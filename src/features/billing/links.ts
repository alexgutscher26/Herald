/**
 * Billing deep links shared by server actions and client toasts.
 *
 * A limit error that only says "upgrade" makes the operator hunt through
 * settings. Every plan-limit failure carries the same workspace-scoped anchor
 * so the toast can open the plan table directly.
 */

export function billingSettingsPath(workspaceSlug: string): string {
  return `/app/${encodeURIComponent(workspaceSlug)}/settings#billing`;
}

export function limitFailure(
  message: string,
  workspaceSlug: string,
  fieldErrors?: Record<string, string[]>,
): { ok: false; error: string; billingUrl: string; fieldErrors?: Record<string, string[]> } {
  return {
    ok: false,
    error: message,
    billingUrl: billingSettingsPath(workspaceSlug),
    ...(fieldErrors ? { fieldErrors } : {}),
  };
}