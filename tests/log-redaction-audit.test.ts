import { describe, expect, test } from "bun:test";

import { formatLogEntry, redactFields, serializeError } from "@/lib/logger";

/**
 * Redaction audit.
 *
 * This is deliberately an end-to-end corpus rather than a unit test of one
 * regex: the failure mode that matters is a realistic payload — a provider
 * error, a URL, nested headers — reaching the drain with an identifier still in
 * it. Add a case here whenever a new field type is logged.
 */

const SECRETS = [
  "person@example.com",
  "alex@corp.example",
  "sk_" + "live_51H8xYzAbCdEf",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
  "4242 4242 4242 4242",
  "203.0.113.9",
  "+14155550123",
  "reset-secret-123",
  "hunter2",
];

const corpus = {
  email: "person@example.com",
  message:
    "Password reset for alex@corp.example failed: Bearer sk_" + "live_51H8xYzAbCdEf rejected",
  url: "https://app.example.com/reset?token=reset-secret-123&next=%2Fapp",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
  card: "4242 4242 4242 4242",
  ip: "203.0.113.9",
  phone: "+14155550123",
  password: "hunter2",
  headers: {
    authorization: "Bearer sk_" + "live_51H8xYzAbCdEf",
    cookie: "herald_customer_session=abc123; theme=dark",
  },
  nested: {
    actor: { email: "alex@corp.example", name: "Alex" },
    attempts: [{ token: "reset-secret-123" }],
  },
  error: new Error(
    "Failed for alex@corp.example with Bearer sk_" + "live_51H8xYzAbCdEf and +14155550123",
  ),
};

function stringsIn(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) stringsIn(item, output);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) stringsIn(item, output);
  }
  return output;
}

describe("logger redaction audit", () => {
  test("no PII survives a realistic log line", () => {
    const line = formatLogEntry("error", "auth.password_reset.failed", corpus);
    expect(line.includes("\n")).toBe(false);

    const parsed = JSON.parse(line) as Record<string, unknown>;
    const strings = stringsIn(parsed).join("\n");

    for (const secret of SECRETS) {
      expect(strings).not.toContain(secret);
    }
    expect(strings).not.toContain("@");
  });

  test("credential keys are replaced at every depth", () => {
    const redacted = redactFields({
      password: corpus.password,
      headers: corpus.headers,
      nested: corpus.nested,
      attempts: [{ token: "reset-secret-123" }],
    });
    expect(redacted.password).toBe("[redacted]");
    expect((redacted.headers as Record<string, unknown>).authorization).toBe(
      "[redacted]",
    );
    expect((redacted.headers as Record<string, unknown>).cookie).toBe("[redacted]");
    expect(
      (redacted.attempts as Array<Record<string, unknown>>)[0]?.token,
    ).toBe("[redacted]");
    expect(
      (redacted.nested as { actor: { email: string } }).actor.email,
    ).toBe("[redacted]");
  });

  test("serializeError scrubs the message and keeps the shape", () => {
    const serialized = serializeError(corpus.error);
    expect(serialized.name).toBe("Error");
    expect(serialized.message).not.toContain("alex@corp.example");
    expect(serialized.message).not.toContain("sk_live");
    expect(serialized.message).not.toContain("+14155550123");
  });

  test("a circular object does not crash or leak", () => {
    const circular: Record<string, unknown> = { email: "person@example.com" };
    circular.self = circular;
    const line = formatLogEntry("warn", "audit.circular", circular);
    expect(line).toContain("[circular]");
    expect(line).not.toContain("person@example.com");
  });
});
