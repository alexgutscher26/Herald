import type { Metadata } from "next";

import { PublicDoc } from "@/features/docs/public-doc";

export const metadata: Metadata = {
  title: "API workflows",
  description:
    "Worked Herald API recipes: submit a request for a customer, triage status and tags, reply, draft a changelog entry, answer a support conversation and attach a customer to a company.",
  alternates: { canonical: "/docs/api/workflows" },
};

export const dynamic = "force-static";

export default function ApiWorkflowsDocPage() {
  return (
    <PublicDoc
      file="docs/api-workflows.md"
      eyebrow="API guide"
      title="API workflows"
      intro="Six sequences that the field-level spec cannot express: the exact calls, in order, for the jobs an integration usually does first."
    />
  );
}
