/**
 * Cost estimates.
 *
 * Every figure is an estimate, not an invoice: provider pricing varies by plan,
 * region, committed discount and currency. The dashboard labels the basis and
 * lets an operator override each rate through the environment. Nothing here
 * calls a provider billing API.
 */

import type { CostRates } from "./config";

const GIB = 1024 ** 3;

export type CostLineItem = {
  key: "database" | "storage" | "email" | "ai";
  label: string;
  quantity: number;
  unit: string;
  monthlyUsd: number;
  basis: string;
};

export type CostEstimate = {
  lineItems: CostLineItem[];
  totalMonthlyUsd: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function estimateMonthlyCost(input: {
  databaseBytes: number;
  storageBytes: number;
  emailsLast30Days: number;
  aiCost30dUsd: number;
  rates: CostRates;
}): CostEstimate {
  const databaseGb = input.databaseBytes / GIB;
  const storageGb = input.storageBytes / GIB;

  const lineItems: CostLineItem[] = [
    {
      key: "database",
      label: "Database storage",
      quantity: round2(databaseGb * 1000) / 1000,
      unit: "GiB",
      monthlyUsd: round2(databaseGb * input.rates.dbGbMonthUsd),
      basis: `$${input.rates.dbGbMonthUsd}/GiB-month × current size`,
    },
    {
      key: "storage",
      label: "Object storage",
      quantity: round2(storageGb * 1000) / 1000,
      unit: "GiB",
      monthlyUsd: round2(storageGb * input.rates.storageGbMonthUsd),
      basis: `$${input.rates.storageGbMonthUsd}/GiB-month × current size`,
    },
    {
      key: "email",
      label: "Email",
      quantity: input.emailsLast30Days,
      unit: "messages / 30d",
      monthlyUsd: round2((input.emailsLast30Days / 1000) * input.rates.emailPer1000Usd),
      basis: `$${input.rates.emailPer1000Usd}/1,000 × trailing 30-day volume`,
    },
    {
      key: "ai",
      label: "AI providers",
      quantity: round2(input.aiCost30dUsd * 100) / 100,
      unit: "USD / 30d",
      monthlyUsd: round2(input.aiCost30dUsd),
      basis: "token usage × configured input/output rates",
    },
  ];

  return {
    lineItems,
    totalMonthlyUsd: round2(lineItems.reduce((sum, item) => sum + item.monthlyUsd, 0)),
  };
}
