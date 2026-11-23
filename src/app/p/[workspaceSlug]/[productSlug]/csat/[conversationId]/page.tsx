import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { submitEmailCsat, loadEmailCsat } from "@/features/conversations/customer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rate the conversation",
  robots: { index: false, follow: false },
};

type Params = {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
};

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function PublicCsatPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug, productSlug, conversationId } = await params;
  const query = await searchParams;
  const token = first(query.token);
  const view = await loadEmailCsat({
    workspaceSlug,
    productSlug,
    conversationId,
    token,
  });
  if (view.state === "not_found") notFound();

  const justRated = first(query.rated) === "1";

  async function rate(formData: FormData): Promise<void> {
    "use server";
    const rating = Number(formData.get("rating") ?? 0);
    const result = await submitEmailCsat({
      workspaceSlug,
      productSlug,
      conversationId,
      token,
      rating,
    });
    if (result.state === "not_found") redirect(`/p/${workspaceSlug}/${productSlug}`);
    if (result.state === "invalid") {
      redirect(
        `/p/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
          productSlug,
        )}/csat/${encodeURIComponent(conversationId)}?token=${encodeURIComponent(
          token,
        )}&error=${encodeURIComponent(result.error)}`,
      );
    }
    redirect(
      `/p/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
        productSlug,
      )}/csat/${encodeURIComponent(conversationId)}?token=${encodeURIComponent(
        token,
      )}&rated=1`,
    );
  }

  const error = first(query.error);

  return (
    <main
      id="public-main"
      tabIndex={-1}
      className="mx-auto flex min-h-[70vh] max-w-xl items-center px-4 py-12"
    >
      <section className="w-full rounded-xl border bg-card p-6 shadow-sm">
        <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
          {view.productName}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">
          {view.subject}
        </h1>
        {view.canRate ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              How did we do? Choose a score from 1 (not great) to 5 (excellent).
              {view.rerate
                ? " The thread was reopened, so you can update your earlier rating once."
                : " This is optional and takes one tap."}
            </p>
            <form action={rate} className="mt-5 flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="submit"
                  name="rating"
                  value={rating}
                  className="size-11 rounded-md border bg-background text-base font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {rating}
                </button>
              ))}
            </form>
          </>
        ) : justRated || view.rating !== null ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {justRated ? "Thanks for the rating." : "This conversation was rated."}
            {view.rating !== null ? ` You gave it ${view.rating}/5.` : ""}
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            This conversation is not waiting for a rating.
          </p>
        )}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
