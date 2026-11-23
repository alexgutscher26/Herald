import { Code2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/shared/empty-state";
import { listPublicApiDocs } from "@/features/api-docs/service";

export const dynamic = "force-dynamic";

export default async function PublicApiDocsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
}) {
  const { workspaceSlug, productSlug } = await params;
  const page = await listPublicApiDocs({ workspaceSlug, productSlug });
  if (!page) notFound();

  return (
    <main id="public-main" tabIndex={-1} className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Developer documentation
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{page.productName} API</h1>
      <div className="mt-8 space-y-3">
        {page.docs.length === 0 ? (
          <EmptyState
            icon={Code2}
            title="No API reference yet"
            description="The team has not published API documentation for this product."
          />
        ) : (
          page.docs.map((doc) => (
            <Link
              key={doc.id}
              href={`/p/${workspaceSlug}/${productSlug}/docs/api/${doc.slug}`}
              className="block rounded-lg border bg-card p-4 hover:border-primary/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{doc.name}</span>
                <span className="text-xs text-muted-foreground">v{doc.version}</span>
              </div>
              {doc.description ? (
                <p className="mt-1 text-sm text-muted-foreground">{doc.description}</p>
              ) : null}
            </Link>
          ))
        )}
      </div>
      <div className="mt-10 flex gap-4 border-t pt-5 text-sm">
        <Link href={`/p/${workspaceSlug}/${productSlug}/help`} className="text-muted-foreground hover:underline">
          Help center
        </Link>
        <Link href={`/p/${workspaceSlug}/${productSlug}`} className="text-muted-foreground hover:underline">
          Feedback
        </Link>
      </div>
    </main>
  );
}
