import { db } from "@/db";
import { SpamRulesView } from "@/features/conversations/spam-rules-view";
import { listSpamFeedback, loadSpamRules } from "@/features/conversations/spam-settings";
import { resolveProductPage } from "@/lib/product-page";

export const metadata = {
  title: "Spam rules",
};

export default async function SpamRulesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
}) {
    const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "conversation:read");
  const [rules, feedback] = await Promise.all([
    loadSpamRules(db, context.product.id),
    listSpamFeedback(context.product.id),
  ]);

  return (
    <SpamRulesView
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      initialRules={rules}
      feedback={feedback}
    />
  );
}
