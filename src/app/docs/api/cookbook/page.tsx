import type { Metadata } from "next";

import { PublicDoc } from "@/features/docs/public-doc";

export const metadata: Metadata = {
  title: "API cookbook",
  description:
    "Client behaviour around Herald's API: paging a whole collection, retrying without duplicating a write, recovering from each error class and staying inside the rate limit.",
  alternates: { canonical: "/docs/api/cookbook" },
};

export const dynamic = "force-static";

export default function ApiCookbookDocPage() {
  return (
    <PublicDoc
      file="docs/api-cookbook.md"
      eyebrow="API guide"
      title="API cookbook"
      intro="Pagination, idempotency, error recovery, rate limits and reconciliation — the client behaviour that decides whether an integration survives a bad night."
    />
  );
}
