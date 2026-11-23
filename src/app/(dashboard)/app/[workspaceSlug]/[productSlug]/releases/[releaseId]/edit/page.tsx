import { ReleaseEditor } from "@/features/releases/release-editor";

export const metadata = {
  title: "Edit release",
};

export default async function EditReleasePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string; releaseId: string }>;
}) {
  const { workspaceSlug, productSlug, releaseId } = await params;
  return (
    <ReleaseEditor
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      releaseId={releaseId}
    />
  );
}
