import { SegmentsView } from "@/features/segments/segments-view";
import { listSegments } from "@/features/segments/service";
import { resolveProductPage } from "@/lib/product-page";
import { hasPermission } from "@/lib/permissions";

export const metadata = { title: "Segments" };

export default async function SegmentsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
}) {
    const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "subscriber:read");
  const segments = await listSegments({
    workspaceId: context.workspace.id,
    productId: context.product.id,
  });

  return (
    <SegmentsView
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      segments={segments}
      canWrite={hasPermission(context.role, "settings:manage")}
    />
  );
}
