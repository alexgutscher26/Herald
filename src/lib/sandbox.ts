import { parseFlag } from "@/features/entitlements/flags";

/**
 * Deployment-wide sandbox switch.
 *
 * Sandbox mode keeps every write, outbox row and audit trail intact but refuses
 * to call out: no email reaches a provider and no webhook reaches a receiver.
 * It is a deployment setting, not a workspace preference, so a customer cannot
 * turn real sends back on.
 */
export const SANDBOX_ENV_KEY = "SANDBOX_MODE";

export function isSandboxMode(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return parseFlag(env[SANDBOX_ENV_KEY], false);
}
