import { PageHeader } from "@/components/shared/page-header";
import { listBoardsForProduct } from "@/db/queries/boards";
import { listFeedbackImports, listImportPresets } from "@/features/import/service";
import { ImportExportView } from "@/features/import/import-view";
import { resolveProductPage } from "@/lib/product-page";

export const metadata = {
  title: "Import & export",
};

export const dynamic = "force-dynamic";

export default async function ImportExportPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
}) {
    const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "settings:manage");

  const [boards, imports, presets] = await Promise.all([
    listBoardsForProduct(context.product.id),
    listFeedbackImports(context.product.id),
    listImportPresets(context.workspace.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import & export"
        description="Move feedback in from another tool, or take your data out. Imports run in the background and report row-level errors."
      />

      <ImportExportView
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        boards={boards.map((board) => ({
          id: board.id,
          name: board.name,
          slug: board.slug,
          archivedAt: board.archivedAt,
        }))}
        initialImports={imports.map((item) => ({ ...item, errors: undefined }))}
        presets={presets}
      />
    </div>
  );
}
