import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { boards } from "@/db/schema/boards";
import { FeedbackView } from "@/features/feedback/feedback-view";
import { resolveProductPage } from "@/lib/product-page";

export const metadata = {
  title: "Feedback",
};

export default async function FeedbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{ post?: string }>;
}) {
    const { post } = await searchParams;

  const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "feedback:read");
  const boardOptions = await db
    .select({ id: boards.id, name: boards.name })
    .from(boards)
    .where(
      and(eq(boards.productId, context.product.id), isNull(boards.archivedAt)),
    )
    .orderBy(asc(boards.name));

  return (
    <FeedbackView
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      initialPostId={post}
      boards={boardOptions}
    />
  );
}
