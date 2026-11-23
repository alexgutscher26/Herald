import type { Metadata } from "next";
import Link from "next/link";

import { LegalShell, ProseSection } from "@/components/trust/legal-shell";
import { PRIVACY_CONTACT, PRIVACY_SECTIONS } from "@/features/trust/content";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What Herald collects, why, how long it keeps it, the cookies it uses and the choices available to visitors, customers and workspace owners.",
  alternates: { canonical: "/legal/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy policy"
      summary="How Herald handles account, billing, customer and public-visitor data, including the cookie choice and the controls available to workspace owners."
    >
      <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          Herald is the controller for its own account and billing records, and a processor for
          customer content stored by a workspace. The{" "}
          <Link href="/legal/dpa" className="underline underline-offset-2">
            DPA
          </Link>
          ,{" "}
          <Link href="/legal/subprocessors" className="underline underline-offset-2">
            sub-processor list
          </Link>{" "}
          and{" "}
          <Link href="/legal/data-residency" className="underline underline-offset-2">
            data-residency statement
          </Link>{" "}
          form the detailed processing pack. This page is a published template for review, not
          legal advice.
        </p>
        <p className="mt-2">
          Privacy questions and data-subject requests:{" "}
          <a href={`mailto:${PRIVACY_CONTACT}`} className="underline underline-offset-2">
            {PRIVACY_CONTACT}
          </a>
          .
        </p>
      </div>

      <div className="mt-6">
        {PRIVACY_SECTIONS.map((section) => (
          <ProseSection
            key={section.title}
            id={section.id}
            title={section.title}
            paragraphs={section.paragraphs}
          />
        ))}
      </div>
    </LegalShell>
  );
}
