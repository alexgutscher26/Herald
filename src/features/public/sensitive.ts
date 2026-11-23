/**
 * Sensitive-information detection for public submissions.
 *
 * This is a guard-rail, not a DLP product: it catches the patterns people
 * paste by accident — payment card numbers, API keys and passwords — and lets
 * the board refuse the submission with an explanation. It runs only when the
 * board enables the check, and it never stores or echoes the matched value.
 */

export type SensitiveFinding =
  | "payment_card"
  | "private_key"
  | "cloud_key"
  | "credential";

const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const CLOUD_KEY = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/;
const CREDENTIAL =
  /\b(?:api[_-]?key|access[_-]?token|secret|password|passwd|pwd)\b\s*[:=]\s*\S{6,}/i;

/** Payment card numbers are only flagged when they also pass Luhn. */
function hasPaymentCard(text: string): boolean {
  const candidates = text.match(/\b(?:\d[ -]?){12,18}\d\b/g) ?? [];

  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    if (luhn(digits)) return true;
  }
  return false;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const digit = Number(digits[index]);
    if (double) {
      const product = digit * 2;
      sum += product > 9 ? product - 9 : product;
    } else {
      sum += digit;
    }
    double = !double;
  }

  return sum % 10 === 0;
}

export function findSensitiveInfo(text: string): SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];

  if (hasPaymentCard(text)) findings.push("payment_card");
  if (PRIVATE_KEY.test(text)) findings.push("private_key");
  if (CLOUD_KEY.test(text)) findings.push("cloud_key");
  if (CREDENTIAL.test(text)) findings.push("credential");

  return findings;
}

/** Message shown to the author; never includes the matched text. */
export function sensitiveInfoMessage(findings: SensitiveFinding[]): string {
  const labels: Record<SensitiveFinding, string> = {
    payment_card: "a payment card number",
    private_key: "a private key",
    cloud_key: "a cloud access key",
    credential: "a password or API token",
  };

  const named = [...new Set(findings)].map((finding) => labels[finding]);
  return `Remove what looks like ${named.join(" or ")} before submitting.`;
}
