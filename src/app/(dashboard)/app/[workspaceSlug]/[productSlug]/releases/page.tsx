import { ReleasesView } from "@/features/releases/releases-view";
import type { ReleaseStatus } from "@/types";

export const metadata = {
  title: "Releases",
};

const RELEASE_STATUSES: ReleaseStatus[] = ["draft", "scheduled", "published", "archived"];

export default async function ReleasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { workspaceSlug, productSlug } = await params;
  const { status } = await searchParams;
  const initialStatus =
    status && RELEASE_STATUSES.includes(status as ReleaseStatus)
      ? (status as ReleaseStatus)
      : "all";

  return (
    <ReleasesView
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      initialStatus={initialStatus}
    />
  );
}
