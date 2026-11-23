import { describe, expect, test } from "bun:test";

import { parseCsvImport, parseMarkdownImport } from "@/features/help/import-parse";

describe("help imports", () => {
  test("parses Markdown front matter and removes the first heading", () => {
    const item = parseMarkdownImport({
      content: `---\ntitle: Reset your password\nslug: reset-password\ncollection: Account\nvisibility: internal\n---\n# Reset your password\n\nOpen Settings and choose Reset.`,
    });
    expect(item).toEqual({
      title: "Reset your password",
      slug: "reset-password",
      body: "Open Settings and choose Reset.",
      collection: "Account",
      visibility: "internal",
    });
  });

  test("falls back to the heading and default collection", () => {
    const item = parseMarkdownImport({
      content: "# Install the widget\n\nPaste the snippet.",
      filename: "install.md",
      defaultCollection: "Widget",
    });
    expect(item.title).toBe("Install the widget");
    expect(item.slug).toBe("install-the-widget");
    expect(item.collection).toBe("Widget");
    expect(item.body).toBe("Paste the snippet.");
  });

  test("CSV handles quoted commas and escaped quotes", () => {
    const [item] = parseCsvImport({
      content: 'title,body,collection,slug\n"Billing, invoices","Use the ""Billing"" tab",Account,billing',
    });
    expect(item?.title).toBe("Billing, invoices");
    expect(item?.body).toBe('Use the "Billing" tab');
    expect(item?.collection).toBe("Account");
    expect(item?.slug).toBe("billing");
  });

  test("rejects a CSV without the required columns", () => {
    expect(() => parseCsvImport({ content: "name,text\nA,B" })).toThrow();
  });
});
