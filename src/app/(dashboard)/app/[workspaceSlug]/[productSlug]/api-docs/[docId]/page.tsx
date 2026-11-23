import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  publishApiDocVersionAction,
  rollbackApiDocVersionAction,
} from "@/features/api-docs/actions";
import { getAdminApiDoc } from "@/features/api-docs/service";
import { requireProductContext } from "@/lib/authz";

export const metadata = { title: "API versions" };

export default async function ApiDocVersionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string; docId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { workspaceSlug, productSlug, docId } = await params;
  const status = await searchParams;
  const context = await requireProductContext(workspaceSlug, productSlug, "settings:manage");
  const data = await getAdminApiDoc(context.product.id, docId);
  if (!data) notFound();

  const hidden = (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="productSlug" value={productSlug} />
      <input type="hidden" name="docId" value={data.doc.id} />
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={data.doc.name}
        description={`/${data.doc.slug} · draft review, breaking-change diff and rollback.`}
      />
      <Link
        href={`/app/${workspaceSlug}/${productSlug}/api-docs`}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Back to API docs
      </Link>
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

      <div className="space-y-4">
        {data.versions.map((version) => (
          <Card key={version.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-sm">
                  {version.version} · {version.operationCount} operations
                </CardTitle>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    tone={
                      version.status === "live"
                        ? "success"
                        : version.status === "draft"
                          ? "info"
                          : "neutral"
                    }
                  >
                    {version.status}
                  </StatusBadge>
                  {version.breakingCount > 0 ? (
                    <StatusBadge tone="danger">
                      {version.breakingCount} breaking
                    </StatusBadge>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {version.source}
                {version.sourceUrl ? ` · ${version.sourceUrl}` : ""} · imported{" "}
                {version.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                {version.publishedAt
                  ? ` · published ${version.publishedAt.toISOString().slice(0, 16).replace("T", " ")}`
                  : ""}
              </p>

              {version.breakingChanges.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No changes against the version that was live at import.
                </p>
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {version.breakingChanges.map((change, index) => (
                    <li
                      key={`${change.kind}-${index}`}
                      className={
                        change.severity === "breaking"
                          ? "rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5"
                          : "rounded-md border px-2 py-1.5 text-muted-foreground"
                      }
                    >
                      <span className="font-medium">{change.severity}</span> · {change.detail}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-3">
                {version.status === "live" ? (
                  <Link
                    href={`/p/${workspaceSlug}/${productSlug}/docs/api/${data.doc.slug}`}
                    className="text-sm text-muted-foreground hover:underline"
                  >
                    View public docs
                  </Link>
                ) : null}
                {version.status === "draft" ? (
                  <form action={publishApiDocVersionAction} className="flex items-center gap-2">
                    {hidden}
                    <input type="hidden" name="versionId" value={version.id} />
                    {version.breakingCount > 0 ? (
                      <label className="flex items-center gap-1 text-xs">
                        <input type="checkbox" name="confirmBreaking" /> Confirm breaking
                      </label>
                    ) : null}
                    <Button type="submit" size="sm">Publish</Button>
                  </form>
                ) : null}
                {version.status === "superseded" ? (
                  <form action={rollbackApiDocVersionAction} className="flex items-center gap-2">
                    {hidden}
                    <input type="hidden" name="versionId" value={version.id} />
                    <Button type="submit" size="sm" variant="outline">Roll back to this</Button>
                  </form>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
