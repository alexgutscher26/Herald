import { getWorkspacePlan } from "@/features/entitlements/entitlements";
import { OverviewView } from "@/features/overview/overview-view";
import { getSetupChecklist } from "@/features/overview/setup";
import { listWinbackOpportunities } from "@/features/winback/opportunities";
import { requireProductContext } from "@/lib/authz";

export const metadata = {
  title: "Overview",
};

const RANGES = [7, 30, 90] as const;

function parseDays(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return (RANGES as readonly number[]).includes(parsed) ? parsed : 30;
}

export default async function OverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const [{ workspaceSlug, productSlug }, query] = await Promise.all([params, searchParams]);
  const days = parseDays(query.days);
  const context = await requireProductContext(workspaceSlug, productSlug);

  const [setup, opportunities, plan] = await Promise.all([
    getSetupChecklist({
      workspaceId: context.workspace.id,
      workspaceSlug,
      productId: context.product.id,
      productSlug,
      productName: context.product.name,
    }),
    listWinbackOpportunities({
      workspaceId: context.workspace.id,
      productId: context.product.id,
      limit: 1,
    }),
    getWorkspacePlan(context.workspace.id),
  ]);

  return (
    <OverviewView
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      days={days}
      setup={setup}
      setupOffer={plan === "free"}
      winback={{ matched: opportunities.matched, eligible: opportunities.eligible }}
    />
  );
}
