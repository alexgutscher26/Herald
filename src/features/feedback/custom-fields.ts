import type {
  CustomFieldDefinition,
  CustomFieldType,
  CustomFieldValue,
} from "@/types";

/**
 * Typed custom fields, pure.
 *
 * The same validation runs for the public submit form, the dashboard editor
 * and `/api/v1`, so a value that reaches the database has exactly one shape no
 * matter which surface wrote it. No database or framework import here; the
 * unit suite exercises every branch directly.
 */

export const CUSTOM_FIELD_TYPES: readonly CustomFieldType[] = [
  "text",
  "number",
  "select",
  "date",
];

export const CUSTOM_FIELD_LIMITS = {
  label: 80,
  description: 300,
  key: 40,
  options: 40,
  optionLength: 80,
  textValue: 2_000,
  maxFields: 25,
} as const;

/** The value coercion result, shared by every caller. */
export type CustomFieldValueResult =
  | { ok: true; value: string | number }
  | { ok: false; error: string };

export type CustomFieldValuesResult =
  | { ok: true; values: Map<string, string | number> }
  | { ok: false; errors: Record<string, string> };

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isCustomFieldType(value: unknown): value is CustomFieldType {
  return (
    typeof value === "string" &&
    (CUSTOM_FIELD_TYPES as readonly string[]).includes(value)
  );
}

export function isValidCustomFieldKey(value: unknown): value is string {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

/**
 * Derive a stable key from a human label.
 *
 * Only used when the author does not supply one; an existing key is never
 * rewritten, because filters and API consumers depend on it.
 */
export function customFieldKeyFromLabel(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, CUSTOM_FIELD_LIMITS.key);

  if (base === "") return "field";
  return /^[0-9]/.test(base) ? `f_${base}`.slice(0, CUSTOM_FIELD_LIMITS.key) : base;
}

/** Trim, de-duplicate and bound a select field's option list. */
export function normalizeCustomFieldOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const options: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const option = entry.trim().slice(0, CUSTOM_FIELD_LIMITS.optionLength);
    if (option === "" || seen.has(option)) continue;
    seen.add(option);
    options.push(option);
    if (options.length >= CUSTOM_FIELD_LIMITS.options) break;
  }

  return options;
}

/** A real calendar date in `YYYY-MM-DD`, rejecting 2026-02-31. */
export function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Validate and coerce one raw input against a field definition.
 *
 * Empty input is "not provided"; the caller decides whether a required field
 * may be absent. An empty optional value returns `null` so the caller can
 * delete the stored row instead of writing an empty string.
 */
export function parseCustomFieldValue(
  field: Pick<CustomFieldDefinition, "type" | "label" | "options">,
  raw: unknown,
): CustomFieldValueResult | { ok: true; value: null } {
  const missing =
    raw === null ||
    raw === undefined ||
    (typeof raw === "string" && raw.trim() === "");

  if (missing) return { ok: true, value: null };

  switch (field.type) {
    case "text": {
      if (typeof raw !== "string") {
        return { ok: false, error: `${field.label} must be text.` };
      }
      const trimmed = raw.trim();
      if (trimmed.length > CUSTOM_FIELD_LIMITS.textValue) {
        return {
          ok: false,
          error: `${field.label} must be at most ${CUSTOM_FIELD_LIMITS.textValue} characters.`,
        };
      }
      return { ok: true, value: trimmed };
    }
    case "number": {
      const value =
        typeof raw === "number"
          ? raw
          : typeof raw === "string"
            ? Number(raw.trim())
            : Number.NaN;
      if (!Number.isFinite(value)) {
        return { ok: false, error: `${field.label} must be a number.` };
      }
      if (Math.abs(value) > 1_000_000_000_000) {
        return { ok: false, error: `${field.label} is out of range.` };
      }
      return { ok: true, value };
    }
    case "select": {
      if (typeof raw !== "string") {
        return { ok: false, error: `${field.label} must be one of its options.` };
      }
      const option = raw.trim();
      if (!field.options.includes(option)) {
        return {
          ok: false,
          error: `${field.label} must be one of: ${field.options.join(", ")}.`,
        };
      }
      return { ok: true, value: option };
    }
    case "date": {
      if (typeof raw !== "string" || !isCalendarDate(raw.trim())) {
        return { ok: false, error: `${field.label} must be a date (YYYY-MM-DD).` };
      }
      return { ok: true, value: raw.trim() };
    }
    default:
      return { ok: false, error: `${field.label} has an unsupported type.` };
  }
}

