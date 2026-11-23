import { z } from "zod";

import { getPublicSite } from "@/features/public/i18n/server";
import { OG_IMAGE_SIZE, publicOgImage } from "@/features/public/og-image";
import { PUBLIC_STATUS_LABELS } from "@/features/public/presentation";
import { getPublicRequestPage } from "@/features/public/queries";

/**
 * Open Graph image for one request.
 *
 * The image is generated from the same anonymous projection as the page, so a
 * pending, rejected, hidden or merged request never appears in a link preview.
 */

export const alt = "Public feedback request";
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

type Params = {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string;
  requestId: string;
};

const uuidSchema = z.uuid();

export default async function Image({ params }: { params: Promise<Params> }) {
  const resolved = await params;
  if (!uuidSchema.safeParse(resolved.requestId).success) {
    return new Response("Not found", { status: 404 });
  }

  const page = await getPublicRequestPage(resolved, null);
  if (!page) return new Response("Not found", { status: 404 });

  const site = await getPublicSite(page.workspace.slug);
  const status = site.t(PUBLIC_STATUS_LABELS[page.request.status]);

  return publicOgImage({
    eyebrow: `${page.board.name} · ${status}`,
    title: page.request.title,
    description: page.request.body,
    footer: site.brandName,
    accent: site.primaryColor,
  });
}
