/**
 * YouTube URL parsing.
 *
 * The editor accepts watch, share, shorts and embed links. Only the video id
 * is ever used; the canonical URL is rebuilt so a stored value cannot point at
 * a lookalike host or carry tracking parameters into the public page.
 */

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

export function youTubeVideoId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (VIDEO_ID.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;

  if (url.hostname === "youtu.be" || url.hostname === "www.youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return VIDEO_ID.test(id) ? id : null;
  }

  const queryId = url.searchParams.get("v");
  if (queryId && VIDEO_ID.test(queryId)) return queryId;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] === "embed" || segments[0] === "shorts" || segments[0] === "live") {
    const id = segments[1] ?? "";
    return VIDEO_ID.test(id) ? id : null;
  }

  return null;
}

/** Store only the canonical watch URL, or null for an empty/foreign link. */
export function normalizeYouTubeUrl(value: string | null | undefined): string | null {
  const id = youTubeVideoId(value);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

/** A privacy-enhanced embed URL for the public changelog. */
export function youTubeEmbedUrl(value: string | null | undefined): string | null {
  const id = youTubeVideoId(value);
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}
