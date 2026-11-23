import type { Metadata } from "next";
import Link from "next/link";

import { LegalShell, ProseSection } from "@/components/trust/legal-shell";
import { DPA_SECTIONS, PRIVACY_CONTACT } from "@/features/trust/content";

export const metadata: Metadata = {
  title: "Data Processing Agreement",
  description:
    "Herald's published Data Processing Agreement for the hosted service: instructions, security measures, sub-processors, data-subject requests, incidents, transfers and deletion.",
  alternates: { canonical: "/legal/dpa" },
};

export default function DpaPage() {
  return (
    <LegalShell
      title="Data Processing Agreement"
      summary="The standard processor terms for the Herald hosted service. A signed order form can incorporate this DPA without redlining; negotiated terms are confirmed in writing."
    >
      <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          This is a published template for procurement review, not legal advice. It covers
          processing on a customer&apos;s behalf. The{" "}
          <Link href="/legal/subprocessors" className="underline underline-offset-2">
            sub-processor list
          </Link>{" "}
          and the{" "}
          <Link href="/legal/data-residency" className="underline underline-offset-2">
            data-residency statement
          </Link>{" "}
          form part of it.
        </p>
        <p className="mt-2">
          To request a signed copy or a security questionnaire, email{" "}
          <a href={`mailto:${PRIVACY_CONTACT}`} className="underline underline-offset-2">
            {PRIVACY_CONTACT}
          </a>
          .
        </p>
      </div>

      <div className="mt-8">
        {DPA_SECTIONS.map((section) => (
          <ProseSection
            key={section.title}
            title={section.title}
            paragraphs={section.paragraphs}
          />
        ))}
      </div>
    </LegalShell>
  );
}
