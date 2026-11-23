import { changelogRssResponse } from "@/features/public/changelog-rss";

/**
 * RSS 2.0 feed for the public changelog.
 *
 * The same published/public-channel predicates as the pages apply. XML is
 * escaped rather than interpolated raw, and the feed is intentionally
 * short-lived at the edge so a newly published entry appears quickly.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceSlug: string; productSlug: string }> },
) {
  const { workspaceSlug, productSlug } = await params;
  return changelogRssResponse({ workspaceSlug, productSlug });
}
