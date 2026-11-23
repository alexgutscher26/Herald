import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiPlayground } from "@/features/api-docs/playground";
import { getPublicApiDoc } from "@/features/api-docs/service";

export const dynamic = "force-dynamic";

const METHOD_CLASS: Record<string, string> = {
  GET: "bg-info-muted text-info",
  POST: "bg-success-muted text-success",
  PUT: "bg-warning-muted text-warning",
  PATCH: "bg-warning-muted text-warning",
  DELETE: "bg-destructive/10 text-destructive",
};

export default async function PublicApiDocPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string; docSlug: string }>;
}) {
  const { workspaceSlug, productSlug, docSlug } = await params;
  const page = await getPublicApiDoc({ workspaceSlug, productSlug, docSlug });
  if (!page) notFound();

  return (
    <main id="public-main" tabIndex={-1} className="mx-auto max-w-5xl px-6 py-12">
      <Link
        href={`/p/${workspaceSlug}/${productSlug}/docs/api`}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← API documentation
      </Link>
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{page.doc.name}</h1>
        <span className="text-xs text-muted-foreground">v{page.doc.version}</span>
      </div>
      {page.doc.description ? (
        <p className="mt-2 text-sm text-muted-foreground">{page.doc.description}</p>
      ) : null}

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Operations
        </h2>
        <ul className="mt-3 divide-y rounded-lg border bg-card">
          {page.doc.operations.map((operation) => (
            <li key={`${operation.method}:${operation.path}`} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                    METHOD_CLASS[operation.method] ?? "bg-muted text-muted-foreground"
                  }`}
                >
                  {operation.method}
                </span>
                <code className="text-sm">{operation.path}</code>
                {operation.write ? (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    write
                  </span>
                ) : null}
              </div>
              {operation.summary ? (
                <p className="mt-1 text-xs text-muted-foreground">{operation.summary}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <ApiPlayground operations={page.doc.operations} />
    </main>
  );
}
