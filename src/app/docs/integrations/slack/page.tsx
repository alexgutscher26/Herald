import type { Metadata } from "next";

import { PublicDoc } from "@/features/docs/public-doc";

export const metadata: Metadata = {
  title: "Slack integration",
  description:
    "Turn a Slack channel message into a feedback request, keep status changes threaded, and open support conversations with !support.",
  alternates: { canonical: "/docs/integrations/slack" },
};

export const dynamic = "force-static";

export default function SlackIntegrationDocPage() {
  return (
    <PublicDoc
      file="docs/slack-integration.md"
      eyebrow="Integration guide"
      title="Slack"
      intro="One channel per product: messages become requests, status changes reply in the thread, and !support opens a conversation your team can answer from Herald."
    />
  );
}
