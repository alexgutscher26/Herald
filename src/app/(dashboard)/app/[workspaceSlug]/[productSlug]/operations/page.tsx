import { AlertTriangle, CheckCircle2, Clock3, ListChecks } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProductJobDashboard } from "@/features/jobs/product-dashboard";
import { resolveProductPage } from "@/lib/product-page";
import { formatNumber } from "@/lib/format";

export const metadata = { title: "Operations" };

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
};

export default async function OperationsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
}) {
    const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "settings:manage");
  const dashboard = await getProductJobDashboard(context.product.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations"
        description="Background jobs for this product. Payloads and tenant identifiers are never shown here."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(["pending", "running", "succeeded", "failed"] as const).map((status) => (
          <Card key={status}>
            <CardContent className="flex items-center justify-between gap-3 p-5">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {STATUS_LABELS[status]}
                </p>
                <p className="mt-1.5 [font-family:var(--font-archivo)] text-[27px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
                  {formatNumber(dashboard.counts[status] ?? 0)}
                </p>
              </div>
              {status === "failed" ? (
                <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
              ) : status === "succeeded" ? (
                <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
              ) : (
                <Clock3 className="size-5 text-muted-foreground" aria-hidden="true" />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ListChecks className="size-4" aria-hidden="true" /> Recent jobs
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No product-scoped jobs have run yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="border-b text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 font-medium">Type</th>
                      <th className="py-2 font-medium">Status</th>
                      <th className="py-2 font-medium">Attempts</th>
                      <th className="py-2 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.recent.map((job) => (
                      <tr key={job.id} className="border-b last:border-0">
                        <td className="py-2 font-mono text-xs">{job.type}</td>
                        <td className="py-2">
                          <span className={job.status === "failed" ? "text-destructive" : ""}>
                            {STATUS_LABELS[job.status] ?? job.status}
                          </span>
                        </td>
                        <td className="py-2 tabular-nums">
                          {job.attempts}/{job.maxAttempts}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {new Date(job.updatedAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">By type</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {dashboard.byType.length === 0 ? (
              <p className="text-muted-foreground">Nothing queued.</p>
            ) : (
              dashboard.byType.map((row) => (
                <div key={row.type} className="flex items-center justify-between gap-2">
                  <span className="break-all font-mono text-xs">{row.type}</span>
                  <span className="tabular-nums">{formatNumber(row.count)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {dashboard.failed.length > 0 ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-sm text-destructive">Needs attention</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {dashboard.failed.map((job) => (
              <div key={job.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs">{job.type}</span>
                  <span className="text-xs text-muted-foreground">
                    {job.attempts}/{job.maxAttempts} attempts
                  </span>
                </div>
                {job.lastError ? (
                  <p className="mt-1 text-xs text-muted-foreground">{job.lastError}</p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
