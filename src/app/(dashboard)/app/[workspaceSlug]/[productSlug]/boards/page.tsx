import { listBoardsForProduct } from "@/db/queries/boards";
import { BoardsView } from "@/features/boards/boards-view";
import { checkBoardLimit } from "@/features/entitlements/entitlements";
import { requireProductContext } from "@/lib/authz";
import { hasPermission } from "@/lib/permissions";

export const metadata = {
  title: "Boards",
};

/**
 * Board management.
 *
 * Every member can read the boards so the navigation never leads to a dead
 * end. Writes require `settings:manage`, which the view uses to disable its
 * controls; the limit shown here comes from the same server gate the create
 * action uses, so the button state is a courtesy, not the enforcement.
 */
export default async function BoardsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
}) {
  const { workspaceSlug, productSlug } = await params;
  const context = await requireProductContext(workspaceSlug, productSlug);

  const [boards, limit] = await Promise.all([
    listBoardsForProduct(context.product.id),
    checkBoardLimit(context.product.id, 1),
  ]);

  return (
    <BoardsView
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      boards={boards}
      canManage={hasPermission(context.role, "settings:manage")}
      limit={{
        allowed: limit.allowed,
        current: limit.current,
        limit: limit.limit,
        plan: limit.plan,
      }}
    />
  );
}
