import type { Metadata } from "next";

import { LegalShell } from "@/components/trust/legal-shell";
import { SUBPROCESSORS, TRUST_LAST_UPDATED } from "@/features/trust/content";

export const metadata: Metadata = {
  title: "Sub-processors",
  description:
    "The providers Herald uses to host, store, email, bill and integrate, with the data categories and processing locations for each.",
  alternates: { canonical: "/legal/subprocessors" },
};

export default function SubprocessorsPage() {
  return (
    <LegalShell
      title="Sub-processors"
      summary="Every third party that can process customer data for the hosted service, why it is used, what it receives and where it processes. Optional providers only see data when a workspace enables the integration."
    >
      <p className="text-sm leading-relaxed text-muted-foreground">
        Last updated {TRUST_LAST_UPDATED}. A self-hosted deployment substitutes its own
        infrastructure providers; whoever operates it must publish that deployment&apos;s list.
        This list describes the documented hosted deployment and the optional integrations in
        this codebase.
      </p>

      <div className="mt-6 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <caption className="sr-only">Sub-processors and their processing details</caption>
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Provider</th>
              <th scope="col" className="px-3 py-2 font-medium">Purpose</th>
              <th scope="col" className="px-3 py-2 font-medium">Data categories</th>
              <th scope="col" className="px-3 py-2 font-medium">Location</th>
              <th scope="col" className="px-3 py-2 font-medium">Required</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map((provider) => (
              <tr key={provider.name} className="border-b align-top last:border-0">
                <th scope="row" className="px-3 py-3 font-medium">
                  {provider.url ? (
                    <a
                      href={provider.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      {provider.name}
                    </a>
                  ) : (
                    provider.name
                  )}
                </th>
                <td className="px-3 py-3 text-muted-foreground">{provider.purpose}</td>
                <td className="px-3 py-3 text-muted-foreground">{provider.dataCategories}</td>
                <td className="px-3 py-3 text-muted-foreground">{provider.location}</td>
                <td className="px-3 py-3 text-muted-foreground">
                  {provider.optional ? "Optional" : "Core"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-8 space-y-2 border-t pt-6 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Changes and objections
        </h2>
        <p>
          Customers with an active DPA receive reasonable advance notice before a new
          sub-processor starts processing their content, and may object on data-protection
          grounds. If an objection cannot be resolved, the customer may terminate the affected
          service and receive a pro-rata refund of prepaid fees.
        </p>
        <p>
          Optional providers are off until a workspace connects them. Disabling an integration
          stops new processing; it does not recall content already delivered to that provider.
        </p>
      </section>
    </LegalShell>
  );
}
