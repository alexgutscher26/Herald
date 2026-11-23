import { DuplicateReviewView } from "@/features/juno/duplicate-review-view";
import { listDuplicateReviews } from "@/features/juno/duplicate-review";
import { resolveProductPage } from "@/lib/product-page";
import { hasPermission } from "@/lib/permissions";

export const metadata = {
  title: "Duplicate triage",
};

export default async function DuplicateTriagePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
    const query = await searchParams;

  const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "feedback:read");
  const reviews = await listDuplicateReviews(context.product.id);

  return (
    <DuplicateReviewView
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      reviews={reviews}
      canWrite={hasPermission(context.role, "feedback:write")}
      saved={query.saved}
      error={query.error}
    />
  );
}
