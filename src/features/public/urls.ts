/**
 * Absolute URLs for the public surface.
 *
 * Canonicals, Open Graph URLs, the sitemap and robots.txt all need a stable
 * origin. `BETTER_AUTH_URL` is already the deployment's canonical origin, so
 * reusing it avoids a second configuration that could disagree with the
 * auth callbacks. A missing or malformed value falls back to localhost rather
 * than throwing while a page is being rendered or a build is running.
 */

const FALLBACK_ORIGIN = "http://localhost:3000";

export function publicOrigin(): string {
  const raw = process.env.BETTER_AUTH_URL?.trim() ?? "";
  if (raw === "") return FALLBACK_ORIGIN;

  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : FALLBACK_ORIGIN;
  } catch {
    return FALLBACK_ORIGIN;
  }
}

/** Turn a site-relative path into the absolute URL metadata requires. */
export function absolutePublicUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return new URL(suffix, publicOrigin()).toString();
}
