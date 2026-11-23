import { JunoAnswersView } from "@/features/juno/answers-view";
import {
  countLowConfidenceAnswers,
  listJunoAnswers,
  type AnswerInspectionFilter,
} from "@/features/juno/inspection";
import { resolveProductPage } from "@/lib/product-page";
import { hasPermission } from "@/lib/permissions";

export const metadata = {
  title: "Answer inspection",
};

const STATUSES = ["answered", "handoff", "skipped", "failed"] as const;

export default async function AnswerInspectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{
    low?: string;
    status?: string;
    saved?: string;
    error?: string;
  }>;
}) {
    const query = await searchParams;

  const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "juno:read");

  const status = STATUSES.includes(query.status as (typeof STATUSES)[number])
    ? (query.status as (typeof STATUSES)[number])
    : undefined;
  const filter: AnswerInspectionFilter = {
    lowConfidenceOnly: query.low === "1",
    ...(status ? { status } : {}),
  };

  const [inspection, lowConfidenceCount] = await Promise.all([
    listJunoAnswers({ productId: context.product.id, filter }),
    countLowConfidenceAnswers(context.product.id),
  ]);

  return (
    <JunoAnswersView
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      rows={inspection.rows}
      filter={filter}
      confidenceFloor={inspection.confidenceFloor}
      lowConfidenceThreshold={inspection.lowConfidenceThreshold}
      lowConfidenceCount={lowConfidenceCount}
      canManage={hasPermission(context.role, "juno:manage")}
      saved={query.saved}
      error={query.error}
    />
  );
}
