import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicBoardView } from "@/features/public/board-view";
import { trackPublicView } from "@/features/analytics/track";
import { getPublicSite } from "@/features/public/i18n/server";
import { publicBoardPath } from "@/features/public/paths";
import {
  isFilteredPublicBoardQuery,
  parsePublicBoardQuery,
  type RawPublicBoardQuery,
} from "@/features/public/query";
import { getPublicBoardPageForRequest } from "@/features/public/queries";
import { getPublicViewer, getPublicViewerIdentity } from "@/features/public/viewer";

/**
 * Public board page.
 *
 * The page is resolved from the database on every request: a moderation
 * decision, a ban or an archive must take effect immediately, and a cached
 * projection would keep serving content that is no longer public.
 */

export const dynamic = "force-dynamic";

type Params = { workspaceSlug: string; productSlug: string; boardSlug: string };

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<RawPublicBoardQuery>;
}): Promise<Metadata> {
  const resolved = await params;
  const query = parsePublicBoardQuery(await searchParams);
  const page = await getPublicBoardPageForRequest(resolved, query);

  if (!page) {
    return {
      title: "Board not found",
      robots: { index: false, follow: false },
    };
  }

  const path = publicBoardPath(
    page.workspace.slug,
    page.product.slug,
    page.board.slug,
  );
  // Filtered and paginated views are useful, but they are not the canonical
  // page and should not compete with it in an index.
  const filtered = isFilteredPublicBoardQuery(query);
  const site = await getPublicSite(page.workspace.slug);
  const description = (
    page.board.description ??
    site.t("meta.boardDescription", {
      product: page.product.name,
      workspace: page.workspace.name,
    })
  ).slice(0, 160);
  const title = `${page.board.name} — ${page.product.name}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    robots: filtered
      ? { index: false, follow: true }
      : { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: path,
      siteName: page.workspace.name,
      type: "website",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublicBoardPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<RawPublicBoardQuery>;
}) {
  const resolved = await params;
  const query = parsePublicBoardQuery(await searchParams);
  // The viewer is read first so a segment-gated board can decide with it; the
  // board query then skips its anonymous cache for signed-in visitors.
  const viewerSession = await getPublicViewer();
  const page = await getPublicBoardPageForRequest(
    resolved,
    query,
    viewerSession?.customerId ?? null,
  );
  const viewer = await getPublicViewerIdentity(resolved.workspaceSlug);

  if (!page) notFound();

  await trackPublicView({
    workspaceId: page.workspace.id,
    productId: page.product.id,
    boardId: page.board.id,
    type: "board_view",
  });

  return <PublicBoardView page={page} query={query} viewer={viewer} />;
}
