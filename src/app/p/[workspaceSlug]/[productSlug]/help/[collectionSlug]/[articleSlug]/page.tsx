import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";

import { getPublicHelpArticle } from "@/features/help/service";
import { formatPublicDate } from "@/features/public/i18n";
import { getPublicSite } from "@/features/public/i18n/server";
import { JsonLd } from "@/features/public/json-ld";
import { faqPageSchema, plainText } from "@/features/public/structured-data";

export const dynamic = "force-dynamic";

export default async function PublicHelpArticlePage({
  params,
}: {
  params: Promise<{
    workspaceSlug: string;
    productSlug: string;
    collectionSlug: string;
    articleSlug: string;
  }>;
}) {
  const { workspaceSlug, productSlug, collectionSlug, articleSlug } = await params;
  const site = await getPublicSite(workspaceSlug);
  const page = await getPublicHelpArticle({
    workspaceSlug,
    productSlug,
    collectionSlug,
    articleSlug,
    locale: site.locale,
  });
  if (!page) notFound();

  const path = `/p/${workspaceSlug}/${productSlug}/help/${page.article.collection.slug}/${page.article.slug}`;

  return (
    <main id="public-main" tabIndex={-1} className="mx-auto max-w-3xl px-6 py-12">
      <JsonLd
        data={faqPageSchema({
          question: page.article.title,
          answer: plainText(page.article.body),
          path,
        })}
      />
      <Link
        href={`/p/${workspaceSlug}/${productSlug}/help/${page.article.collection.slug}`}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← {page.article.collection.name}
      </Link>
      <article className="mt-4">
        <h1 className="text-3xl font-semibold tracking-tight">{page.article.title}</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          {site.t("help.updated", {
            date: formatPublicDate(site.locale, page.article.updatedAt),
          })}
        </p>
        <div className="mt-8 space-y-4 text-[15px] leading-7 [&_a]:underline [&_h1]:mt-8 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs">
          <ReactMarkdown>{page.article.body}</ReactMarkdown>
        </div>
      </article>
    </main>
  );
}
