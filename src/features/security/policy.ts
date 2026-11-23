/**
 * Response security headers.
 *
 * Two policies are sent on every response:
 *
 * - `Content-Security-Policy` carries only directives that cannot break a
 *   render (`base-uri`, `object-src`, `frame-ancestors`). It is enforced today.
 * - `Content-Security-Policy-Report-Only` carries the full fetch policy,
 *   including `script-src` and `style-src` with the allowances the app still
 *   needs. It reports instead of blocking, so it can be tightened against real
 *   console reports before it is promoted.
 *
 * `permissionsPolicy` denies the device features the app never uses and keeps
 * screen capture to the two routes that render the screenshot annotator.
 *
 * The framing decision is per route, not global: the widget embed is the only
 * surface a customer's site may frame, and only from that workspace's allowed
 * origins. Everything else refuses framing outright.
 *
 * Kept free of framework and database imports so the proxy, the embed lookup
 * and tests share one interpretation of the policy.
 */

/** Directives safe to enforce before the full policy is promoted. */
const ENFORCED_DIRECTIVES = ["base-uri 'self'", "object-src 'none'"] as const;

/** `frame-ancestors` for every route that is not the widget embed. */
export const NOT_FRAMEABLE = "'none'";

/**
 * `/p/{workspace}/{product}/embed[/...]` is the only frameable surface.
 *
 * Anything else — the dashboard, public boards, the changelog, API routes —
 * must refuse framing.
 */
export function isWidgetEmbedPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  return segments[0] === "p" && segments[3] === "embed";
}

/**
 * Origins allowed to frame an embed route.
 *
 * An unconfigured workspace (no settings row) or an empty allowlist means "any
 * origin", which is the same rule the embed gate applies, so the header never
 * disagrees with the page it protects. `'self'` keeps the dashboard's own
 * preview frame working.
 */
export function frameAncestorsForEmbed(
  allowedOrigins: readonly string[] | null,
): string {
  if (!allowedOrigins || allowedOrigins.length === 0) return "*";
  return ["'self'", ...allowedOrigins].join(" ");
}

/**
 * Paths where the screenshot annotator may ask for a screen capture.
 *
 * Two places render that form: the public submission page and the widget's
 * compose panel. Nothing else in the app calls `getDisplayMedia`, so every other
 * route denies the feature outright.
 */
export function allowsDisplayCapture(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "p") return false;
  if (segments[3] === "embed") return true;
  return segments[segments.length - 1] === "submit";
}

/**
 * Camera, microphone and geolocation are never used, so they are denied on
 * every response. Display capture is delegated only where a form asks for it;
 * in the widget that also needs the host page's `allow="display-capture"`, which
 * the loader sets on the iframe.
 */
export function permissionsPolicy(pathname: string): string {
  const displayCapture = allowsDisplayCapture(pathname)
    ? "display-capture=(self)"
    : "display-capture=()";
  return `camera=(), microphone=(), geolocation=(), ${displayCapture}`;
}

/** The enforcing policy: only directives that cannot block a legitimate load. */
export function contentSecurityPolicy(frameAncestors: string): string {
  return [...ENFORCED_DIRECTIVES, `frame-ancestors ${frameAncestors}`].join("; ");
}

/**
 * The full policy, observed only.
 *
 * `script-src` allows inline scripts because Next.js streams its bootstrap
 * inline; `style-src` allows inline styles because the UI sets style
 * attributes. Both are recorded rather than enforced until the report-only
 * period shows what a nonce-based policy would need.
 */
export function contentSecurityPolicyReportOnly(
  frameAncestors: string,
  options: { allowEval?: boolean } = {},
): string {
  const scriptSrc = ["'self'", "'unsafe-inline'"];
  if (options.allowEval) scriptSrc.push("'unsafe-eval'");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    // Release pages embed a privacy-enhanced YouTube player.
    "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "form-action 'self'",
    ...ENFORCED_DIRECTIVES,
    `frame-ancestors ${frameAncestors}`,
  ].join("; ");
}
