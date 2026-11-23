import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPublicSurvey } from "@/features/engagement/service";
import { PublicHeader } from "@/features/public/public-header";
import { getPublicViewer, getPublicViewerIdentity } from "@/features/public/viewer";
import { PortalSurveyForm } from "@/features/portal/survey-form";
import { loadPortalNavigation } from "@/features/portal/service";

export const dynamic = "force-dynamic";

type Params = { workspaceSlug: string; productSlug: string; surveySlug: string };

export const metadata: Metadata = { title: "Survey" };

export default async function PublicSurveyPage({ params }: { params: Promise<Params> }) {
  const resolved = await params;
  const [survey, viewer, viewerIdentity, navigation] = await Promise.all([
    getPublicSurvey({
      workspaceSlug: resolved.workspaceSlug,
      productSlug: resolved.productSlug,
      slug: resolved.surveySlug,
      customerId: (await getPublicViewer())?.customerId ?? null,
    }),
    getPublicViewer(),
    getPublicViewerIdentity(resolved.workspaceSlug),
    loadPortalNavigation(resolved),
  ]);
  if (!survey || !navigation) notFound();

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader
        productName={navigation.productName}
        workspaceSlug={resolved.workspaceSlug}
        productSlug={resolved.productSlug}
        viewer={viewerIdentity}
        homeHref={navigation.productPath}
        nextPath={`${navigation.productPath}/surveys/${survey.slug}`}
      />
      <main id="public-main" tabIndex={-1} className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {survey.kind} survey
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{survey.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your answers stay with this product. A response becomes a public feedback
          request only if you tick the opt-in box.
        </p>
        <div className="mt-6">
          <PortalSurveyForm
            workspaceSlug={resolved.workspaceSlug}
            productSlug={resolved.productSlug}
            slug={survey.slug}
            kind={survey.kind}
            questions={survey.questions}
          />
        </div>
      </main>
    </div>
  );
}
