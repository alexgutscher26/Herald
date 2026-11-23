/**
 * Demand counting shared by the dashboard and the public request page.
 *
 * It lives outside every feature folder because the public surface may not
 * import `@/features/feedback`; both sides must still count identically, or a
 * request would claim one number internally and another publicly.
 *
 * A customer is counted once however many times they wrote in; a source is one
 * conversation, email or call, so two messages from the same conversation are
 * one source rather than two. Only counts are ever shown to customers.
 */

export type RequestDemand = {
  customers: number;
  sources: number;
};

export type DemandEvidence = {
  id: string;
  authorCustomerId?: string | null;
  authorLabel?: string | null;
  sourceRef?: string | null;
};

export function summarizeRequestDemand(
  evidence: readonly DemandEvidence[],
): RequestDemand {
  const customers = new Set<string>();
  const sources = new Set<string>();

  for (const item of evidence) {
    if (item.authorCustomerId) {
      customers.add(`customer:${item.authorCustomerId}`);
    } else {
      const label = item.authorLabel?.trim().toLowerCase();
      if (label) customers.add(`label:${label}`);
    }

    const ref = item.sourceRef?.trim();
    sources.add(ref ? `ref:${ref}` : `row:${item.id}`);
  }

  return { customers: customers.size, sources: sources.size };
}
