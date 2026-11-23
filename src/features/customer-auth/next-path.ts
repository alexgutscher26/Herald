/**
 * Post-sign-in destination.
 *
 * The only acceptable value is a same-site public path. Absolute URLs,
 * protocol-relative paths, backslashes and control characters are rejected so
 * a crafted `next` parameter cannot turn sign-in into an open redirect.
 */
export function sanitizeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 500) return null;
  if (!trimmed.startsWith("/p/") || trimmed.startsWith("//")) return null;
  if (/[\\\u0000-\u001f]/.test(trimmed)) return null;
  return trimmed;
}
