import type { Metadata } from "next";

import { PublicDoc } from "@/features/docs/public-doc";

export const metadata: Metadata = {
  title: "API versioning",
  description:
    "Herald's v1 compatibility promise: which changes are additive, how deprecation headers work and how rate-limit changes are announced.",
  alternates: { canonical: "/docs/api/versioning" },
};

export const dynamic = "force-static";

export default function ApiVersioningDocPage() {
  return (
    <PublicDoc
      file="docs/api-versioning.md"
      eyebrow="API guide"
      title="API versioning"
      intro="What Herald promises inside v1, what counts as an additive change, and how a deprecation reaches you before anything stops working."
    />
  );
}
