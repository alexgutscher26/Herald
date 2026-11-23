/**
 * Parse a public Herald request URL without touching the database.
 *
 * Keeping this pure lets the Slack unfurl path and its tests agree on exactly
 * which links are eligible for a preview.
 */

export type HeraldRequestLink = {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string;
  requestId: string;
};

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseHeraldRequestUrl(
  raw: string,
  canonicalOrigin: string,
): HeraldRequestLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const origin = canonicalOrigin.replace(/\/+$/, "");
  if (url.origin !== origin) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 5 && segments.length !== 6) return null;
  if (segments[0] !== "p") return null;

  const [workspaceSlug, productSlug, boardSlug, maybeRequests, maybeRequestId] = segments
    .slice(1)
    .map(decode);
  if (!workspaceSlug || !productSlug || !boardSlug) return null;

  // Support the old `/board/requests/<id>` links generated before the canonical
  // public route was fixed, so previously shared Slack messages still unfurl.
  const requestId =
    segments.length === 6 && maybeRequests === "requests" ? maybeRequestId : maybeRequests;
  if (!requestId) return null;

  return { workspaceSlug, productSlug, boardSlug, requestId };
}
