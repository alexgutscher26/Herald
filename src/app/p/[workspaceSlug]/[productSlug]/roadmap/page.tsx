import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { trackPortalPageView } from "@/features/analytics/track";
import { getPublicSite } from "@/features/public/i18n/server";
import { publicRoadmapPath } from "@/features/public/paths";
import { parsePublicRoadmapSort } from "@/features/public/query";
import { getPublicRoadmapPage } from "@/features/public/roadmap";
import { PublicRoadmapView } from "@/features/public/roadmap-view";
import { getPublicViewer, getPublicViewerIdentity } from "@/features/public/viewer";

/**
 * Public roadmap page.
 *
 * The page is resolved from the database on every request, so turning the
 * roadmap off, hiding a request or changing its status takes effect
 * immediately. The route is independent of a board: `/roadmap` is a static
 * segment and therefore wins over `[boardSlug]`.
 */

export const dynamic = "force-dynamic";

type Params = { workspaceSlug: string; productSlug: string };
type Search = { sort?: string | string[] };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const resolved = await params;
  const viewer = await getPublicViewer();
  const page = await getPublicRoadmapPage({
    ...resolved,
    viewerCustomerId: viewer?.customerId ?? null,
  });

  if (!page) {
    return {
      title: "Roadmap not found",
      robots: { index: false, follow: false },
    };
  }

  const site = await getPublicSite(page.workspace.slug);
  const path = publicRoadmapPath(
    page.workspace.slug,
    page.product.slug,
    page.roadmap.slug,
  );
  const title = page.roadmap.slug
    ? `${page.roadmap.name} — ${page.product.name}`
    : site.t("meta.roadmapTitle", { product: page.product.name });
  const description =
    page.roadmap.description?.trim() ||
    page.product.description?.trim() ||
    site.t("meta.roadmapDescription", {
      product: page.product.name,
      workspace: page.workspace.name,
    });

  return {
    title,
    description,
    alternates: { canonical: path },
    robots:
      page.roadmap.visibility === "public"
        ? { index: true, follow: true }
        : { index: false, follow: false },
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

export default async function PublicRoadmapPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const resolved = await params;
  const search = await searchParams;
  const sort = parsePublicRoadmapSort(search.sort);
  const viewerSession = await getPublicViewer();
  const [page, viewer] = await Promise.all([
    getPublicRoadmapPage({
      ...resolved,
      viewerCustomerId: viewerSession?.customerId ?? null,
      sort,
    }),
    getPublicViewerIdentity(resolved.workspaceSlug),
  ]);

  if (!page) notFound();

  await trackPortalPageView({
    workspaceSlug: resolved.workspaceSlug,
    productSlug: resolved.productSlug,
    page: "roadmap",
  });

  return <PublicRoadmapView page={page} viewer={viewer} />;
}
