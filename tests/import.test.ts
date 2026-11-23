import { describe, expect, test } from "bun:test";

import {
  detectFormat,
  mapCategory,
  mapStatus,
  parseCreatedAt,
  parseVotes,
  suggestMapping,
  validateMapping,
} from "@/features/import/adapters";
import { parseCsv, toCsv } from "@/features/import/csv";
import { firstImageUrl, planImportRows } from "@/features/import/plan";
import { applyPresetMapping, presetApplies } from "@/features/import/presets";
import {
  GITHUB_HEADERS,
  GITHUB_MAPPING,
  HERALD_HEADERS,
  HERALD_MAPPING,
  isGithubIssue,
  mapGithubIssue,
  mapHeraldRequest,
} from "@/features/import/sources-map";
import { presetSignature, rowToData } from "@/features/import/types";

/**
 * The importer's pure layer.
 *
 * The browser preview and the background job call these same functions, so
 * these tests are the contract that keeps the two from disagreeing about a
 * quoted cell, a status word or a mapped column.
 */

describe("CSV parsing", () => {
  test("keeps quoted delimiters, escaped quotes and newlines inside one cell", () => {
    const parsed = parseCsv(
      'Title,Details\n"Dark, mode","He said ""yes""\nand left"\n',
    );

    expect(parsed.headers).toEqual(["Title", "Details"]);
    expect(parsed.rows).toEqual([["Dark, mode", 'He said "yes"\nand left']]);
    expect(parsed.delimiter).toBe(",");
  });

  test("chooses a semicolon or tab delimiter when that is the wider table", () => {
    const semicolon = parseCsv("Title;Board;Votes\nOne;Feedback;3\n");
    expect(semicolon.delimiter).toBe(";");
    expect(semicolon.rows).toEqual([["One", "Feedback", "3"]]);

    const tab = parseCsv("Title\tBoard\nOne\tFeedback\n");
    expect(tab.delimiter).toBe("\t");
    expect(tab.rows).toEqual([["One", "Feedback"]]);
  });

  test("strips a BOM and names missing or repeated headers distinctly", () => {
    const parsed = parseCsv("\uFEFFTitle,,Title\nOne,two,three\n");

    expect(parsed.headers).toEqual(["Title", "Column 2", "Title (2)"]);
  });

  test("ignores blank lines and rejects input that has no table", () => {
    expect(parseCsv("Title,Body\n\nOne,Two\n\n").rows).toEqual([["One", "Two"]]);
    expect(() => parseCsv("   ")).toThrow("The file is empty.");
    expect(() => parseCsv("Just one column\nvalue")).toThrow(
      "does not look like a CSV",
    );
  });

  test("round-trips values that need quoting", () => {
    const csv = toCsv([
      ["title", "body"],
      ["A, B", 'line one\nline "two"'],
    ]);

    expect(csv).toBe('title,body\r\n"A, B","line one\nline ""two"""\r\n');
    expect(parseCsv(csv).rows).toEqual([["A, B", 'line one\nline "two"']]);
  });
});

describe("import adapters", () => {
  test("detects a Canny export and maps its columns", () => {
    const headers = [
      "Title",
      "Details",
      "Board",
      "Vote count",
      "Author",
      "Created",
      "Status",
    ];

    expect(detectFormat(headers)).toBe("canny");

    const mapping = suggestMapping(headers, "canny");
    expect(mapping).toEqual({
      title: "Title",
      body: "Details",
      board: "Board",
      status: "Status",
      authorName: "Author",
      votes: "Vote count",
      createdAt: "Created",
    });
  });

  test("detects Productboard and Nolt exports without claiming a header twice", () => {
    const productboard = ["Name", "Description", "User impact", "Owner"];
    expect(detectFormat(productboard)).toBe("productboard");
    expect(suggestMapping(productboard, "productboard")).toMatchObject({
      title: "Name",
      body: "Description",
      votes: "User impact",
      authorName: "Owner",
    });

    expect(detectFormat(["Title", "Body", "Votes", "Author"])).toBe("nolt");
    // "Author" can only feed one field.
    const nolt = suggestMapping(["Title", "Body", "Votes", "Author"], "nolt");
    expect(nolt.title).toBe("Title");
    expect(nolt.authorName).toBe("Author");
    expect(nolt.body).toBe("Body");
  });

  test("a weak header set stays generic", () => {
    expect(detectFormat(["What", "Where"])).toBe("generic");
    expect(detectFormat([])).toBe("generic");
  });

  test("validates that mapped columns exist and a title is mapped", () => {
    expect(validateMapping(["Title", "Body"], { title: "Title" })).toEqual({
      ok: true,
      mapping: { title: "Title" },
    });
    expect(validateMapping(["Title"], { body: "Details" })).toEqual({
      ok: false,
      error: 'The column "Details" is not in this file.',
    });
    expect(validateMapping(["Title"], { body: "Title" })).toEqual({
      ok: false,
      error: "Map a column to Title before importing.",
    });
  });

  test("normalizes statuses, categories, votes and dates", () => {
    expect(mapStatus("In progress")).toBe("in_progress");
    expect(mapStatus("Under consideration")).toBe("under_review");
    expect(mapStatus("Won't do")).toBe("closed");
    expect(mapStatus("Shipped!")).toBe("shipped");
    expect(mapStatus("something else")).toBeNull();
    expect(mapStatus(undefined)).toBeNull();

    expect(mapCategory("Feature Request")).toBe("feature_request");
    expect(mapCategory("Defect")).toBe("bug");
    expect(mapCategory("support")).toBe("question");
    expect(mapCategory("unknown")).toBeNull();

    expect(parseVotes("1,204")).toBe(1204);
    expect(parseVotes("0")).toBe(0);
    expect(parseVotes("many")).toBeNull();
    expect(parseVotes(undefined)).toBeNull();

    expect(parseCreatedAt("2024-02-03")?.toISOString()).toBe(
      "2024-02-03T00:00:00.000Z",
    );
    expect(parseCreatedAt("not a date")).toBeNull();
  });

  test("a row only carries mapped, non-empty values", () => {
    const data = rowToData(
      ["Title", "Details", "Votes"],
      ["Dark mode", "   ", "4"],
      { title: "Title", body: "Details", votes: "Votes" },
    );

    expect(data).toEqual({ title: "Dark mode", votes: "4" });
  });

  test("detects Frill and Beamer exports and maps their columns", () => {
    const frill = ["Title", "Description", "Status", "Votes", "Author", "Created at"];
    expect(detectFormat(frill)).toBe("frill");
    expect(suggestMapping(frill, "frill")).toMatchObject({
      title: "Title",
      body: "Description",
      status: "Status",
      votes: "Votes",
      authorName: "Author",
      createdAt: "Created at",
    });

    const beamer = ["Title", "Content", "Published at", "Category", "Reactions"];
    expect(detectFormat(beamer)).toBe("beamer");
    expect(suggestMapping(beamer, "beamer")).toMatchObject({
      title: "Title",
      body: "Content",
      category: "Category",
      votes: "Reactions",
      createdAt: "Published at",
    });
  });

  test("maps a cover image URL column", () => {
    const data = rowToData(
      ["Title", "Cover image"],
      ["Dark mode", "https://cdn.example.com/cover.png"],
      { title: "Title", imageUrl: "Cover image" },
    );
    expect(data.imageUrl).toBe("https://cdn.example.com/cover.png");
  });
});

