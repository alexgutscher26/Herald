import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { trackPortalPageView } from "@/features/analytics/track";
import { getPublicChangelogPage } from "@/features/public/changelog";
import { PublicChangelogView } from "@/features/public/changelog-view";
import { getPublicSite } from "@/features/public/i18n/server";
import { publicChangelogPath } from "@/features/public/paths";
import { getPublicViewerIdentity } from "@/features/public/viewer";

/**
 * Public changelog list.
 *
 * `/updates` is a static segment next to `[boardSlug]`, so a board cannot
 * shadow it. Every read is database-backed and gated by the product's
 * independent changelog switch.
 */

export const dynamic = "force-dynamic";

type Params = { workspaceSlug: string; productSlug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const resolved = await params;
  const page = await getPublicChangelogPage(resolved);

  if (!page) {
    return {
      title: "Changelog not found",
      robots: { index: false, follow: false },
    };
  }

  const site = await getPublicSite(page.workspace.slug);
  const path = publicChangelogPath(page.workspace.slug, page.product.slug);
  const title = site.t("meta.changelogTitle", { product: page.product.name });
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
        "application/rss+xml": `${path}/rss.xml`,
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

export default async function PublicChangelogPage({
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
