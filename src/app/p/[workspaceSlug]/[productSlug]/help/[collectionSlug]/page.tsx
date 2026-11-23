import Link from "next/link";
import { notFound } from "next/navigation";

import { getPublicHelpCollection } from "@/features/help/service";
import { getPublicSite } from "@/features/public/i18n/server";

export const dynamic = "force-dynamic";

export default async function PublicHelpCollectionPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string; collectionSlug: string }>;
}) {
  const { workspaceSlug, productSlug, collectionSlug } = await params;
  const site = await getPublicSite(workspaceSlug);
  const page = await getPublicHelpCollection({
    workspaceSlug,
    productSlug,
    collectionSlug,
    locale: site.locale,
  });
  if (!page) notFound();

  return (
    <main id="public-main" tabIndex={-1} className="mx-auto max-w-3xl px-6 py-12">
      <Link
        href={`/p/${workspaceSlug}/${productSlug}/help`}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Help center
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{page.collection.name}</h1>
      {page.collection.description ? (
        <p className="mt-2 text-sm text-muted-foreground">{page.collection.description}</p>
      ) : null}
      <ul className="mt-8 divide-y rounded-lg border bg-card">
        {page.collection.articles.map((article) => (
          <li key={article.id}>
            <Link
              href={`/p/${workspaceSlug}/${productSlug}/help/${collectionSlug}/${article.slug}`}
              className="block px-4 py-3 text-sm hover:bg-muted/40"
            >
              {article.title}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
