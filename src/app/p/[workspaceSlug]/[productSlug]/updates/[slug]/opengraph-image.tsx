import { getPublicChangelogEntry } from "@/features/public/changelog";
import { translatedRelease } from "@/features/i18n/content";
import { getPublicSite } from "@/features/public/i18n/server";
import { OG_IMAGE_SIZE, publicOgImage } from "@/features/public/og-image";
import { absolutePublicUrl } from "@/features/public/urls";

/**
 * Open Graph image for one changelog entry.
 *
 * The entry is read through the public projection, so a draft, a scheduled
 * release or an entry with the public channel off is a 404 here too. The body
 * is used only as a description fallback; the page itself still renders the
 * markdown.
 */

export const alt = "Public product update";
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

type Params = { workspaceSlug: string; productSlug: string; slug: string };

const CATEGORY_LABELS = {
  feature: "Feature",
  improvement: "Improvement",
  fix: "Fix",
} as const;

export default async function Image({ params }: { params: Promise<Params> }) {
  const page = await getPublicChangelogEntry(await params);
  if (!page) return new Response("Not found", { status: 404 });

  // An uploaded social image replaces the generated card, including when the
  // image route is requested directly rather than through the page metadata.
  if (page.entry.ogImageUrl) {
    return Response.redirect(absolutePublicUrl(page.entry.ogImageUrl), 302);
  }

  const site = await getPublicSite(page.workspace.slug);
  const copy = translatedRelease(
    page.entry,
    site.locale,
    site.contentTranslationEnabled,
  );
  const description =
    copy.summary.trim() === ""
      ? copy.body.replace(/[#>*_`]/g, " ").replace(/\s+/g, " ").trim()
      : copy.summary;

  return publicOgImage({
    eyebrow: `${page.product.name} · ${CATEGORY_LABELS[page.entry.category]}`,
    title: copy.title,
    description,
    footer: site.brandName,
    accent: site.primaryColor,
  });
}
