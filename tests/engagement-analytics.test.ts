import { describe, expect, test } from "bun:test";

import { reconcileOutboundAnalytics } from "@/features/engagement/analytics";

describe("outbound analytics reconciliation", () => {
  test("uses unique reached recipients as the rate denominator", () => {
    const result = reconcileOutboundAnalytics({
      deliveries: [
        { status: "sent", total: 2 },
        { status: "pending", total: 1 },
      ],
      deliveryRecipients: ["a", "b"],
      sentRecipients: ["b", "c"],
      events: [
        { type: "opened", customerId: "a" },
        { type: "opened", customerId: "a" },
        { type: "clicked", customerId: "b" },
        { type: "converted", customerId: "b" },
      ],
    });

    expect(result.deliveryRows).toBe(3);
    expect(result.reached).toBe(3);
    expect(result.pending).toBe(1);
    expect(result.opened).toBe(1);
    expect(result.clicked).toBe(1);
    expect(result.converted).toBe(1);
    expect(result.openRate).toBe(33.3);
    expect(result.clickRate).toBe(33.3);
    expect(result.conversionRate).toBe(33.3);
  });

  test("events without a delivery row do not enter a reach rate", () => {
    const result = reconcileOutboundAnalytics({
      deliveries: [{ status: "sent", total: 1 }],
      deliveryRecipients: ["a"],
      sentRecipients: [],
      events: [
        { type: "opened", customerId: "unknown" },
        { type: "opened", customerId: null },
      ],
    });

    expect(result.opened).toBe(0);
    expect(result.unattributedEvents).toBe(2);
    expect(result.openRate).toBe(0);
  });

  test("no delivery rows means no reach rate", () => {
    const result = reconcileOutboundAnalytics({
      deliveries: [],
      deliveryRecipients: [],
      sentRecipients: [],
      events: [{ type: "opened", customerId: null }],
    });

    expect(result.reached).toBe(0);
    expect(result.openRate).toBeNull();
    expect(result.clickRate).toBeNull();
    expect(result.conversionRate).toBeNull();
    expect(result.unattributedEvents).toBe(1);
  });
});
