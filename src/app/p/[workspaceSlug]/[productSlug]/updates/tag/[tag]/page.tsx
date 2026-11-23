import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { trackPortalPageView } from "@/features/analytics/track";
import { getPublicChangelogPage } from "@/features/public/changelog";
import { PublicChangelogView } from "@/features/public/changelog-view";
import { getPublicSite } from "@/features/public/i18n/server";
import {
  publicChangelogTagPath,
  publicChangelogTagRssPath,
} from "@/features/public/paths";
import { getPublicViewerIdentity } from "@/features/public/viewer";

/** Public changelog index filtered to one release tag. */

export const dynamic = "force-dynamic";

type Params = { workspaceSlug: string; productSlug: string; tag: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const resolved = await params;
  const page = await getPublicChangelogPage({ ...resolved, tagSlug: resolved.tag });
  if (!page || page.filter?.kind !== "tag") {
    return { title: "Tag not found", robots: { index: false, follow: false } };
  }

  const site = await getPublicSite(page.workspace.slug);
  const path = publicChangelogTagPath(page.workspace.slug, page.product.slug, page.filter.tag.slug);
  const title = site.t("updates.filterTag", { tag: page.filter.tag.name });
  const description =
    page.product.description?.trim() ||
    site.t("meta.changelogDescription", {
      product: page.product.name,
      workspace: page.workspace.name,
    });

  return {
    title,
    description,
    alternates: {
      canonical: path,
      types: {
        "application/rss+xml": publicChangelogTagRssPath(
          page.workspace.slug,
          page.product.slug,
          page.filter.tag.slug,
        ),
      },
    },
    robots: { index: true, follow: true },
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

export default async function PublicChangelogTagPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [resolved, query] = await Promise.all([params, searchParams]);
  const requested = Number.parseInt(query.page ?? "1", 10);
  const [page, viewer] = await Promise.all([
    getPublicChangelogPage({
      ...resolved,
      tagSlug: resolved.tag,
      page: Number.isFinite(requested) ? requested : 1,
    }),
    getPublicViewerIdentity(resolved.workspaceSlug),
  ]);
  if (!page) notFound();

  await trackPortalPageView({
    workspaceSlug: resolved.workspaceSlug,
    productSlug: resolved.productSlug,
    page: "updates",
  });

  return <PublicChangelogView page={page} viewer={viewer} />;
}