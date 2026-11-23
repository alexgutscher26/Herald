import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { confirmSubscriber } from "@/features/subscribers/confirmation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm your subscription",
  robots: { index: false, follow: false },
};

type Params = { workspaceSlug: string; productSlug: string };
type Search = { token?: string | string[] };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function ConfirmSubscriptionPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { workspaceSlug, productSlug } = await params;
  const token = first((await searchParams).token).trim();
  const result = token ? await confirmSubscriber(token) : { state: "invalid" as const };

  if (result.state === "invalid") {
    return (
      <main id="public-main" tabIndex={-1} className="mx-auto w-full max-w-lg px-4 py-16 sm:px-6">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This link is not valid
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The confirmation link may have already been used or has expired. Ask the product team
          to send a new one.
        </p>
      </main>
    );
  }

  if (result.workspaceSlug !== workspaceSlug || result.productSlug !== productSlug) {
    notFound();
  }

  // The preference token is a different capability; the confirmation page does
  // not expose it, so a confirmed subscriber is simply told what happened.
  return (
    <main id="public-main" tabIndex={-1} className="mx-auto w-full max-w-lg px-4 py-16 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">
        {result.state === "confirmed" ? "Subscription confirmed" : "Already confirmed"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {result.state === "confirmed"
          ? `${result.email} will now receive product updates.`
          : `${result.email} was already confirmed.`}
      </p>
      <p className="mt-6 text-sm">
        <Link
          className="underline underline-offset-2"
          href={`/p/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(productSlug)}`}
        >
          Back to the product page
        </Link>
      </p>
    </main>
  );
}
