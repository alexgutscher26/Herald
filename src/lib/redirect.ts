/**
 * Post-authentication redirect handling.
 *
 * Anything that arrives from a query string is attacker-controlled until
 * proven otherwise, so we only ever send authenticated users back inside the
 * application itself. Protocol-relative URLs (`//evil.com`), backslash
 * variants, absolute URLs and control characters are all rejected.
 */

/** Where a signed-in user goes when no explicit destination is supplied. */
export const DEFAULT_AUTHENTICATED_PATH = "/app";

/** Only the authenticated application area is a valid return destination. */
const ALLOWED_PREFIXES = ["/app", "/invite", "/oauth/authorize"];

/** Control characters (incl. CR/LF used for header/URL smuggling). */
function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function safePostAuthRedirect(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_AUTHENTICATED_PATH;
  if (value.length === 0 || value.length > 1024) return DEFAULT_AUTHENTICATED_PATH;
  if (hasControlCharacters(value)) return DEFAULT_AUTHENTICATED_PATH;
  if (!value.startsWith("/")) return DEFAULT_AUTHENTICATED_PATH;
  if (value.startsWith("//") || value.startsWith("/\\")) return DEFAULT_AUTHENTICATED_PATH;
  if (value.includes("\\")) return DEFAULT_AUTHENTICATED_PATH;

  const isAllowed = ALLOWED_PREFIXES.some((prefix) => {
    // Compare the path component only, so `/app?tab=3` is allowed while
    // `/application` is not.
    const queryAt = value.search(/[?#]/);
    const pathOnly = queryAt === -1 ? value : value.slice(0, queryAt);
    return pathOnly === prefix || pathOnly.startsWith(`${prefix}/`);
  });
  if (!isAllowed) return DEFAULT_AUTHENTICATED_PATH;

  return value;
}

/** Encode a destination for use inside a `?redirect=` query parameter. */
export function withRedirectParam(path: string, destination: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}redirect=${encodeURIComponent(destination)}`;
}