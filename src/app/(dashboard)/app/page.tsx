import { redirect } from "next/navigation";

import { listWorkspaceSummaries } from "@/db/queries/workspaces";
import { requireUser } from "@/lib/authz";

/**
 * Application entry point.
 *
 * Reads the signed-in user's memberships and sends them to their first
 * authorized product, or to onboarding when they do not have one yet.
 */
export default async function AppIndexPage() {
  const user = await requireUser();
  const summaries = await listWorkspaceSummaries(user.id);
  const first = summaries.find((summary) => summary.products.length > 0);
  const product = first?.products[0];

  if (!first || !product) {
    redirect("/app/onboarding");
  }

  redirect(`/app/${first.workspace.slug}/${product.slug}`);
}
