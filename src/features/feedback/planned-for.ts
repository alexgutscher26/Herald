/**
 * The "planned for" value.
 *
 * A team can say either a quarter (`2027-Q1`) or a date (`2027-03-31`). Both
 * are stored as text so the input stays exactly what was typed, and both are
 * validated here rather than only in a form: the API, a seed and the public
 * projection all need the same rule.
 */

const QUARTER = /^(\d{4})-Q([1-4])$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type PlannedForResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function normalizePlannedFor(value: string | null | undefined): PlannedForResult {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return { ok: true, value: null };

  const quarter = QUARTER.exec(trimmed);
  if (quarter) {
    const year = Number(quarter[1]);
    if (year < 2000 || year > 2200) {
      return { ok: false, error: "Use a year between 2000 and 2200." };
    }
    return { ok: true, value: trimmed };
  }

  const date = DATE.exec(trimmed);
  if (date) {
    const year = Number(date[1]);
    const month = Number(date[2]);
    const day = Number(date[3]);
    if (year < 2000 || year > 2200 || !isValidDate(year, month, day)) {
      return { ok: false, error: "That date is not valid." };
    }
    return { ok: true, value: trimmed };
  }

  return {
    ok: false,
    error: "Use a quarter like 2027-Q1 or a date like 2027-03-31.",
  };
}

/** Human label for a stored value; unknown shapes are shown verbatim. */
export function plannedForLabel(value: string): string {
  const quarter = QUARTER.exec(value);
  if (quarter) return `Q${quarter[2]} ${quarter[1]}`;

  const date = DATE.exec(value);
  if (date) {
    const parsed = new Date(
      Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])),
    );
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(parsed);
    }
  }

  return value;
}
