import { describe, expect, test } from "bun:test";

import {
  parseSuppressionCsv,
  toSuppressionCsv,
} from "@/features/email/suppression-csv";

describe("suppression CSV", () => {
  test("parses reasons, notes and duplicate addresses", () => {
    const parsed = parseSuppressionCsv(
      [
        "email,reason,note,created_at",
        "ADA@example.test,hard_bounce,mailbox full,2026-01-01T00:00:00Z",
        "ada@example.test,complaint,spam report,2026-01-02T00:00:00Z",
        "grace@example.test,,,2026-01-03T00:00:00Z",
        "not-an-email,manual,broken,2026-01-04T00:00:00Z",
      ].join("\n"),
    );

    expect(parsed.totalRows).toBe(4);
    expect(parsed.invalidRows).toBe(1);
    expect(parsed.unknownReasons).toBe(0);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      emailNormalized: "ada@example.test",
      reason: "complaint",
      note: "spam report",
    });
    expect(parsed.rows[1]).toMatchObject({
      emailNormalized: "grace@example.test",
      reason: "manual",
      note: null,
    });
  });

  test("imports unknown reasons as manual and counts them", () => {
    const parsed = parseSuppressionCsv("email,reason\nada@example.test,vacation\n");
    expect(parsed.unknownReasons).toBe(1);
    expect(parsed.rows[0]?.reason).toBe("manual");
  });

  test("requires an email column", () => {
    expect(() => parseSuppressionCsv("contact,reason\n")).toThrow(
      "The file needs an email column.",
    );
  });

  test("exports a round-trippable file with escaping", () => {
    const csv = toSuppressionCsv([
      {
        email: "ada@example.test",
        reason: "hard_bounce",
        note: "Said \"stop\", then bounced",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(csv).toContain('"Said ""stop"", then bounced"');
    const parsed = parseSuppressionCsv(csv);
    expect(parsed.rows[0]).toMatchObject({
      emailNormalized: "ada@example.test",
      reason: "hard_bounce",
      note: 'Said "stop", then bounced',
    });
  });
});
