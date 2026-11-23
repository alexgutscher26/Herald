import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { trackPortalPageView } from "@/features/analytics/track";
import { getPublicChangelogEntry } from "@/features/public/changelog";
import { translatedRelease } from "@/features/i18n/content";
import { PublicChangelogEntryView } from "@/features/public/changelog-view";
import { recordCustomerReleaseView } from "@/features/releases/customer-views";
import { getPublicSite } from "@/features/public/i18n/server";
import { publicChangelogEntryPath } from "@/features/public/paths";
import { absolutePublicUrl } from "@/features/public/urls";
import {
  getPublicViewer,
  getPublicViewerIdentity,
} from "@/features/public/viewer";

/**
 * Public changelog detail.
 *
 * The entry is looked up by product and slug inside the published, public
 * channel, so a draft or another product's slug is the same 404. The viewer is
 * resolved separately because a linked request the viewer authored may still
 * be awaiting review.
 */

export const dynamic = "force-dynamic";

type Params = { workspaceSlug: string; productSlug: string; slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const resolved = await params;
  const page = await getPublicChangelogEntry(resolved);

  if (!page) {
    return {
      title: "Update not found",
      robots: { index: false, follow: false },
    };
  }

  const path = publicChangelogEntryPath(
    page.workspace.slug,
    page.product.slug,
    page.entry.slug,
  );
  const site = await getPublicSite(page.workspace.slug);
  const copy = translatedRelease(
    page.entry,
    site.locale,
    site.contentTranslationEnabled,
  );
  const title = copy.title;
  const description = copy.summary;
  const socialImage = page.entry.ogImageUrl
    ? absolutePublicUrl(page.entry.ogImageUrl)
    : null;

  return {
    title,
    description,
    alternates: { canonical: path },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: path,
      siteName: page.workspace.name,
      type: "article",
      publishedTime: page.entry.publishedAt,
      authors: page.entry.authors.map((author) => author.name),
      tags: page.entry.tags,
      images: socialImage ? [{ url: socialImage }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: socialImage ? [socialImage] : undefined,
    },
    other: { "article:section": page.entry.category },
  };
}

export default async function PublicChangelogEntryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const resolved = await params;
  const publicViewer = await getPublicViewer();
  const [page, viewer] = await Promise.all([
    getPublicChangelogEntry(resolved, publicViewer),
    getPublicViewerIdentity(resolved.workspaceSlug),
  ]);

  if (!page) notFound();

  await trackPortalPageView({
    workspaceSlug: resolved.workspaceSlug,
    productSlug: resolved.productSlug,
    page: "updates",
  });

  if (publicViewer && publicViewer.workspaceId === page.workspace.id) {
    await recordCustomerReleaseView({
      workspaceId: page.workspace.id,
      productId: page.product.id,
      customerId: publicViewer.customerId,
      releaseId: page.entry.id,
    });
  }

  return (
    <PublicChangelogEntryView
      page={page}
      path={publicChangelogEntryPath(
        page.workspace.slug,
        page.product.slug,
        page.entry.slug,
      )}
      viewer={viewer}
    />
  );
}
