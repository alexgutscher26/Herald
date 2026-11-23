import { notFound } from "next/navigation";

import { PublicHeader } from "@/features/public/public-header";
import { getPublicViewerIdentity } from "@/features/public/viewer";
import { loadPortalNavigation } from "@/features/portal/service";

export const dynamic = "force-dynamic";

export default async function PublicHelpLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
}) {
  const { workspaceSlug, productSlug } = await params;
  const [navigation, viewer] = await Promise.all([
    loadPortalNavigation({ workspaceSlug, productSlug }),
    getPublicViewerIdentity(workspaceSlug),
  ]);
  if (!navigation) notFound();

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader
        productName={navigation.productName}
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        viewer={viewer}
        homeHref={`${navigation.productPath}/help`}
        nextPath={`${navigation.productPath}/help`}
      />
      {children}
    </div>
  );
}
