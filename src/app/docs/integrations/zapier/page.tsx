import type { Metadata } from "next";

import { PublicDoc } from "@/features/docs/public-doc";

export const metadata: Metadata = {
  title: "Zapier triggers",
  description:
    "Start a Zap from Herald's signed webhooks: Catch Hook setup, the delivery envelope, signature verification with Catch Raw Hook, retries and limits.",
  alternates: { canonical: "/docs/integrations/zapier" },
};

export const dynamic = "force-static";

export default function ZapierIntegrationDocPage() {
  return (
    <PublicDoc
      file="docs/integrations/zapier.md"
      eyebrow="Integration guide"
      title="Zapier triggers"
      intro="Turn Herald's board, changelog and support events into automated workflows. This guide covers the supported triggers, the delivery envelope, signature verification and what happens when a step fails."
    />
  );
}
