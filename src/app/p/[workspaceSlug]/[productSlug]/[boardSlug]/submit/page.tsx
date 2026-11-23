import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { trackPublicView } from "@/features/analytics/track";
import { getPublicSite } from "@/features/public/i18n/server";
import { publicBoardPath } from "@/features/public/paths";
import { getPublicSubmitPage } from "@/features/public/queries";
import { PublicHeader } from "@/features/public/public-header";
import { SubmitForm } from "@/features/public/submit-form";
import {
  getPublicViewer,
  getPublicViewerIdentity,
} from "@/features/public/viewer";

/**
 * Public submission page.
 *
 * The board is part of the URL, so the form cannot post a request into a board
 * the visitor cannot see. The board picker navigates to another board's form
 * rather than silently switching the target.
 */

export const dynamic = "force-dynamic";

type Params = { workspaceSlug: string; productSlug: string; boardSlug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const resolved = await params;
  const page = await getPublicSubmitPage(resolved);

  if (!page) {
    return { title: "Board not found", robots: { index: false, follow: false } };
  }

  const site = await getPublicSite(page.workspace.slug);
  const title = site.t("meta.submitTitle", { board: page.board.name });
  const description = site.t("meta.submitDescription", {
    product: page.product.name,
    workspace: page.workspace.name,
  });
  const path = `${publicBoardPath(
    page.workspace.slug,
    page.product.slug,
    page.board.slug,
  )}/submit`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: page.workspace.name,
      type: "website",
    },
  };
}

export default async function PublicSubmitPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const resolved = await params;
  const [viewer, identity] = await Promise.all([
    getPublicViewer(),
    getPublicViewerIdentity(resolved.workspaceSlug),
  ]);
  const page = await getPublicSubmitPage(resolved, viewer);
  if (!page) notFound();

  await trackPublicView({
    workspaceId: page.workspace.id,
    productId: page.product.id,
    boardId: page.board.id,
    type: "submit_started",
  });

  const site = await getPublicSite(page.workspace.slug);
  const { t } = site;
  const boardPath = publicBoardPath(
    page.workspace.slug,
    page.product.slug,
    page.board.slug,
  );
  const submitPath = `${boardPath}/submit`;

  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader
        productName={page.product.name}
        workspaceSlug={page.workspace.slug}
        productSlug={page.product.slug}
        viewer={identity}
        homeHref={boardPath}
        nextPath={submitPath}
      />

      <main
        id="public-main"
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={boardPath}
            className="inline-flex min-h-6 items-center text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            ← {page.board.name}
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link href={boardPath}>{t("submit.cancel")}</Link>
          </Button>
        </div>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
          {t("submit.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("submit.subtitle")}</p>

        {page.board.requiresApproval ? (
          <p className="mt-4 rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-sm text-warning">
            {t("submit.reviewNote")}
          </p>
        ) : null}

        <div className="mt-6">
          <SubmitForm
            workspaceSlug={page.workspace.slug}
            productSlug={page.product.slug}
            boardSlug={page.board.slug}
            boards={page.boards}
            customFields={page.customFields}
            intakeQuestions={page.intakeQuestions}
            aiRewriteEnabled={page.aiRewriteEnabled}
            guestPosting={page.board.guestPosting}
            identified={page.viewer.identified}
            hasCompany={page.viewer.hasCompany}
          />
        </div>
      </main>
    </div>
  );
}
