import { describe, expect, test } from "bun:test";

import { decodeCursor, encodeCursor, isUuid } from "@/features/api-v1/cursor";
import {
  parseBoardSort,
  parseChangelogFilters,
  parseConversationFilters,
  parseRequestFilters,
  requestSortKey,
} from "@/features/api-v1/filters";
import {
  idempotencyRequestHash,
  isIdempotencyKeyShaped,
} from "@/features/api-v1/idempotency-core";
import { openApiDocument } from "@/features/api-v1/openapi";
import {
  API_ROUTE_DEFINITIONS,
  apiPathIsDeclared,
  matchesApiPath,
} from "@/features/api-v1/routes";
import { scopeAllows, scopeAllowsRead } from "@/features/api-v1/scopes";
import {
  API_TOKEN_PREFIX_LENGTH,
  createApiTokenMaterial,
  hashApiToken,
  isApiTokenShaped,
  readBearerToken,
} from "@/features/api-v1/token";

/**
 * Pure contract tests for the v1 API: token grammar, cursors, filter parsing,
 * idempotency keys and the OpenAPI document. No database and no socket.
 */

describe("api tokens", () => {
  test("mints a prefixed token and stores only its hash", () => {
    const material = createApiTokenMaterial();

    expect(material.token).toMatch(/^hrl_[a-f0-9]{8}_[A-Za-z0-9_-]{43}$/);
    expect(material.token.slice(0, API_TOKEN_PREFIX_LENGTH)).toBe(material.prefix);
    expect(material.tokenHash).toBe(hashApiToken(material.token));
    expect(material.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(material.tokenHash).not.toContain(material.token);
    expect(isApiTokenShaped(material.token)).toBe(true);
  });

  test("tokens are unique per call", () => {
    const first = createApiTokenMaterial();
    const second = createApiTokenMaterial();

    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).not.toBe(second.tokenHash);
  });

  test("rejects values that are not shaped like a Herald token", () => {
    expect(isApiTokenShaped("")).toBe(false);
    expect(isApiTokenShaped("hrl_short")).toBe(false);
    expect(isApiTokenShaped(["sk", "live", "000000000000000000000000"].join("_"))).toBe(false);
    expect(isApiTokenShaped(`hrl_00000000_${"!".repeat(43)}`)).toBe(false);
    expect(isApiTokenShaped(null)).toBe(false);
  });

  test("reads a bearer header case-insensitively and rejects other schemes", () => {
    expect(readBearerToken("Bearer abc_def")).toBe("abc_def");
    expect(readBearerToken("bearer abc_def")).toBe("abc_def");
    expect(readBearerToken("  Bearer   abc_def  ")).toBe("abc_def");
    expect(readBearerToken("Basic abc_def")).toBeNull();
    expect(readBearerToken("Bearer")).toBeNull();
    expect(readBearerToken("Bearer a b")).toBeNull();
    expect(readBearerToken(null)).toBeNull();
  });
});

describe("cursors", () => {
  const id = "5f0c8f9a-6a2e-4f0e-9d4a-1c2b3a4d5e6f";

  test("round-trips sort, value and id", () => {
    const encoded = encodeCursor({ sort: "newest", value: "2026-01-02T03:04:05.000Z", id });
    const decoded = decodeCursor(encoded);

    expect(decoded).toEqual({
      v: 1,
      sort: "newest",
      value: "2026-01-02T03:04:05.000Z",
      id,
    });
  });

  test("is opaque and URL-safe", () => {
    const encoded = encodeCursor({ sort: "votes", value: "12", id });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain("{");
  });

  test("rejects malformed, oversized and foreign payloads", () => {
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor("x".repeat(600))).toBeNull();

    const wrongVersion = Buffer.from(
      JSON.stringify({ v: 2, sort: "newest", value: "1", id }),
    ).toString("base64url");
    expect(decodeCursor(wrongVersion)).toBeNull();

    const badId = Buffer.from(
      JSON.stringify({ v: 1, sort: "newest", value: "1", id: "nope" }),
    ).toString("base64url");
    expect(decodeCursor(badId)).toBeNull();
  });

  test("recognizes only versioned UUIDs", () => {
    expect(isUuid(id)).toBe(true);
    expect(isUuid(id.toUpperCase())).toBe(true);
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(isUuid(123)).toBe(false);
  });
});

