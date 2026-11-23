import type { Metadata } from "next";
import Link from "next/link";

import { LegalShell, ProseSection } from "@/components/trust/legal-shell";
import { TERMS_SECTIONS } from "@/features/trust/content";

export const metadata: Metadata = {
  title: "Terms of service",
  description:
    "The terms for using Herald: accounts, billing, customer content, acceptable use, intellectual property, availability, termination and liability.",
  alternates: { canonical: "/legal/terms" },
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of service"
      summary="The agreement for the hosted Herald service, from account security and billing to content ownership, acceptable use and termination."
    >
      <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          A signed order form or enterprise agreement controls over these terms where they
          conflict. The{" "}
          <Link href="/legal/dpa" className="underline underline-offset-2">
            DPA
          </Link>{" "}
          applies to personal data processed on a customer&apos;s behalf, and the{" "}
          <Link href="/legal/lifetime" className="underline underline-offset-2">
            Founding Lifetime terms
          </Link>{" "}
          apply to that offer. This page is a published template for review, not legal advice.
        </p>
      </div>

      <div className="mt-6">
        {TERMS_SECTIONS.map((section) => (
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
