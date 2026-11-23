import { describe, expect, test } from "bun:test";

import {
  diffOpenApi,
  hasBreakingChanges,
  listOpenApiOperations,
  parseOpenApiDocument,
} from "@/features/api-docs/openapi-lib";

const base = {
  openapi: "3.1.0",
  info: { title: "Payments", version: "1.0.0" },
  paths: {
    "/api/v1/payments": {
      get: {
        summary: "List payments",
        parameters: [
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
        ],
        responses: { "200": { description: "OK" } },
      },
      post: {
        summary: "Create payment",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["amount"], properties: { amount: { type: "integer" } } },
            },
          },
        },
        responses: { "201": { description: "Created" } },
      },
    },
  },
};

describe("OpenAPI import", () => {
  test("validates JSON and rejects YAML", () => {
    expect(parseOpenApiDocument(JSON.stringify(base)).info).toEqual(base.info);
    expect(() => parseOpenApiDocument("openapi: 3.1.0")).toThrow(/JSON/);
    expect(() => parseOpenApiDocument(JSON.stringify({ openapi: "2.0", paths: {} }))).toThrow();
  });

  test("lists operations and marks writes", () => {
    const operations = listOpenApiOperations(base);
    expect(operations.map((operation) => `${operation.method} ${operation.path}`)).toEqual([
      "GET /api/v1/payments",
      "POST /api/v1/payments",
    ]);
    expect(operations.find((operation) => operation.method === "POST")?.write).toBe(true);
  });

  test("detects removed paths and methods as breaking", () => {
    const changes = diffOpenApi(base, {
      ...base,
      paths: {
        "/api/v1/payments": {
          get: base.paths["/api/v1/payments"].get,
        },
      },
    });
    expect(hasBreakingChanges(changes)).toBe(true);
    expect(changes.some((change) => change.kind === "operation_removed")).toBe(true);
  });

  test("detects a newly required request property", () => {
    const next = structuredClone(base);
    next.paths["/api/v1/payments"].post.requestBody.content["application/json"].schema.required.push(
      "currency",
    );
    const changes = diffOpenApi(base, next);
    expect(changes.some((change) => change.kind === "required_property_added")).toBe(true);
  });

  test("an added endpoint is compatible", () => {
    const next = structuredClone(base);
    Object.assign(next.paths, {
      "/api/v1/refunds": { get: { responses: { "200": { description: "OK" } } } },
    });
    const changes = diffOpenApi(base, next);
    expect(hasBreakingChanges(changes)).toBe(false);
    expect(changes.some((change) => change.kind === "operation_added")).toBe(true);
  });
});
