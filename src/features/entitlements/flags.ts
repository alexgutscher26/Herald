/**
 * Deployment feature flags.
 *
 * A flag is a kill switch for a whole deployment; a plan entitlement is a
 * per-workspace permission. They are separate on purpose: turning the widget
 * off everywhere must not require editing every workspace's plan.
 *
 * Flags are read from the environment on each call (no module-level cache) so
 * tests can vary them and a bad value falls back instead of throwing. Only the
 * server reads them; nothing here is exposed to the browser.
 */

export const FEATURE_FLAGS = ["public_feedback", "widget", "api"] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export const FLAG_ENV_KEYS: Record<FeatureFlag, string> = {
  public_feedback: "FLAG_PUBLIC_FEEDBACK",
  widget: "FLAG_WIDGET",
  api: "FLAG_API",
};

/**
 * Defaults describe what this repository actually ships:
 *  - public feedback is live and tested,
 *  - the widget loader, panels and install page are live,
 *  - the REST API is built but off until an operator opts in; MCP is not built.
 */
export const FLAG_DEFAULTS: Record<FeatureFlag, boolean> = {
  public_feedback: true,
  widget: true,
  api: false,
};

const TRUE_VALUES = new Set(["1", "true", "on", "yes", "enabled"]);
const FALSE_VALUES = new Set(["0", "false", "off", "no", "disabled"]);

/** Parse one flag value. Anything unrecognised keeps the default. */
export function parseFlag(value: string | undefined | null, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return fallback;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return fallback;
}

export type FlagEnvironment = Record<string, string | undefined>;

export function resolveFlag(
  flag: FeatureFlag,
  env: FlagEnvironment = process.env,
): boolean {
  return parseFlag(env[FLAG_ENV_KEYS[flag]], FLAG_DEFAULTS[flag]);
}

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return resolveFlag(flag);
}

/** Every flag and its effective value. Useful for diagnostics, never for auth. */
export function resolvedFlags(env: FlagEnvironment = process.env): Record<FeatureFlag, boolean> {
  return {
    public_feedback: resolveFlag("public_feedback", env),
    widget: resolveFlag("widget", env),
    api: resolveFlag("api", env),
  };
}