describe("dry run planning", () => {
  test("counts importable, failed and skipped rows without writing", () => {
    const plan = planImportRows({
      headers: ["Title", "Board", "Status"],
      rows: [
        ["One", "Feedback", "Planned"],
        ["", "Feedback", ""],
        ["", "", ""],
        ["Two", "Archive", ""],
        ["Three", "Feedback", "mystery"],
      ],
      mapping: { title: "Title", board: "Board", status: "Status" },
      fallbackBoardId: "fallback",
      boardMap: new Map([
        ["feedback", "board-1"],
        ["archive", "board-2"],
      ]),
      archived: new Set(["board-2"]),
    });

    expect(plan.totalRows).toBe(5);
    expect(plan.importable).toBe(2);
    expect(plan.failed).toBe(2);
    expect(plan.skipped).toBe(1);
    expect(plan.warnings).toBe(1);
    expect(plan.issues[0]?.rowNumber).toBe(2);
  });

  test("finds the first Markdown or HTML image", () => {
    expect(firstImageUrl("![shot](https://cdn.example.com/a.png)")).toBe(
      "https://cdn.example.com/a.png",
    );
    expect(firstImageUrl('<p><img src="https://cdn.example.com/b.jpg" /></p>')).toBe(
      "https://cdn.example.com/b.jpg",
    );
    expect(firstImageUrl("no image here")).toBeNull();
  });
});

describe("mapping presets", () => {
  test("matches the same columns in another order and remaps their names", () => {
    const headers = ["Votes", "Title", "Details"];
    const preset = {
      signature: presetSignature(["Title", "Details", "Votes"]),
    };

    expect(presetApplies(preset, headers)).toBe(true);
    expect(
      applyPresetMapping({ title: "title", body: "DETAILS", votes: "Votes" }, headers),
    ).toEqual({ title: "Title", body: "Details", votes: "Votes" });
  });

  test("refuses a preset whose title column is missing", () => {
    expect(applyPresetMapping({ body: "Details" }, ["Details"])).toBeNull();
  });
});

describe("API source mappings", () => {
  test("maps a GitHub issue, using labels for status and category", () => {
    const issue = {
      number: 12,
      title: "Dark mode",
      body: "Screenshot: ![shot](https://cdn.example.com/dark.png)",
      state: "open",
      labels: [{ name: "planned" }, { name: "bug" }],
      user: { login: "octocat" },
      created_at: "2024-02-03T00:00:00Z",
      html_url: "https://github.com/o/r/issues/12",
    };

    expect(isGithubIssue(issue)).toBe(true);
    expect(isGithubIssue({ ...issue, pull_request: {} })).toBe(false);

    const row = mapGithubIssue(issue);
    const data = rowToData([...GITHUB_HEADERS], row, GITHUB_MAPPING);
    expect(data).toMatchObject({
      title: "Dark mode",
      status: "planned",
      category: "bug",
      authorName: "octocat",
      imageUrl: "https://cdn.example.com/dark.png",
    });
  });

  test("maps a Herald API request, including board, votes and cover", () => {
    const row = mapHeraldRequest({
      title: "Export to CSV",
      body: "<img src=\"https://cdn.example.com/export.png\">",
      status: "in_progress",
      category: "feature_request",
      board: { slug: "feedback" },
      author: { name: "Ada", email: "ada@example.com" },
      vote_count: 7,
      created_at: "2024-03-04T00:00:00Z",
    });

    expect(rowToData([...HERALD_HEADERS], row, HERALD_MAPPING)).toMatchObject({
      title: "Export to CSV",
      board: "feedback",
      status: "in_progress",
      authorName: "Ada",
      authorEmail: "ada@example.com",
      votes: "7",
      imageUrl: "https://cdn.example.com/export.png",
    });
  });
});
