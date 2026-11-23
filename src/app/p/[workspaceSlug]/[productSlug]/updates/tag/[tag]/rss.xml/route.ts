import { changelogRssResponse } from "@/features/public/changelog-rss";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceSlug: string; productSlug: string; tag: string }> },
) {
  const { workspaceSlug, productSlug, tag } = await params;
  return changelogRssResponse({ workspaceSlug, productSlug, tagSlug: tag });
}