import { listBoardsForProduct } from "@/db/queries/boards";
import { listRoadmapManagement } from "@/features/roadmap/management";
import { RoadmapView } from "@/features/roadmap/roadmap-view";
import { resolveProductPage } from "@/lib/product-page";
import { hasPermission } from "@/lib/permissions";

export const metadata = {
  title: "Roadmap",
};

/**
 * The internal roadmap is a view of feedback status, not a second item model.
 * The page only loads the public-surface switches and the first public board;
 * cards come from the dashboard snapshot the product layout already provides.
 */
export default async function RoadmapPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
}) {
    const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "roadmap:read");
  const [boards, roadmaps] = await Promise.all([
    listBoardsForProduct(context.product.id),
    listRoadmapManagement(context.product.id),
  ]);
  const publicBoard = boards.find(
    (board) => board.archivedAt === null && board.visibility === "public",
  );

  return (
    <RoadmapView
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      publicFeedbackEnabled={context.product.publicFeedbackEnabled}
      publicRoadmapEnabled={context.product.publicRoadmapEnabled}
      publicChangelogEnabled={context.product.publicChangelogEnabled}
      publicShippedCounterEnabled={context.product.publicShippedCounterEnabled}
      canManage={hasPermission(context.role, "settings:manage")}
      publicBoardSlug={publicBoard?.slug ?? null}
      boards={boards.map((board) => ({
        id: board.id,
        name: board.name,
        slug: board.slug,
        visibility: board.visibility,
        archivedAt: board.archivedAt,
      }))}
      roadmaps={roadmaps}
    />
  );
}
