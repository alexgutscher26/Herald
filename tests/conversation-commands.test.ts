import { describe, expect, test } from "bun:test";

import {
  parseComposerInput,
  parseSnoozeMinutes,
} from "@/features/conversations/commands";
import { inboxHref, parseInboxFilters } from "@/features/conversations/filters";

describe("composer commands", () => {
  test("plain text is a customer-visible reply", () => {
    expect(parseComposerInput("  We shipped this today.  ")).toEqual({
      kind: "message",
      body: "We shipped this today.",
    });
  });

  test("an empty message is rejected before any write", () => {
    expect(parseComposerInput("   ")).toEqual({
      kind: "error",
      error: "Write a reply first.",
    });
  });

  test("/note keeps the text internal and requires text", () => {
    expect(parseComposerInput("/note Waiting on billing")).toEqual({
      kind: "note",
      body: "Waiting on billing",
    });
    expect(parseComposerInput("/note")).toEqual({
      kind: "error",
      error: "Write something after /note.",
    });
  });

  test("status commands accept trailing text and keep it as the reply", () => {
    expect(parseComposerInput("/resolve Fixed in 2.4")).toEqual({
      kind: "status",
      status: "resolved",
      body: "Fixed in 2.4",
    });
    expect(parseComposerInput("/reopen")).toEqual({
      kind: "status",
      status: "open",
      body: "",
    });
    expect(parseComposerInput("/spam")).toMatchObject({ kind: "status", status: "spam" });
    expect(parseComposerInput("/archive")).toMatchObject({
      kind: "status",
      status: "archived",
    });
  });

  test("/snooze accepts minutes, hours and days", () => {
    expect(parseComposerInput("/snooze 30m")).toEqual({
      kind: "snooze",
      minutes: 30,
      body: "",
    });
    expect(parseComposerInput("/snooze 2h back tomorrow")).toEqual({
      kind: "snooze",
      minutes: 120,
      body: "back tomorrow",
    });
    expect(parseComposerInput("/snooze 3d")).toEqual({
      kind: "snooze",
      minutes: 4320,
      body: "",
    });
  });

  test("/snooze rejects missing, malformed and out-of-range durations", () => {
    for (const input of ["/snooze", "/snooze soon", "/snooze 1m", "/snooze 31d"]) {
      const parsed = parseComposerInput(input);
      expect(parsed.kind).toBe("error");
    }
  });

  test("an unknown command is an error, not a message", () => {
    const parsed = parseComposerInput("/shrug maybe");
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") expect(parsed.error).toContain("Unknown command");
  });

  test("a slash inside a sentence is ordinary text", () => {
    expect(parseComposerInput("Please /resolve this when you can")).toEqual({
      kind: "message",
      body: "Please /resolve this when you can",
    });
  });

  test("parseSnoozeMinutes clamps to 5 minutes and 30 days", () => {
    expect(parseSnoozeMinutes("5")).toBe(5);
    expect(parseSnoozeMinutes("4")).toBeNull();
    expect(parseSnoozeMinutes("43200")).toBe(43_200);
    expect(parseSnoozeMinutes("43201")).toBeNull();
    expect(parseSnoozeMinutes("0")).toBeNull();
    expect(parseSnoozeMinutes("-30m")).toBeNull();
  });
});

describe("inbox filters", () => {
  test("an empty query is the queue, anyone", () => {
    expect(parseInboxFilters({})).toEqual({
      view: "queue",
      query: "",
      assignee: "any",
      tag: "",
    });
  });

  test("known views and assignee filters are kept", () => {
    expect(
      parseInboxFilters({ view: "spam", q: "  billing  ", assignee: "me" }),
    ).toEqual({ view: "spam", query: "billing", assignee: "me", tag: "" });
    expect(parseInboxFilters({ assignee: "unassigned" }).assignee).toBe("unassigned");
  });

  test("unknown or repeated values fall back without widening", () => {
    expect(parseInboxFilters({ view: "inbox", assignee: "someone" })).toEqual({
      view: "queue",
      query: "",
      assignee: "any",
      tag: "",
    });
    expect(parseInboxFilters({ view: ["resolved", "spam"] }).view).toBe("resolved");
  });

  test("the search term is trimmed and bounded", () => {
    const long = "x".repeat(400);
    expect(parseInboxFilters({ q: long }).query).toHaveLength(120);
  });

  test("a tag filter is normalized and preserved in links", () => {
    const filters = parseInboxFilters({ tag: "  billing  " });
    expect(filters.tag).toBe("billing");
    expect(inboxHref("/app/acme/app/conversations", filters)).toBe(
      "/app/acme/app/conversations?tag=billing",
    );
    expect(inboxHref("/app/acme/app/conversations", filters, { tag: "" })).toBe(
      "/app/acme/app/conversations",
    );
  });

  test("inboxHref preserves the other filters and omits defaults", () => {
    const filters = {
      view: "spam" as const,
      query: "billing",
      assignee: "me" as const,
      tag: "" as const,
    };
    expect(inboxHref("/app/acme/app/conversations", filters)).toBe(
      "/app/acme/app/conversations?view=spam&q=billing&assignee=me",
    );
    expect(inboxHref("/app/acme/app/conversations", filters, { assignee: "any" })).toBe(
      "/app/acme/app/conversations?view=spam&q=billing",
    );
    expect(
      inboxHref(
        "/app/acme/app/conversations",
        { view: "queue", query: "", assignee: "any", tag: "" },
        {},
      ),
    ).toBe("/app/acme/app/conversations");
  });
});
