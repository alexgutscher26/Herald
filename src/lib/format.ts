/**
 * Formatting helpers shared by server and client components.
 *
 * Date and time formatting/conversion lives in `@/lib/dates` and is re-exported
 * here for existing imports. Numeric and currency formatting stays here.
 */

import { DEFAULT_LOCALE } from "./dates";

export {
  DEFAULT_LOCALE,
  currentYear,
  formatDate,
  formatDateTime,
  formatMonth,
  formatRelative,
  formatShortDateTime,
  isoDateInZone,
  isoToZonedInput,
  now,
  timeZoneAbbreviation,
  zonedInputToIso,
} from "./dates";

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(DEFAULT_LOCALE).format(value);
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatMoney(cents: number): string {
  return formatCurrency(cents, "USD");
}

/**
 * Format an integer amount in minor units (cents) as a labelled currency.
 *
 * Every cents-to-display conversion goes through here. `Intl` knows the symbol
 * and the decimal rules for the currency; a workspace currency the runtime does
 * not recognise still renders the amount rather than throwing.
 */
export function formatCurrency(cents: number, currency: string): string {
  const code = currency.trim().toUpperCase() || "USD";
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat(DEFAULT_LOCALE, {
      style: "currency",
      currency: code,
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${new Intl.NumberFormat(DEFAULT_LOCALE, {
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount)} ${code}`;
  }
}

/** Dollar-denominated display prices, routed through the cents formatter. */
export function formatUsdAmount(amount: number): string {
  return formatCurrency(Math.round(amount * 100), "USD");
}

export function formatPercent(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: "percent",
    maximumFractionDigits,
  }).format(value);
}
