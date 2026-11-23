import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteApiDocAction, importApiDocAction } from "@/features/api-docs/actions";
import { listApiDocs } from "@/features/api-docs/service";
import { resolveProductPage } from "@/lib/product-page";

export const metadata = { title: "API documentation" };

export default async function ApiDocsAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
    const status = await searchParams;
  const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "settings:manage");
  const docs = await listApiDocs(context.product.id);
  const hidden = (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="productSlug" value={productSlug} />
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="API documentation"
        description="Import OpenAPI JSON from a file, URL or CI. Every import is a draft until reviewed; only one version is live."
      />
      {status.saved ? (
        <p className="rounded-md border border-success/30 bg-success-muted px-3 py-2 text-sm text-success">
          Saved.
        </p>
      ) : null}
      {status.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {status.error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Published APIs</CardTitle>
          <CardDescription>Each API has one live version and a full version history.</CardDescription>
        </CardHeader>
        <CardContent>
          {docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No API documents yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {docs.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div>
                    <Link
                      href={`/app/${workspaceSlug}/${productSlug}/api-docs/${doc.id}`}
                      className="font-medium hover:underline"
                    >
                      {doc.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      /{doc.slug} · {doc.operationCount} operations · {doc.versionCount} versions
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={doc.liveVersion ? "success" : "neutral"}>
                      {doc.liveVersion ? `live ${doc.liveVersion}` : "draft only"}
                    </StatusBadge>
                    {doc.liveVersion ? (
                      <Link
                        href={`/p/${workspaceSlug}/${productSlug}/docs/api/${doc.slug}`}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        Public page
                      </Link>
                    ) : null}
                    <form action={deleteApiDocAction}>
                      {hidden}
                      <input type="hidden" name="docId" value={doc.id} />
                      <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                        Delete
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import OpenAPI</CardTitle>
          <CardDescription>
            JSON only. For CI, post to{" "}
            <code className="text-xs">/api/api-docs/{workspaceSlug}/{productSlug}/&lt;slug&gt;/versions</code>{" "}
            with a workspace token that has the <code>write</code> scope.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={importApiDocAction} className="space-y-3">
            {hidden}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="api-name">API name</Label>
                <Input id="api-name" name="name" placeholder="Payments API" maxLength={120} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="api-slug">Slug</Label>
                <Input id="api-slug" name="docSlug" placeholder="payments" maxLength={80} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="api-version">Version label</Label>
                <Input id="api-version" name="version" placeholder="2026-11-07" maxLength={80} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="api-description">Description</Label>
                <Input id="api-description" name="description" maxLength={1000} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="api-file">OpenAPI JSON file</Label>
              <input
                id="api-file"
                type="file"
                name="file"
                accept=".json,application/json"
                className="block w-full text-xs text-muted-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="api-url">Or import from URL</Label>
              <Input id="api-url" name="url" placeholder="https://api.example.com/openapi.json" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="api-document">Or paste JSON</Label>
              <textarea
                id="api-document"
                name="document"
                rows={8}
                className="w-full rounded-md border border-input bg-card p-3 font-mono text-xs leading-5"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="publish" /> Publish if this is the first version or has no
              breaking changes
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="confirmBreaking" /> I reviewed the breaking changes and
              want to publish anyway
            </label>
            <Button type="submit">Import draft</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
