/**
 * Pure portal funnel. Kept separate from the query module so the arithmetic is
 * testable without a database.
 */

export type PortalFunnelStep = {
  key: "views" | "submit_started" | "submissions";
  label: string;
  count: number;
  /** Share of the previous step; null for the first step or a zero baseline. */
  rate: number | null;
};

export function buildPortalFunnel(input: {
  views: number;
  submitStarts: number;
  submissions: number;
}): PortalFunnelStep[] {
  const rows: Array<Omit<PortalFunnelStep, "rate">> = [
    { key: "views", label: "Public page views", count: Math.max(0, input.views) },
    { key: "submit_started", label: "Submit form opens", count: Math.max(0, input.submitStarts) },
    { key: "submissions", label: "Submissions", count: Math.max(0, input.submissions) },
  ];

  return rows.map((row, index) => {
    const previous = rows[index - 1]?.count ?? null;
    return {
      ...row,
      rate: index === 0 || !previous ? null : row.count / previous,
    };
  });
}
