import { ReleaseEditor } from "@/features/releases/release-editor";

export const metadata = {
  title: "New release",
};

export default async function NewReleasePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
}) {
  const { workspaceSlug, productSlug } = await params;
  return <ReleaseEditor workspaceSlug={workspaceSlug} productSlug={productSlug} />;
}
