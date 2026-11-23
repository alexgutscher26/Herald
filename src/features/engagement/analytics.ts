/**
 * Outbound analytics reconciliation.
 *
 * Event rows are observations, not recipients. A repeated open must not inflate
 * reach, and an event from a customer with no delivery row must not be counted
 * in a rate. This module makes the denominator explicit before any percentage
 * is shown.
 */

export type OutboundDeliverySummary = { status: string; total: number };
export type OutboundEventObservation = { type: string; customerId: string | null };

export type ReconciledOutbound = {
  deliveryRows: number;
  reached: number;
  pending: number;
  opened: number;
  clicked: number;
  converted: number;
  unattributedEvents: number;
  openRate: number | null;
  clickRate: number | null;
  conversionRate: number | null;
};

export function reconcileOutboundAnalytics(input: {
  deliveries: OutboundDeliverySummary[];
  deliveryRecipients: string[];
  sentRecipients: string[];
  events: OutboundEventObservation[];
}): ReconciledOutbound {
  const deliveryRows = input.deliveries.reduce((sum, row) => sum + row.total, 0);
  const reachedIds = new Set(
    [...input.deliveryRecipients, ...input.sentRecipients].filter((id): id is string =>
      Boolean(id),
    ),
  );
  const openedIds = new Set<string>();
  const clickedIds = new Set<string>();
  const convertedIds = new Set<string>();
  let unattributedEvents = 0;

  for (const event of input.events) {
    if (!event.customerId || !reachedIds.has(event.customerId)) {
      unattributedEvents += 1;
      continue;
    }
    if (event.type === "opened") openedIds.add(event.customerId);
    if (event.type === "clicked") clickedIds.add(event.customerId);
    if (event.type === "converted") convertedIds.add(event.customerId);
  }

  const reached = reachedIds.size;
  return {
    deliveryRows,
    reached,
    pending:
      input.deliveries.find((row) => row.status === "pending")?.total ?? 0,
    opened: openedIds.size,
    clicked: clickedIds.size,
    converted: convertedIds.size,
    unattributedEvents,
    openRate: reached > 0 ? Math.round((openedIds.size / reached) * 1000) / 10 : null,
    clickRate: reached > 0 ? Math.round((clickedIds.size / reached) * 1000) / 10 : null,
    conversionRate:
      reached > 0 ? Math.round((convertedIds.size / reached) * 1000) / 10 : null,
  };
}
