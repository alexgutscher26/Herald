import type { Metadata } from "next";

import { LegalShell, ProseSection } from "@/components/trust/legal-shell";
import { RESIDENCY_FACTS } from "@/features/trust/content";

export const metadata: Metadata = {
  title: "Data residency",
  description:
    "Where Herald stores primary data and backups, which integrations process data outside the database region, and what regional commitments are not offered today.",
  alternates: { canonical: "/legal/data-residency" },
};

export default function DataResidencyPage() {
  return (
    <LegalShell
      title="Data residency"
      summary="What the deployment controls, where data actually goes, and the regional guarantees that are not offered. Written to be usable in a procurement review without a sales call."
    >
      <div className="rounded-lg border bg-muted/30 p-4">
        <h2 className="text-sm font-semibold">The short version</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Primary customer content lives in the PostgreSQL database region chosen when the
          deployment is created. Backups stay with that database provider. Email, billing and any
          enabled integration can process data in the United States. There is no EU-only stack or
          per-workspace region selector today.
        </p>
      </div>

      <div className="mt-8">
        {RESIDENCY_FACTS.map((fact) => (
          <ProseSection key={fact.title} title={fact.title} paragraphs={[fact.body]} />
        ))}
      </div>

      <section className="border-t py-6 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          What to do before signing
        </h2>
        <p className="mt-2">
          If a regulated workload requires a specific region, a transfer mechanism or an
          EU-only data path, raise it before signing. A requirement that is not written into the
          order form is not a commitment. The current provider locations are on the
          sub-processor page and are reviewed when the deployment changes.
        </p>
      </section>
    </LegalShell>
  );
}
