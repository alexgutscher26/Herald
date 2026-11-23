import { publicSurfaceEnabled } from "@/features/entitlements/entitlements";
import { getPublicSite } from "@/features/public/i18n/server";
import { OG_IMAGE_SIZE, publicOgImage } from "@/features/public/og-image";
import { resolvePublicBoard } from "@/features/public/resolver";

/**
 * Open Graph image for a board.
 *
 * Resolution uses the same visibility predicate as the page, so a private or
 * archived board answers 404 here as well rather than leaking its name into a
 * link preview.
 */

export const alt = "Public feedback board";
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

type Params = { workspaceSlug: string; productSlug: string; boardSlug: string };

export default async function Image({ params }: { params: Promise<Params> }) {
  const resolved = await params;
  const tenant = await resolvePublicBoard(resolved);
  if (!tenant || !publicSurfaceEnabled(tenant.workspace.plan)) {
    return new Response("Not found", { status: 404 });
  }

  const site = await getPublicSite(tenant.workspace.slug);
  const description =
    tenant.board.description ??
    site.t("meta.boardDescription", {
      product: tenant.product.name,
      workspace: tenant.workspace.name,
    });

  return publicOgImage({
    eyebrow: tenant.product.name,
    title: tenant.board.name,
    description,
    footer: site.brandName,
    accent: site.primaryColor,
  });
}