/**
 * Coerce a whole `key → raw value` record.
 *
 * Unknown keys are rejected rather than dropped: a client that misspells a
 * key should learn about it instead of believing the value was stored.
 * Required fields must be present and non-empty.
 */
export function parseCustomFieldValues(
  fields: readonly CustomFieldDefinition[],
  input: Record<string, unknown> | null | undefined,
): CustomFieldValuesResult {
  const raw = input ?? {};
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const errors: Record<string, string> = {};
  const values = new Map<string, string | number>();

  for (const key of Object.keys(raw)) {
    if (!byKey.has(key)) {
      errors[key] = `There is no custom field named “${key}”.`;
    }
  }

  for (const field of fields) {
    const parsed = parseCustomFieldValue(field, raw[field.key]);
    if (!parsed.ok) {
      errors[field.key] = parsed.error;
      continue;
    }
    if (parsed.value === null) {
      if (field.required) {
        errors[field.key] = `${field.label} is required.`;
      }
      continue;
    }
    values.set(field.id, parsed.value);
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, values };
}

/** The value a request stores for one field, or undefined when unset. */
export function customFieldValueFor(
  values: readonly CustomFieldValue[],
  postId: string,
  fieldId: string,
): string | number | undefined {
  return values.find(
    (entry) => entry.postId === postId && entry.fieldId === fieldId,
  )?.value;
}

/** Human display form: dates stay ISO, numbers use the reader's locale. */
export function formatCustomFieldValue(
  type: CustomFieldType,
  value: string | number,
): string {
  if (type === "number" && typeof value === "number") {
    return new Intl.NumberFormat("en", { maximumFractionDigits: 4 }).format(value);
  }
  return String(value);
}

/**
 * Compare two stored values of the same field for custom-field sorting.
 *
 * Numbers compare numerically (not lexically), dates stay ISO so string order
 * is chronological, and text/select use a locale-aware comparison. Missing
 * values are not handled here: the caller keeps them last in both directions.
 */
export function compareCustomFieldValues(
  type: CustomFieldType,
  left: string | number,
  right: string | number,
): number {
  if (type === "number") {
    return Number(left) - Number(right);
  }
  return String(left).localeCompare(String(right), "en", { sensitivity: "base" });
}

/**
 * Does one request satisfy every active custom-field filter?
 *
 * `filters` is keyed by field key and holds the user's raw text. Text and
 * select compare case-insensitively for text and exactly for select; number
 * and date must match the stored value exactly. A filter for a field the
 * request has no value for is a non-match, not a pass.
 */
export function matchesCustomFieldFilters(
  fields: readonly CustomFieldDefinition[],
  values: readonly CustomFieldValue[],
  postId: string,
  filters: Record<string, string>,
): boolean {
  const entries = Object.entries(filters).filter(([, value]) => value.trim() !== "");
  if (entries.length === 0) return true;

  const byKey = new Map(fields.map((field) => [field.key, field]));

  return entries.every(([key, expected]) => {
    const field = byKey.get(key);
    if (!field) return false;

    const value = customFieldValueFor(values, postId, field.id);
    if (value === undefined) return false;

    if (field.type === "text") {
      return String(value).toLowerCase().includes(expected.trim().toLowerCase());
    }
    if (field.type === "number") {
      return Number(value) === Number(expected.trim());
    }
    return String(value) === expected.trim();
  });
}
