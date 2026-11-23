import type { Metadata } from "next";

import { PublicDoc } from "@/features/docs/public-doc";

export const metadata: Metadata = {
  title: "Twilio Segment integration",
  description:
    "Send Herald board activity to Twilio Segment with a source function: setup, event mapping, delivery behaviour, signing and verification.",
  alternates: { canonical: "/docs/integrations/segment" },
};

export const dynamic = "force-static";

export default function SegmentIntegrationDocPage() {
  return (
    <PublicDoc
      file="docs/integrations/segment.md"
      eyebrow="Integration guide"
      title="Twilio Segment"
      intro="Pipe Herald's board activity into your analytics stack through Twilio Segment's source function, with the event mapping, delivery behaviour and verification steps in one place."
    />
  );
}
