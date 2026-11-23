import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getPublicLoginPage } from "@/features/customer-auth/login-page";
import { LoginForm } from "@/features/customer-auth/login-form";
import { sanitizeNextPath } from "@/features/customer-auth/next-path";
import { getPublicSite } from "@/features/public/i18n/server";
import { publicBoardPath } from "@/features/public/paths";
import { LogoutButton } from "@/features/public/profile-menu";
import { PublicHeader } from "@/features/public/public-header";
import { getPublicViewerIdentity } from "@/features/public/viewer";

/**
 * Public customer sign-in.
 *
 * Email is the only credential: a single-use link is sent, and the account is
 * created on consumption. Single sign-on is the other path; it is established
 * by the widget/identity handoff and needs no form here.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
}): Promise<Metadata> {
  const { workspaceSlug } = await params;
  const site = await getPublicSite(workspaceSlug);
  return {
    title: site.t("common.signIn"),
    robots: { index: false, follow: false },
  };
}

type Params = { workspaceSlug: string; productSlug: string };
type Search = {
  next?: string | string[];
  status?: string | string[];
};

function first(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export default async function PublicLoginPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const resolved = await params;
  const query = await searchParams;

  const page = await getPublicLoginPage(resolved);
  if (!page) notFound();

  const site = await getPublicSite(page.workspace.slug);
  const { t } = site;

  const boardPath = page.board
    ? publicBoardPath(page.workspace.slug, page.product.slug, page.board.slug)
    : "/";

  const requestedNext = sanitizeNextPath(first(query.next));
  const prefix = `/p/${page.workspace.slug}/${page.product.slug}/`;
  const nextPath =
    requestedNext && requestedNext.startsWith(prefix) ? requestedNext : boardPath;

  const viewer = await getPublicViewerIdentity(page.workspace.slug);
  const invalid = first(query.status) === "invalid";

  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader
        productName={page.product.name}
        workspaceSlug={page.workspace.slug}
        productSlug={page.product.slug}
        viewer={viewer}
        homeHref={boardPath}
        nextPath={nextPath}
      />

      <main
        id="public-main"
        tabIndex={-1}
        className="mx-auto w-full max-w-lg flex-1 px-4 py-10 sm:px-6"
      >
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("login.title", { product: page.product.name })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("login.subtitle")}</p>

        {invalid ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-sm text-warning"
          >
            {t("login.invalid")}
          </p>
        ) : null}

        <div className="mt-6 rounded-lg border bg-card p-5">
          {viewer?.identified ? (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {viewer.name
                    ? t("login.signedInAs", { name: viewer.name })
                    : t("login.signedIn")}
                </p>
                {viewer.email ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {viewer.email}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href={nextPath}>{t("common.continue")}</Link>
                </Button>
                <LogoutButton />
              </div>
            </div>
          ) : (
            <LoginForm
              workspaceSlug={page.workspace.slug}
              productSlug={page.product.slug}
              nextPath={nextPath}
              emailConfigured={page.emailConfigured}
            />
          )}
        </div>

        <p className="mt-4 text-xs text-muted-foreground">{t("login.ssoNote")}</p>

        {page.board ? (
          <Link
            href={boardPath}
            className="mt-6 inline-flex min-h-6 items-center text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {t("login.backTo", { board: page.board.name })}
          </Link>
        ) : null}
      </main>
    </div>
  );
}
