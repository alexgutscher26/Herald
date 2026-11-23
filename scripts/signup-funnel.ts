/**
 * Print the company signup funnel from real Postgres events.
 *
 * Usage: `bun run analytics:signup-funnel [--days=30]`
 *
 * The output contains aggregate counts only. It never prints a hash, email,
 * account id or workspace id; see docs/signup-funnel-privacy.md.
 */

import { getSignupFunnel } from "@/features/analytics/signup-funnel";

function daysFromArgs(): number {
  const raw = process.argv.find((argument) => argument.startsWith("--days="));
  const parsed = Number(raw?.slice("--days=".length) ?? 30);
  if (!Number.isFinite(parsed) || parsed < 1) return 30;
  return Math.min(Math.trunc(parsed), 365);
}

function percent(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

try {
  const report = await getSignupFunnel({ days: daysFromArgs() });
  console.log(`Signup funnel · ${report.from} to ${report.to} (UTC)`);
  console.log("");
  for (const step of report.steps) {
    console.log(
      `${step.label.padEnd(28)} ${String(step.count).padStart(7)}  ${percent(step.rate).padStart(7)}`,
    );
  }
  console.log("");
  console.log(
    "Rates are directional: a later stage can include subjects that entered before the window.",
  );
  console.log("Privacy review: docs/signup-funnel-privacy.md");
} catch (error) {
  console.error(
    "Could not read the signup funnel:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
}
