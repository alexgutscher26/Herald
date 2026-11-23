import { BookOpen } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/shared/empty-state";
import { getPublicHelpIndex } from "@/features/help/service";
import { getPublicSite } from "@/features/public/i18n/server";

export const dynamic = "force-dynamic";

export default async function PublicHelpPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
}) {
  const { workspaceSlug, productSlug } = await params;
  const site = await getPublicSite(workspaceSlug);
  const page = await getPublicHelpIndex({ workspaceSlug, productSlug, locale: site.locale });
  if (!page) notFound();

  return (
    <main id="public-main" tabIndex={-1} className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Help center
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{page.product.productName}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Guides, answers and product help.
      </p>

      <form action={`/p/${workspaceSlug}/${productSlug}/help/search`} className="mt-6 flex gap-2">
        <input
          name="q"
          type="search"
          placeholder="Search help…"
          className="h-10 flex-1 rounded-md border border-input bg-card px-3 text-sm"
          aria-label="Search help"
        />
        <button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
          Search
        </button>
      </form>

      <div className="mt-10 space-y-8">
        {page.collections.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No help articles yet"
            description="The team has not published any help collections for this product."
          />
        ) : (
          page.collections.map((collection) => (
            <section key={collection.id}>
              <Link
                href={`/p/${workspaceSlug}/${productSlug}/help/${collection.slug}`}
                className="text-lg font-semibold hover:underline"
              >
                {collection.name}
              </Link>
              {collection.description ? (
                <p className="mt-1 text-sm text-muted-foreground">{collection.description}</p>
              ) : null}
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {collection.articles.map((article) => (
                  <li key={article.id}>
                    <Link
                      href={`/p/${workspaceSlug}/${productSlug}/help/${collection.slug}/${article.slug}`}
                      className="block rounded-lg border bg-card p-3 text-sm hover:border-primary/40"
                    >
                      {article.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <div className="mt-12 flex gap-4 border-t pt-5 text-sm">
        <Link href={`/p/${workspaceSlug}/${productSlug}`} className="text-muted-foreground hover:underline">
          Feedback
        </Link>
        <Link href={`/p/${workspaceSlug}/${productSlug}/docs/api`} className="text-muted-foreground hover:underline">
          API documentation
        </Link>
      </div>
    </main>
  );
}
