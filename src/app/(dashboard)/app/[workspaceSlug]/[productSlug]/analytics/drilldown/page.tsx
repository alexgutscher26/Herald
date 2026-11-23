import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMetricDrilldown } from "@/features/analytics/drilldown";
import { resolveProductPage } from "@/lib/product-page";

export const metadata = { title: "Analytics drill-down" };

export default async function AnalyticsDrilldownPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{ dataset?: string; metric?: string; days?: string }>;
}) {
    const query = await searchParams;
  const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "analytics:read");
  const days = Math.min(Math.max(Number(query.days) || 30, 1), 90);
  const basePath = `/app/${workspaceSlug}/${productSlug}`;

  let result = null;
  let error: string | null = null;
  if (query.dataset && query.metric) {
    try {
      result = await getMetricDrilldown({
        workspaceId: context.workspace.id,
        productId: context.product.id,
        dataset: query.dataset,
        metric: query.metric,
        days,
      });
    } catch {
      error = "That metric cannot be drilled into.";
    }
  } else {
    error = "Choose a metric from the analytics page.";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={result ? result.title : "Drill-down"}
        description={
          result
            ? `${result.description} · ${result.from} to ${result.to} · up to 100 rows.`
            : (error ?? "Choose a metric from the analytics page.")
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`${basePath}/analytics`}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              Analytics
            </Link>
          </Button>
        }
      />

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Underlying rows</CardTitle>
          </CardHeader>
          <CardContent>
            {result.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rows in this window.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      {result.columns.map((column) => (
                        <th key={column.key} className="py-2 pr-4 font-medium">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, index) => (
                      <tr key={index} className="border-b last:border-0">
                        {result.columns.map((column) => (
                          <td key={column.key} className="max-w-[22rem] truncate py-2 pr-4">
                            {row[column.key] ?? "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.note ? (
              <p className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {result.note}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
