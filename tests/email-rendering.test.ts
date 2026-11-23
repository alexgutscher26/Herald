import { describe, expect, test } from "bun:test";

import { buildEmailPreviews } from "@/features/email/previews";

describe("email rendering checks", () => {
  const previews = buildEmailPreviews("https://app.herald.test");

  test("covers every outbound template with sample data", () => {
    expect(previews.length).toBe(27);
    for (const preview of previews) {
      expect(preview.subject.trim().length).toBeGreaterThan(0);
      expect(preview.subject).not.toContain("\n");
      expect(preview.html).toContain("<!doctype html>");
      expect(preview.text.trim().length).toBeGreaterThan(0);
    }
  });

  test("each template carries dark-mode, mobile and Outlook-safe structure", () => {
    for (const preview of previews) {
      expect(preview.html).toContain('name="color-scheme" content="light dark"');
      expect(preview.html).toContain('name="supported-color-schemes" content="light dark"');
      expect(preview.html).toContain("@media (prefers-color-scheme: dark)");
      expect(preview.html).toContain("@media only screen and (max-width: 600px)");
      expect(preview.html).toContain("<!--[if mso]>");
      expect(preview.html).toContain('role="presentation"');
      expect(preview.html).toContain('class="email-card"');
      expect(preview.html).toContain('class="email-text"');
    }
  });

  test("every preview URL points at the configured origin", () => {
    for (const preview of previews) {
      expect(preview.html).not.toContain("http://");
    }
  });
});
