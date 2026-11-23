/**
 * Path helpers for the public site.
 *
 * The launch site is path-based (`/p/{workspace}/{product}/{board}`); custom
 * domains resolve to the same tree later. Parsing is kept pure so route
 * handling and tests share one definition of a valid public path.
 */

export type PublicPath = {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string | null;
};

const PUBLIC_PREFIX = "p";

export function parsePublicPath(pathname: string): PublicPath | null {
  const path = pathname.split("?")[0]?.split("#")[0] ?? "";
  const segments = path.split("/").filter(Boolean);

  if (segments.length < 3 || segments.length > 4) return null;
  if (segments[0] !== PUBLIC_PREFIX) return null;

  const [, workspaceSlug, productSlug, boardSlug] = segments;
  if (!workspaceSlug || !productSlug) return null;
  if (boardSlug !== undefined && boardSlug.length === 0) return null;

  return { workspaceSlug, productSlug, boardSlug: boardSlug ?? null };
}

export function publicProductPath(workspaceSlug: string, productSlug: string): string {
  return `/${PUBLIC_PREFIX}/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(productSlug)}`;
}

export function publicLoginPath(
  workspaceSlug: string,
  productSlug: string,
): string {
  return `${publicProductPath(workspaceSlug, productSlug)}/login`;
}

export function publicRoadmapPath(
  workspaceSlug: string,
  productSlug: string,
  roadmapSlug?: string | null,
): string {
  const base = `${publicProductPath(workspaceSlug, productSlug)}/roadmap`;
  return roadmapSlug ? `${base}/${encodeURIComponent(roadmapSlug)}` : base;
}

export function publicLlmsPath(workspaceSlug: string, productSlug: string): string {
  return `${publicProductPath(workspaceSlug, productSlug)}/llms.txt`;
}

export function publicChangelogPath(workspaceSlug: string, productSlug: string): string {
  return `${publicProductPath(workspaceSlug, productSlug)}/updates`;
}

export function publicNotificationsPath(
  workspaceSlug: string,
  productSlug: string,
): string {
  return `${publicProductPath(workspaceSlug, productSlug)}/notifications`;
}

export function publicChangelogEntryPath(
  workspaceSlug: string,
  productSlug: string,
  slug: string,
): string {
  return `${publicChangelogPath(workspaceSlug, productSlug)}/${encodeURIComponent(slug)}`;
}

export function publicCsatPath(
  workspaceSlug: string,
  productSlug: string,
  conversationId: string,
): string {
  return `${publicProductPath(workspaceSlug, productSlug)}/csat/${encodeURIComponent(conversationId)}`;
}

export function publicChangelogRssPath(workspaceSlug: string, productSlug: string): string {
  return `${publicChangelogPath(workspaceSlug, productSlug)}/rss.xml`;
}

export function publicChangelogTagPath(
  workspaceSlug: string,
  productSlug: string,
  tagSlug: string,
): string {
  return `${publicChangelogPath(workspaceSlug, productSlug)}/tag/${encodeURIComponent(tagSlug)}`;
}

export function publicChangelogTagRssPath(
  workspaceSlug: string,
  productSlug: string,
  tagSlug: string,
): string {
  return `${publicChangelogTagPath(workspaceSlug, productSlug, tagSlug)}/rss.xml`;
}

export function publicChangelogCategoryPath(
  workspaceSlug: string,
  productSlug: string,
  category: string,
): string {
  return `${publicChangelogPath(workspaceSlug, productSlug)}/category/${encodeURIComponent(category)}`;
}

export function publicChangelogCategoryRssPath(
  workspaceSlug: string,
  productSlug: string,
  category: string,
): string {
  return `${publicChangelogCategoryPath(workspaceSlug, productSlug, category)}/rss.xml`;
}

export function publicBoardPath(
  workspaceSlug: string,
  productSlug: string,
  boardSlug: string,
): string {
  return `${publicProductPath(workspaceSlug, productSlug)}/${encodeURIComponent(boardSlug)}`;
}

export function publicRequestPath(
  workspaceSlug: string,
  productSlug: string,
  boardSlug: string,
  requestId: string,
): string {
  return `${publicBoardPath(workspaceSlug, productSlug, boardSlug)}/${encodeURIComponent(requestId)}`;
}

export function publicHelpPath(workspaceSlug: string, productSlug: string): string {
  return `${publicProductPath(workspaceSlug, productSlug)}/help`;
}

export function publicHelpCollectionPath(
  workspaceSlug: string,
  productSlug: string,
  collectionSlug: string,
): string {
  return `${publicHelpPath(workspaceSlug, productSlug)}/${encodeURIComponent(collectionSlug)}`;
}

export function publicHelpArticlePath(
  workspaceSlug: string,
  productSlug: string,
  collectionSlug: string,
  articleSlug: string,
): string {
  return `${publicHelpCollectionPath(workspaceSlug, productSlug, collectionSlug)}/${encodeURIComponent(articleSlug)}`;
}

export function publicApiDocsPath(workspaceSlug: string, productSlug: string): string {
  return `${publicProductPath(workspaceSlug, productSlug)}/docs/api`;
}

export function publicApiDocPath(
  workspaceSlug: string,
  productSlug: string,
  docSlug: string,
): string {
  return `${publicApiDocsPath(workspaceSlug, productSlug)}/${encodeURIComponent(docSlug)}`;
}

export function publicPreferencesPath(
  workspaceSlug: string,
  productSlug: string,
  token: string,
): string {
  return `${publicProductPath(workspaceSlug, productSlug)}/preferences?token=${encodeURIComponent(token)}`;
}

export function publicConfirmPath(
  workspaceSlug: string,
  productSlug: string,
  token: string,
): string {
  return `${publicProductPath(workspaceSlug, productSlug)}/confirm?token=${encodeURIComponent(
    token,
  )}`;
}

export function publicSubmitPath(
  workspaceSlug: string,
  productSlug: string,
  boardSlug: string,
): string {
  return `${publicBoardPath(workspaceSlug, productSlug, boardSlug)}/submit`;
}
