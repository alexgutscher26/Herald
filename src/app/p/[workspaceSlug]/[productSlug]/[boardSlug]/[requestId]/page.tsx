import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { z } from "zod";

import { publicRequestPath } from "@/features/public/paths";
import { trackPublicView } from "@/features/analytics/track";
import {
  getMergedRequestCanonicalId,
  getPublicRequestPage,
} from "@/features/public/queries";
import { PublicRequestView } from "@/features/public/request-view";
import { getPublicViewer, getPublicViewerIdentity } from "@/features/public/viewer";

/**
 * Public request detail.
 *
 * The page is resolved per request: a moderation decision, a ban, an archive
 * or a merge must take effect immediately. The viewer is only used to show
 * that author's own pending submission and own pending comments — it never
 * widens what anyone else can read.
 */

export const dynamic = "force-dynamic";

type Params = {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string;
  requestId: string;
};

const uuidSchema = z.uuid();

const SUBMITTED_STATES = ["published", "awaiting_review"] as const;
type SubmittedState = (typeof SUBMITTED_STATES)[number];

function readSubmitted(value: string | string[] | undefined): SubmittedState | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return SUBMITTED_STATES.includes(candidate as SubmittedState)
    ? (candidate as SubmittedState)
    : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const resolved = await params;
  if (!uuidSchema.safeParse(resolved.requestId).success) {
    return { title: "Request not found", robots: { index: false, follow: false } };
  }

  const viewer = await getPublicViewer();
  const page = await getPublicRequestPage(resolved, viewer);

  if (!page) {
    const canonicalId = await getMergedRequestCanonicalId(resolved);
    if (canonicalId) {
      permanentRedirect(
        publicRequestPath(
          resolved.workspaceSlug,
          resolved.productSlug,
          resolved.boardSlug,
          canonicalId,
        ),
      );
    }
    return { title: "Request not found", robots: { index: false, follow: false } };
  }

  const path = publicRequestPath(
    page.workspace.slug,
    page.product.slug,
    page.board.slug,
    page.request.id,
  );
  const description = page.request.body.replace(/\s+/g, " ").trim().slice(0, 160);
  const title = `${page.request.title} — ${page.board.name}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    robots:
      page.request.visibility === "awaiting_review"
        ? { index: false, follow: false }
        : undefined,
    openGraph: {
      title,
      description,
      url: path,
      siteName: page.workspace.name,
      type: "article",
      publishedTime: page.request.createdAt,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublicRequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ submitted?: string | string[] }>;
}) {
  const resolved = await params;
  if (!uuidSchema.safeParse(resolved.requestId).success) notFound();

  const [viewer, identity] = await Promise.all([
    getPublicViewer(),
    getPublicViewerIdentity(resolved.workspaceSlug),
  ]);
  const page = await getPublicRequestPage(resolved, viewer);
  if (!page) {
    const canonicalId = await getMergedRequestCanonicalId(resolved);
    if (canonicalId) {
      permanentRedirect(
        publicRequestPath(
          resolved.workspaceSlug,
          resolved.productSlug,
          resolved.boardSlug,
          canonicalId,
        ),
      );
    }
    notFound();
  }

  const query = await searchParams;

  await trackPublicView({
    workspaceId: page.workspace.id,
    productId: page.product.id,
    boardId: page.board.id,
    feedbackPostId: page.request.id,
    type: "request_view",
  });

  return (
    <PublicRequestView
      page={page}
      viewer={identity}
      path={publicRequestPath(
        page.workspace.slug,
        page.product.slug,
        page.board.slug,
        page.request.id,
      )}
      submitted={readSubmitted(query.submitted)}
    />
  );
}
