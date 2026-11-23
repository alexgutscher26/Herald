import { ModerationView } from "@/features/moderation/moderation-view";
import {
  getModerationCounts,
  getModerationQueue,
} from "@/features/moderation/queue";
import type { ModerationQueueStatus } from "@/features/moderation/types";
import { resolveProductPage } from "@/lib/product-page";
import { hasPermission } from "@/lib/permissions";

export const metadata = {
  title: "Moderation",
};

const STATUSES: ModerationQueueStatus[] = [
  "pending",
  "approved",
  "rejected",
  "all",
];

function readStatus(value: string | string[] | undefined): ModerationQueueStatus {
  const candidate = Array.isArray(value) ? value[0] : value;
  return STATUSES.includes(candidate as ModerationQueueStatus)
    ? (candidate as ModerationQueueStatus)
    : "pending";
}

export default async function ModerationPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
    const status = readStatus((await searchParams).status);

  const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "moderation:read");

  const [counts, items] = await Promise.all([
    getModerationCounts(context.product.id),
    getModerationQueue({
      productId: context.product.id,
      workspaceSlug,
      productSlug,
      status,
    }),
  ]);

  return (
    <ModerationView
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      status={status}
      counts={counts}
      items={items}
      canManage={hasPermission(context.role, "moderation:manage")}
    />
  );
}
