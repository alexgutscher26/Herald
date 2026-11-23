import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { trackPortalPageView } from "@/features/analytics/track";
import { getPublicSite } from "@/features/public/i18n/server";
import { publicRoadmapPath } from "@/features/public/paths";
import { getPublicRoadmapPage } from "@/features/public/roadmap";
import { PublicRoadmapView } from "@/features/public/roadmap-view";
import { getPublicViewer, getPublicViewerIdentity } from "@/features/public/viewer";

export const dynamic = "force-dynamic";

type Params = { workspaceSlug: string; productSlug: string; roadmapSlug: string };

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
    return { title: "Roadmap not found", robots: { index: false, follow: false } };
  }

  const site = await getPublicSite(page.workspace.slug);
  const path = publicRoadmapPath(
    page.workspace.slug,
    page.product.slug,
    page.roadmap.slug,
  );
  const title = `${page.roadmap.name} — ${page.product.name}`;
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

export default async function NamedPublicRoadmapPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const resolved = await params;
  const viewer = await getPublicViewer();
  const page = await getPublicRoadmapPage({
    ...resolved,
    viewerCustomerId: viewer?.customerId ?? null,
  });
  const identity = await getPublicViewerIdentity(resolved.workspaceSlug);

  if (!page) notFound();

  await trackPortalPageView({
    workspaceSlug: resolved.workspaceSlug,
    productSlug: resolved.productSlug,
    page: "roadmap",
  });

  return <PublicRoadmapView page={page} viewer={identity} />;
}
