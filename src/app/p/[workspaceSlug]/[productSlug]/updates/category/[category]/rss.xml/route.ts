import { changelogRssResponse } from "@/features/public/changelog-rss";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ workspaceSlug: string; productSlug: string; category: string }> },
) {
  const { workspaceSlug, productSlug, category } = await params;
  return changelogRssResponse({ workspaceSlug, productSlug, category });
}