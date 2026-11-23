import { describe, expect, test } from "bun:test";

import {
  chunkText,
  decodeEntities,
  isAllowedUpload,
  isPdfUpload,
  lexicalScore,
  normalizeText,
  parseDocument,
  stripHtml,
  tokenize,
} from "@/features/juno/text";

describe("HTML and document parsing", () => {
  test("strips scripts, styles and tags while keeping block boundaries", () => {
    const html = [
      "<h1>Export &amp; CSV</h1>",
      "<script>alert('x')</script>",
      "<style>.x{color:red}</style>",
      "<p>Open <b>Settings</b>, then <i>Export</i>.</p>",
    ].join("");

    const text = stripHtml(html);
    expect(text).toContain("Export & CSV");
    expect(text).toContain("Open Settings, then Export.");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("<");
  });

  test("decodes named, decimal and hex entities and leaves unknown ones alone", () => {
    expect(decodeEntities("&amp; &#39; &quot; &#x27; &nbsp; &bogus;")).toBe(
      "& ' \" '   &bogus;",
    );
  });

  test("normalizes whitespace without joining paragraphs", () => {
    expect(normalizeText("a  \r\n\tb\n\n\n\nc")).toBe("a\nb\n\nc");
  });

  test("parses JSON into its string leaves and HTML into text", () => {
    const json = parseDocument({
      filename: "faq.json",
      content: JSON.stringify({ question: "How do I export?", answer: "Use Settings." }),
    });
    expect(json.text).toContain("How do I export?");
    expect(json.text).toContain("Use Settings.");

    const html = parseDocument({
      filename: "help.html",
      content: "<title>Help</title><p>Press the button.</p>",
    });
    expect(html.text).toContain("Press the button.");
  });

  test("rejects an empty document and unsupported uploads", () => {
    expect(() => parseDocument({ filename: "empty.md", content: "   " })).toThrow();
    expect(isAllowedUpload("help.md")).toBe(true);
    expect(isAllowedUpload("data.json")).toBe(true);
    expect(isAllowedUpload("manual.yaml")).toBe(true);
    expect(isAllowedUpload("guide.pdf")).toBe(true);
    expect(isAllowedUpload("guide.pdf", "application/pdf")).toBe(true);
    expect(isPdfUpload("guide.pdf")).toBe(true);
    expect(isPdfUpload("guide.md")).toBe(false);
    expect(parseDocument({ filename: "guide.pdf", content: "Extracted text" }).title).toBe(
      "Extracted text",
    );
  });
});

describe("chunking", () => {
  test("respects the chunk size and keeps overlap", () => {
    const paragraph = "The export button is under Settings. ".repeat(120);
    const chunks = chunkText(paragraph, { maxChars: 500, overlapChars: 80 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(500);
    expect(chunks[0]).toContain("export button");
  });

  test("keeps paragraphs together and drops empty input", () => {
    const chunks = chunkText("First paragraph.\n\nSecond paragraph.");
    expect(chunks).toEqual(["First paragraph.\nSecond paragraph."]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  test("hard-slices a single oversized sentence", () => {
    const chunks = chunkText("word ".repeat(2_000), {
      maxChars: 300,
      overlapChars: 50,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(300);
  });
});

describe("lexical matching", () => {
  test("tokenizes without stopwords or punctuation", () => {
    const tokens = tokenize("How do I export a CSV, please?");
    expect(tokens).toContain("export");
    expect(tokens).toContain("csv");
    expect(tokens).not.toContain("how");
    expect(tokens).not.toContain("the");
  });

  test("scores exact terms, prefixes and unrelated text", () => {
    expect(lexicalScore("export csv", "Open Settings and export a CSV.")).toBe(1);
    expect(lexicalScore("export csv", "Billing and invoices.")).toBe(0);
    expect(lexicalScore("authentication", "Set up authenticate for SSO.")).toBe(1);
    expect(lexicalScore("", "anything")).toBe(0);
  });
});
