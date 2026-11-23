import type { Metadata } from "next";
import Link from "next/link";

import { LegalShell, ProseSection } from "@/components/trust/legal-shell";
import {
  COMPLIANCE_STATEMENT,
  SECURITY_CONTACT,
  SECURITY_PRACTICES,
  SUBPROCESSORS,
} from "@/features/trust/content";

export const metadata: Metadata = {
  title: "Security and trust",
  description:
    "How Herald protects customer data: encryption, tenant isolation, deny-by-default authorization, audit history, data controls and incident response. SOC 2 status stated honestly.",
  alternates: { canonical: "/trust" },
};

export default function TrustPage() {
  const required = SUBPROCESSORS.filter((provider) => !provider.optional);

  return (
    <LegalShell
      title="Security and trust"
      summary="The controls behind the service, what we do not claim, and where to send a security question. This page describes the code and the documented deployment, not a marketing badge."
    >
      <div className="rounded-lg border bg-muted/30 p-4">
        <h2 className="text-sm font-semibold">Compliance status</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {COMPLIANCE_STATEMENT.soc2}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {COMPLIANCE_STATEMENT.penTest}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {COMPLIANCE_STATEMENT.gdpr}
        </p>
      </div>

      <div className="mt-8">
        {SECURITY_PRACTICES.map((practice) => (
          <ProseSection
            key={practice.title}
            title={practice.title}
            paragraphs={[practice.body]}
          />
        ))}
      </div>

      <section className="border-t py-6">
        <h2 className="text-base font-semibold tracking-tight">Core sub-processors</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The hosted service relies on the providers below. The full list, including optional
          integrations and locations, is on the{" "}
          <Link href="/legal/subprocessors" className="underline underline-offset-2">
            sub-processor page
          </Link>
          .
        </p>
        <ul className="mt-3 space-y-3">
          {required.map((provider) => (
            <li key={provider.name} className="rounded-md border bg-card p-3">
              <p className="text-sm font-medium">{provider.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{provider.purpose}</p>
              <p className="mt-1 text-xs text-muted-foreground">{provider.location}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t py-6">
        <h2 className="text-base font-semibold tracking-tight">Procurement documents</h2>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <li className="rounded-md border bg-card p-3">
            <Link href="/legal/dpa" className="font-medium underline underline-offset-2">
              Data Processing Agreement
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              The published processor terms, including sub-processors, breach notice and deletion.
            </p>
          </li>
          <li className="rounded-md border bg-card p-3">
            <Link
              href="/legal/subprocessors"
              className="font-medium underline underline-offset-2"
            >
              Sub-processor list
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              Every provider, its purpose, the data involved and where it processes.
            </p>
          </li>
          <li className="rounded-md border bg-card p-3">
            <Link
              href="/legal/data-residency"
              className="font-medium underline underline-offset-2"
            >
              Data residency
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              Where primary storage, backups and optional integrations process data.
            </p>
          </li>
          <li className="rounded-md border bg-card p-3">
            <a
              href={`mailto:${SECURITY_CONTACT}`}
              className="font-medium underline underline-offset-2"
            >
              Security contact
            </a>
            <p className="mt-1 text-xs text-muted-foreground">
              Vulnerability reports, questionnaires and signed DPA requests.
            </p>
          </li>
        </ul>
      </section>
    </LegalShell>
  );
}
