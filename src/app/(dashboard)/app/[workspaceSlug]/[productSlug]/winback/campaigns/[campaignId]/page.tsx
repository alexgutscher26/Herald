import { notFound } from "next/navigation";

import { checkWorkspaceFeature } from "@/features/entitlements/entitlements";
import { CampaignDetailView } from "@/features/winback/campaign-detail-view";
import { getCampaignDetail } from "@/features/winback/service";
import { requireProductContext } from "@/lib/authz";
import { hasPermission } from "@/lib/permissions";

export const metadata = {
  title: "Campaign",
};

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string; campaignId: string }>;
}) {
  const { workspaceSlug, productSlug, campaignId } = await params;
  const context = await requireProductContext(workspaceSlug, productSlug, "winback:read");

  const [detail, feature] = await Promise.all([
    getCampaignDetail({
      workspaceId: context.workspace.id,
      productId: context.product.id,
      campaignId,
    }),
    checkWorkspaceFeature(context.workspace.id, "winback"),
  ]);
  if (!detail) notFound();

  return (
    <CampaignDetailView
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      detail={detail}
      canManage={hasPermission(context.role, "winback:manage")}
      canApprove={hasPermission(context.role, "winback:approve")}
      allowed={feature.allowed}
      testEmail={context.user.email}
    />
  );
}
