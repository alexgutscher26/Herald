import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { trackPortalPageView } from "@/features/analytics/track";
import { getPublicChangelogPage } from "@/features/public/changelog";
import { PublicChangelogView } from "@/features/public/changelog-view";
import { getPublicSite } from "@/features/public/i18n/server";
import {
  publicChangelogCategoryPath,
  publicChangelogCategoryRssPath,
} from "@/features/public/paths";
import { getPublicViewerIdentity } from "@/features/public/viewer";

/** Public changelog index filtered to one release category. */

export const dynamic = "force-dynamic";

type Params = { workspaceSlug: string; productSlug: string; category: string };

const CATEGORY_LABEL_KEYS = {
  feature: "updates.category.feature",
  improvement: "updates.category.improvement",
  fix: "updates.category.fix",
} as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const resolved = await params;
  const page = await getPublicChangelogPage({ ...resolved, category: resolved.category });
  if (!page || page.filter?.kind !== "category") {
    return { title: "Category not found", robots: { index: false, follow: false } };
  }

  const site = await getPublicSite(page.workspace.slug);
  const path = publicChangelogCategoryPath(
    page.workspace.slug,
    page.product.slug,
    page.filter.category,
  );
  const title = site.t("updates.filterCategory", {
    category: site.t(CATEGORY_LABEL_KEYS[page.filter.category]),
  });
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
        "application/rss+xml": publicChangelogCategoryRssPath(
          page.workspace.slug,
          page.product.slug,
          page.filter.category,
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

export default async function PublicChangelogCategoryPage({
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
      category: resolved.category,
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