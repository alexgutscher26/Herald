import { checkWorkspaceFeature } from "@/features/entitlements/entitlements";
import { getSenderIdentity, senderIdentityProblem } from "@/features/email/identity";
import {
  getCancellationReasonPerformance,
  listWinbackOpportunities,
} from "@/features/winback/opportunities";
import { getWinbackOverview } from "@/features/winback/service";
import { listWinbackSuggestions } from "@/features/winback/suggestions";
import { WinbackView } from "@/features/winback/winback-view";
import { resolveProductPage } from "@/lib/product-page";
import { hasPermission } from "@/lib/permissions";

export const metadata = {
  title: "Win-back",
};

export default async function WinbackPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
}) {
    const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "winback:read");

  const [overview, sender, feature, opportunities, reasons, suggestions] = await Promise.all([
    getWinbackOverview({
      workspaceId: context.workspace.id,
      productId: context.product.id,
    }),
    getSenderIdentity(context.workspace.id),
    checkWorkspaceFeature(context.workspace.id, "winback"),
    listWinbackOpportunities({
      workspaceId: context.workspace.id,
      productId: context.product.id,
    }),
    getCancellationReasonPerformance({
      workspaceId: context.workspace.id,
      productId: context.product.id,
    }),
    listWinbackSuggestions({
      workspaceId: context.workspace.id,
      productId: context.product.id,
    }),
  ]);

  return (
    <WinbackView
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      overview={overview}
      opportunities={opportunities}
      reasons={reasons}
      suggestions={suggestions}
      canManage={hasPermission(context.role, "winback:manage")}
      allowed={feature.allowed}
      senderProblem={senderIdentityProblem(sender)}
    />
  );
}
