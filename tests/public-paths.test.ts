import { describe, expect, test } from "bun:test";

import {
  parsePublicPath,
  publicBoardPath,
  publicProductPath,
  publicRequestPath,
  publicRoadmapPath,
  publicSubmitPath,
} from "@/features/public/paths";

describe("parsePublicPath", () => {
  test("parses a board path", () => {
    expect(parsePublicPath("/p/acme/widgets/feedback")).toEqual({
      workspaceSlug: "acme",
      productSlug: "widgets",
      boardSlug: "feedback",
    });
  });

  test("parses a product path without a board", () => {
    expect(parsePublicPath("/p/acme/widgets")).toEqual({
      workspaceSlug: "acme",
      productSlug: "widgets",
      boardSlug: null,
    });
  });

  test("accepts a trailing slash, query string and fragment", () => {
    expect(parsePublicPath("/p/acme/widgets/feedback/?sort=new#top")).toEqual({
      workspaceSlug: "acme",
      productSlug: "widgets",
      boardSlug: "feedback",
    });
  });

  test("rejects paths that are not under /p", () => {
    expect(parsePublicPath("/app/acme/widgets")).toBeNull();
    expect(parsePublicPath("/")).toBeNull();
  });

  test("rejects incomplete and over-deep paths", () => {
    expect(parsePublicPath("/p/acme")).toBeNull();
    expect(parsePublicPath("/p/acme/widgets/feedback/extra")).toBeNull();
  });
});

describe("public path builders", () => {
  test("builds a product path", () => {
    expect(publicProductPath("acme", "widgets")).toBe("/p/acme/widgets");
  });

  test("builds a board path and encodes segments", () => {
    expect(publicBoardPath("acme", "widgets", "feedback")).toBe(
      "/p/acme/widgets/feedback",
    );
    expect(publicBoardPath("a b", "widgets", "feedback")).toBe(
      "/p/a%20b/widgets/feedback",
    );
  });

  test("builds the public roadmap path", () => {
    expect(publicRoadmapPath("acme", "widgets")).toBe(
      "/p/acme/widgets/roadmap",
    );
  });

  test("builds a request path beneath its board", () => {
    expect(publicRequestPath("acme", "widgets", "feedback", "abc")).toBe(
      "/p/acme/widgets/feedback/abc",
    );
  });

  test("builds a submit path beneath its board", () => {
    expect(publicSubmitPath("acme", "widgets", "feedback")).toBe(
      "/p/acme/widgets/feedback/submit",
    );
  });
});
