/**
 * Guardrails that do not need a database.
 *
 * Mira cannot change settings, billing, accounts or customer data: its only
 * registered action is a reviewed transcript email, and it cannot mutate those
 * resources by construction. The remaining risks are what reaches the model and
 * what is stored. These helpers redact common personal and secret shapes before
 * a message is sent or recorded, and the answer prompt wraps customer text and
 * sources as untrusted data.
 *
 * Redaction is deliberately conservative and grammar-preserving: a false
 * negative is worse than an over-eager placeholder, but a false positive must
 * still leave a readable question.
 */

export const MAX_MODEL_INPUT_CHARS = 4_000;

const SECRET_PATTERN =
  /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xox[baprs]|AKIA)[-_][A-Za-z0-9_-]{12,}\b/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const IBAN_PATTERN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const CARD_PATTERN = /\b(?:\d[ -]?){13,19}\b/g;
const PHONE_PATTERN =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]\d{3,4}(?:[\s.-]\d{2,4})?/g;

export type RedactionKind = "secret" | "email" | "iban" | "ssn" | "card" | "phone";

export type RedactionCounts = Record<RedactionKind, number> & { total: number };

type Rule = {
  kind: RedactionKind;
  pattern: RegExp;
  replacement: string;
};

const RULES: Rule[] = [
  { kind: "secret", pattern: SECRET_PATTERN, replacement: "[secret]" },
  { kind: "email", pattern: EMAIL_PATTERN, replacement: "[email]" },
  { kind: "iban", pattern: IBAN_PATTERN, replacement: "[iban]" },
  { kind: "ssn", pattern: SSN_PATTERN, replacement: "[ssn]" },
  { kind: "card", pattern: CARD_PATTERN, replacement: "[card]" },
  { kind: "phone", pattern: PHONE_PATTERN, replacement: "[phone]" },
];

/** Replace personal data and credentials with stable placeholders. */
export function redactPersonalData(input: string): string {
  let output = input;
  for (const rule of RULES) {
    output = output.replace(rule.pattern, rule.replacement);
  }
  return output;
}

/** True when any rule would change the text; useful for audit counters. */
export function containsPersonalData(input: string): boolean {
  return redactPersonalData(input) !== input;
}

/**
 * Count replacements per kind without retaining any of the matched text.
 *
 * The rules run in the same order as redaction, so a phone number inside a card
 * number is counted the way it is actually replaced. RegExp objects are global;
 * `String.match` resets their lastIndex, and this function never exposes the
 * input or the matches.
 */
export function countRedactions(input: string): RedactionCounts {
  const counts: RedactionCounts = {
    total: 0,
    secret: 0,
    email: 0,
    iban: 0,
    ssn: 0,
    card: 0,
    phone: 0,
  };

  let output = input;
  for (const rule of RULES) {
    const matches = output.match(rule.pattern);
    if (matches) counts[rule.kind] += matches.length;
    output = output.replace(rule.pattern, rule.replacement);
  }

  counts.total =
    counts.secret +
    counts.email +
    counts.iban +
    counts.ssn +
    counts.card +
    counts.phone;
  return counts;
}

/**
 * Prepare one untrusted message for the model: redact, strip control
 * characters, collapse whitespace and cap the length. Newlines are kept so a
 * pasted stack trace stays readable.
 */
export function sanitizeModelInput(input: string): string {
  return redactPersonalData(input)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]{3,}/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_MODEL_INPUT_CHARS);
}

/** Whether the customer asked for an action Mira must never take itself. */
export function requestsProtectedAction(text: string): boolean {
  return /\b(cancel|downgrade|upgrade|refund|charge|delete (my )?account|change (my )?(plan|email|password)|reset (my )?password|make me (an )?admin|transfer ownership)\b/i.test(
    text,
  );
}
