import { getPublicChangelogPage } from "@/features/public/changelog";
import { getPublicSite } from "@/features/public/i18n/server";
import { OG_IMAGE_SIZE, publicOgImage } from "@/features/public/og-image";

/**
 * Open Graph image for the changelog list.
 *
 * Resolution uses the same published/public-channel projection as the page, so
 * a product with the changelog switched off answers 404 here as well instead
 * of advertising an empty or hidden feed.
 */

export const alt = "Public product changelog";
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

type Params = { workspaceSlug: string; productSlug: string };

export default async function Image({ params }: { params: Promise<Params> }) {
  const page = await getPublicChangelogPage(await params);
  if (!page) return new Response("Not found", { status: 404 });

  const site = await getPublicSite(page.workspace.slug);

  return publicOgImage({
    eyebrow: `${page.product.name} · Changelog`,
    title: site.t("meta.changelogTitle", { product: page.product.name }),
    description: site.t("meta.changelogDescription", {
      product: page.product.name,
      workspace: page.workspace.name,
    }),
    footer: site.brandName,
    accent: site.primaryColor,
  });
}
