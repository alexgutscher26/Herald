import type { Metadata } from "next";

import { PublicDoc } from "@/features/docs/public-doc";

export const metadata: Metadata = {
  title: "Product events",
  description:
    "Record customer-scoped product events with POST /api/v1/events: fields, limits, the SDK helper, and the outbound webhook event it emits.",
  alternates: { canonical: "/docs/api/events" },
};

export const dynamic = "force-static";

export default function ApiEventsDocPage() {
  return (
    <PublicDoc
      file="docs/api-events.md"
      eyebrow="API guide"
      title="Product events"
      intro="Customer-scoped events for analytics and outbound targeting: what they store, what they never become, and how they reach your own systems."
    />
  );
}