describe("filters", () => {
  test("request defaults are explicit, not implicit", () => {
    const parsed = parseRequestFilters(new URLSearchParams());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value).toMatchObject({
      status: null,
      board: null,
      tag: null,
      author: null,
      updatedSince: null,
      query: "",
      sort: "newest",
      customSort: null,
      limit: 25,
      cursor: null,
      includeArchived: false,
      includeMerged: false,
    });
  });

  test("parses every documented request filter", () => {
    const parsed = parseRequestFilters(
      new URLSearchParams({
        status: "planned",
        board: "feature-requests",
        tag: "api",
        author: "person@example.test",
        updated_since: "2026-01-01T00:00:00.000Z",
        q: "dark mode",
        sort: "votes",
        limit: "50",
        include_archived: "true",
        include_merged: "1",
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.status).toBe("planned");
    expect(parsed.value.board).toBe("feature-requests");
    expect(parsed.value.tag).toBe("api");
    expect(parsed.value.author).toBe("person@example.test");
    expect(parsed.value.updatedSince?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.value.sort).toBe("votes");
    expect(parsed.value.limit).toBe(50);
    expect(parsed.value.includeArchived).toBe(true);
    expect(parsed.value.includeMerged).toBe(true);
  });

  test("parses either direction of a custom-field sort", () => {
    const ascending = parseRequestFilters(
      new URLSearchParams({ sort: "custom_field_asc:seat_count" }),
    );
    expect(ascending.ok).toBe(true);
    if (!ascending.ok) return;
    expect(ascending.value.sort).toBe("newest");
    expect(ascending.value.customSort).toEqual({
      key: "seat_count",
      direction: "asc",
    });
    expect(requestSortKey(ascending.value.sort, ascending.value.customSort)).toBe(
      "custom_field_asc:seat_count",
    );

    const descending = parseRequestFilters(
      new URLSearchParams({ sort: "custom_field_desc:seat_count" }),
    );
    expect(descending.ok).toBe(true);
    if (!descending.ok) return;
    expect(descending.value.customSort).toEqual({
      key: "seat_count",
      direction: "desc",
    });
  });

  test("rejects malformed custom-field sort keys", () => {
    expect(
      parseRequestFilters(new URLSearchParams({ sort: "custom_field_asc:Bad Key" })).ok,
    ).toBe(false);
    expect(
      parseRequestFilters(new URLSearchParams({ sort: "custom_field_up:seats" })).ok,
    ).toBe(false);
    expect(
      parseRequestFilters(new URLSearchParams({ sort: "custom_field_asc:" })).ok,
    ).toBe(false);
  });

  test("unknown status, sort, limit and timestamp are rejected", () => {
    expect(parseRequestFilters(new URLSearchParams({ status: "nope" })).ok).toBe(false);
    expect(parseRequestFilters(new URLSearchParams({ sort: "popular" })).ok).toBe(false);
    expect(parseRequestFilters(new URLSearchParams({ limit: "0" })).ok).toBe(false);
    expect(parseRequestFilters(new URLSearchParams({ limit: "101" })).ok).toBe(false);
    expect(
      parseRequestFilters(new URLSearchParams({ updated_since: "yesterday" })).ok,
    ).toBe(false);
    expect(
      parseRequestFilters(new URLSearchParams({ include_archived: "maybe" })).ok,
    ).toBe(false);
  });

  test("a cursor is bound to the sort it was issued for", () => {
    const id = "5f0c8f9a-6a2e-4f0e-9d4a-1c2b3a4d5e6f";
    const cursor = encodeCursor({ sort: "oldest", value: "2026-01-01T00:00:00.000Z", id });

    expect(parseRequestFilters(new URLSearchParams({ cursor })).ok).toBe(false);
    expect(
      parseRequestFilters(new URLSearchParams({ cursor, sort: "oldest" })).ok,
    ).toBe(true);

    const customCursor = encodeCursor({
      sort: "custom_field_desc:seat_count",
      value: "42",
      id,
    });
    expect(
      parseRequestFilters(
        new URLSearchParams({ cursor: customCursor, sort: "custom_field_desc:seat_count" }),
      ).ok,
    ).toBe(true);
    expect(
      parseRequestFilters(
        new URLSearchParams({ cursor: customCursor, sort: "custom_field_asc:seat_count" }),
      ).ok,
    ).toBe(false);
  });

  test("changelog and conversation filters validate their own enums", () => {
    expect(parseChangelogFilters(new URLSearchParams({ status: "published" })).ok).toBe(
      true,
    );
    expect(parseChangelogFilters(new URLSearchParams({ status: "live" })).ok).toBe(false);

    const conversations = parseConversationFilters(
      new URLSearchParams({ inbox_state: "all", assignee: "me" }),
    );
    expect(conversations.ok).toBe(true);
    if (!conversations.ok) return;
    expect(conversations.value.inboxState).toBe("all");
    expect(conversations.value.assignee).toBe("me");

    expect(
      parseConversationFilters(new URLSearchParams({ inbox_state: "everything" })).ok,
    ).toBe(false);
    expect(parseBoardSort(new URLSearchParams({ sort: "name" })).ok).toBe(true);
    expect(parseBoardSort(new URLSearchParams({ sort: "bogus" })).ok).toBe(false);
  });
});

describe("API route manifest", () => {
  test("matches path placeholders without accepting undeclared paths", () => {
    const id = "5f0c8f9a-6a2e-4f0e-9d4a-1c2b3a4d5e6f";

    expect(matchesApiPath("/requests/{request_id}", ["requests", id])).toBe(true);
    expect(matchesApiPath("/requests/{request_id}", ["requests"])).toBe(false);
    expect(matchesApiPath("/requests/{request_id}", ["requests", id, "extra"])).toBe(
      false,
    );
    expect(apiPathIsDeclared([])).toBe(true);
    expect(apiPathIsDeclared(["boards"])).toBe(true);
    expect(apiPathIsDeclared(["boards", id])).toBe(true);
    expect(apiPathIsDeclared(["not-a-resource"])).toBe(false);
  });
});

describe("API scopes", () => {
  test("read stays workspace-wide while resource reads stay narrow", () => {
    expect(scopeAllowsRead(["read"], "feedback")).toBe(true);
    expect(scopeAllowsRead(["read"], "support")).toBe(true);
    expect(scopeAllowsRead(["read"], null)).toBe(true);

    expect(scopeAllowsRead(["feedback:read"], "feedback")).toBe(true);
    expect(scopeAllowsRead(["feedback:read"], "support")).toBe(false);
    expect(scopeAllowsRead(["support:read"], "support")).toBe(true);
    expect(scopeAllowsRead(["support:read"], "feedback")).toBe(false);
    expect(scopeAllowsRead(["support:read"], null)).toBe(true);
  });

  test("admin implies every scope but write does not imply read", () => {
    expect(scopeAllowsRead(["admin"], "support")).toBe(true);
    expect(scopeAllows(["admin"], "write")).toBe(true);
    expect(scopeAllows(["admin"], "feedback:read")).toBe(true);

    expect(scopeAllows(["write"], "write")).toBe(true);
    expect(scopeAllowsRead(["write"], "feedback")).toBe(false);
    expect(scopeAllows(["feedback:read"], "write")).toBe(false);
  });
});

describe("idempotency keys", () => {
  test("accepts a documented key and rejects short or padded ones", () => {
    expect(isIdempotencyKeyShaped("comment-0001")).toBe(true);
    expect(isIdempotencyKeyShaped("a".repeat(255))).toBe(true);
    expect(isIdempotencyKeyShaped("short")).toBe(false);
    expect(isIdempotencyKeyShaped("has space 123")).toBe(false);
    expect(isIdempotencyKeyShaped("a".repeat(256))).toBe(false);
    expect(isIdempotencyKeyShaped(42)).toBe(false);
  });

  test("fingerprints method, path and body but not the key", () => {
    const base = { method: "POST", path: "/api/v1/requests", bodyText: '{"a":1}' };

    expect(idempotencyRequestHash(base)).toBe(idempotencyRequestHash({ ...base }));
    expect(idempotencyRequestHash(base)).toMatch(/^[a-f0-9]{64}$/);
    expect(idempotencyRequestHash({ ...base, method: "post" })).toBe(
      idempotencyRequestHash(base),
    );
    expect(idempotencyRequestHash({ ...base, path: "/api/v1/comments" })).not.toBe(
      idempotencyRequestHash(base),
    );
    expect(idempotencyRequestHash({ ...base, bodyText: '{"a":2}' })).not.toBe(
      idempotencyRequestHash(base),
    );
  });
});

describe("OpenAPI document", () => {
  const doc = openApiDocument;

  test("is OpenAPI 3.1 with one bearer scheme", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.version).toBe("1.0.0");
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
  });

  test("served paths are generated from the route manifest", () => {
    const verbs = new Set(["get", "post", "patch", "put", "delete"]);
    const served = Object.entries(doc.paths).flatMap(([path, item]) =>
      Object.keys(item as Record<string, unknown>)
        .filter((verb) => verbs.has(verb))
        .map((verb) => `${verb.toUpperCase()} ${path}`),
    );
    const declared = API_ROUTE_DEFINITIONS.map(
      (route) => `${route.method} ${route.path}`,
    );

    expect(new Set(served).size).toBe(served.length);
    expect(new Set(declared).size).toBe(declared.length);
    expect(new Set(served)).toEqual(new Set(declared));

    for (const route of API_ROUTE_DEFINITIONS) {
      const item = (doc.paths as Record<string, Record<string, { operationId?: string }>>)[
        route.path
      ];
      expect(item?.[route.method.toLowerCase()]?.operationId).toBe(route.operationId);
    }
  });

  test("documents every resource and operation id is unique", () => {
    const expected = [
      "/boards",
      "/boards/{board_id}",
      "/tags",
      "/tags/{tag_id}",
      "/requests",
      "/requests/{request_id}",
      "/requests/{request_id}/comments",
      "/requests/{request_id}/votes",
      "/changelogs",
      "/changelogs/{release_id}",
      "/members",
      "/companies",
      "/companies/{company_id}",
      "/companies/{company_id}/customers",
      "/conversations",
      "/conversations/{conversation_id}",
      "/conversations/{conversation_id}/messages",
      "/conversations/{conversation_id}/notes",
      "/events",
    ];

    for (const path of expected) {
      expect(Object.keys(doc.paths)).toContain(path);
    }

    const operationIds: string[] = [];
    for (const [path, item] of Object.entries(doc.paths)) {
      const operations = item as Record<string, unknown>;
      const verbs = Object.keys(operations).filter((key) =>
        ["get", "post", "patch", "put", "delete"].includes(key),
      );
      expect(verbs.length).toBeGreaterThan(0);

      for (const verb of verbs) {
        const operation = operations[verb] as {
          operationId?: string;
          responses?: Record<string, unknown>;
        };
        expect(operation.operationId).toBeTruthy();
        expect(operation.responses?.["200"] ?? operation.responses?.["201"]).toBeTruthy();
        operationIds.push(`${path} ${operation.operationId}`);
      }
    }

    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  test("every $ref resolves to a declared schema", () => {
    const schemaNames = new Set(Object.keys(doc.components.schemas));
    const refs: string[] = [];

    const walk = (node: unknown) => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node !== "object" || node === null) return;
      for (const [key, value] of Object.entries(node)) {
        if (key === "$ref" && typeof value === "string") {
          refs.push(value);
          continue;
        }
        walk(value);
      }
    };
    walk(doc);

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith("#/components/schemas/")).toBe(true);
      expect(schemaNames.has(ref.replace("#/components/schemas/", ""))).toBe(true);
    }
  });

  test("idempotent endpoints advertise the header", () => {
    const paths = doc.paths as unknown as Record<
      string,
      Record<string, { parameters?: { name?: string }[] }>
    >;

    for (const [path, verb] of [
      ["/requests", "post"],
      ["/requests/{request_id}/comments", "post"],
      ["/changelogs", "post"],
      ["/conversations/{conversation_id}/messages", "post"],
      ["/conversations/{conversation_id}/notes", "post"],
      ["/events", "post"],
    ] as const) {
      const names = (paths[path]?.[verb]?.parameters ?? []).map((item) => item.name);
      expect(names).toContain("Idempotency-Key");
    }
  });

  test("includes a worked example for each major write workflow", () => {
    const wanted = new Set([
      "createRequest",
      "createComment",
      "createChangelogDraft",
      "replyToConversation",
      "addConversationNote",
      "addCompanyCustomer",
      "trackCustomerEvent",
    ]);
    const paths = doc.paths as unknown as Record<
      string,
      Record<
        string,
        {
          operationId?: string;
          requestBody?: {
            content?: Record<
              string,
              { examples?: Record<string, { summary?: string; value?: unknown }> }
            >;
          };
        }
      >
    >;

    const withExamples = new Set<string>();
    for (const item of Object.values(paths)) {
      for (const [verb, operation] of Object.entries(item)) {
        if (!["post", "patch", "put"].includes(verb)) continue;
        const example =
          operation.requestBody?.content?.["application/json"]?.examples?.workflow;
        if (operation.operationId && example?.value) {
          withExamples.add(operation.operationId);
        }
      }
    }

    for (const operationId of wanted) {
      expect(withExamples.has(operationId)).toBe(true);
    }
  });
});
