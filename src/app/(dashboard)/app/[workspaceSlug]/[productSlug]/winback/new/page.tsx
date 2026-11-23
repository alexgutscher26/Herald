import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { releases } from "@/db/schema/releases";
import { checkWorkspaceFeature } from "@/features/entitlements/entitlements";
import { getSenderIdentity, senderIdentityProblem } from "@/features/email/identity";
import { listSegmentOptions } from "@/features/segments/service";
import { NewCampaignView } from "@/features/winback/new-campaign-view";
import { getWinbackAudience } from "@/features/winback/service";
import { resolveProductPage } from "@/lib/product-page";

export const metadata = {
  title: "New win-back campaign",
};

export default async function NewCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{ releaseId?: string; name?: string }>;
}) {
    const query = await searchParams;
  const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "winback:manage");

  const [releaseRows, audience, sender, feature, segments] = await Promise.all([
    db
      .select({ id: releases.id, title: releases.title, status: releases.status })
      .from(releases)
      .where(eq(releases.productId, context.product.id))
      .orderBy(desc(releases.createdAt))
      .limit(100),
    getWinbackAudience({
      workspaceId: context.workspace.id,
      productId: context.product.id,
    }),
    getSenderIdentity(context.workspace.id),
    checkWorkspaceFeature(context.workspace.id, "winback"),
    listSegmentOptions(context.product.id),
  ]);

  const initialReleaseId = releaseRows.some((release) => release.id === query.releaseId)
    ? (query.releaseId ?? "")
    : "";

  return (
    <NewCampaignView
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      releases={releaseRows}
      segments={segments}
      audience={audience.counts}
      allowed={feature.allowed}
      senderProblem={senderIdentityProblem(sender)}
      initialName={query.name?.slice(0, 160) ?? ""}
      initialReleaseId={initialReleaseId}
    />
  );
}
