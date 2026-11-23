import { describe, expect, test } from "bun:test";

import { isUuid } from "@/features/api-v1/cursor";
import { openApiDocument } from "@/features/api-v1/openapi";
import { API_ROUTE_DEFINITIONS } from "@/features/api-v1/routes";
import {
  MCP_DEFAULT_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS,
  MCP_TOOLS,
  McpToolArgumentError,
  findMcpTool,
  mcpToolList,
} from "@/features/mcp/catalog";

/**
 * The MCP catalog is the tool contract. These tests prove it stays complete,
 * self-consistent and that argument handling never leaks the idempotency key
 * into a JSON body.
 */

const UUID = "5f0c8f9a-6a2e-4f0e-9d4a-1c2b3a4d5e6f";

function sampleValue(schema: Record<string, unknown>): unknown {
  if (schema.type === "array") return [];
  if (schema.format === "uuid") return UUID;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (schema.type === "object") return {};
  if (schema.type === "integer") return 1;
  if (schema.type === "boolean") return false;
  return "sample";
}

function sampleArgs(tool: (typeof MCP_TOOLS)[number]): Record<string, unknown> {
  const properties = (tool.inputSchema.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const required = (tool.inputSchema.required ?? []) as string[];
  return Object.fromEntries(
    required.map((key) => [key, sampleValue(properties[key] ?? {})]),
  );
}

describe("MCP tool catalog", () => {
  test("has unique, documented tools with closed object schemas", () => {
    const names = MCP_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(20);

    for (const tool of MCP_TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]+$/);
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);

      const properties = tool.inputSchema.properties as Record<string, unknown>;
      const required = (tool.inputSchema.required ?? []) as string[];
      for (const key of required) {
        expect(properties[key]).toBeDefined();
      }
    }
  });

  test("every tool builds a valid v1 path", () => {
    for (const tool of MCP_TOOLS) {
      const call = tool.build(sampleArgs(tool));
      expect(call.path.startsWith("/")).toBe(true);
      expect(call.path).not.toContain("undefined");
      expect(["GET", "POST", "PATCH", "DELETE"]).toContain(call.method);
      if (tool.readOnly) expect(call.method).toBe("GET");
    }
  });

  test("write tools never put the idempotency key in the body", () => {
    const tool = findMcpTool("create_comment");
    expect(tool).not.toBeNull();
    if (!tool) return;

    const call = tool.build({
      request_id: UUID,
      body: "A reply",
      idempotency_key: "comment-key-1",
    });

    expect(call.headers).toEqual({ "Idempotency-Key": "comment-key-1" });
    expect(call.body).toEqual({ body: "A reply" });
  });

  test("request creation maps optional customer and omits undefined fields", () => {
    const tool = findMcpTool("create_request");
    expect(tool).not.toBeNull();
    if (!tool) return;

    const call = tool.build({
      board_id: UUID,
      title: "A request",
      body: "Details",
      customer: { external_id: "acme-1" },
    });

    expect(call.method).toBe("POST");
    expect(call.path).toBe("/requests");
    expect(call.body).toEqual({
      board_id: UUID,
      title: "A request",
      body: "Details",
      customer: { external_id: "acme-1" },
    });
    expect(call.headers).toBeUndefined();
  });

  test("withdrawing a vote uses DELETE with query identity", () => {
    const tool = findMcpTool("vote_request");
    expect(tool).not.toBeNull();
    if (!tool) return;

    const call = tool.build({
      request_id: UUID,
      customer: { external_id: "voter 1" },
      voted: false,
    });

    expect(call.method).toBe("DELETE");
    expect(call.path).toBe(
      `/requests/${UUID}/votes?external_id=voter+1`,
    );
    expect(call.body).toBeUndefined();
  });

  test("paths encode ids and reject missing required arguments", () => {
    const tool = findMcpTool("get_request");
    expect(tool).not.toBeNull();
    if (!tool) return;

    expect(tool.build({ request_id: "a/b" }).path).toBe("/requests/a%2Fb");
    expect(() => tool.build({})).toThrow(McpToolArgumentError);
  });

  test("list representation never exposes the builder", () => {
    const listed = mcpToolList();
    expect(listed).toHaveLength(MCP_TOOLS.length);
    for (const entry of listed) {
      expect("build" in entry).toBe(false);
      const source = MCP_TOOLS.find((tool) => tool.name === entry.name);
      expect(entry.annotations.readOnlyHint).toBe(source?.readOnly ?? false);
    }
  });

  test("protocol versions include the session default and newest revision", () => {
    expect(MCP_PROTOCOL_VERSIONS).toContain(MCP_DEFAULT_PROTOCOL_VERSION);
    expect(MCP_PROTOCOL_VERSIONS).toContain("2025-06-18");
    expect(MCP_PROTOCOL_VERSIONS).toContain("2026-07-28");
  });

  test("unknown tools are rejected by name", () => {
    expect(findMcpTool("publish_changelog")).toBeNull();
    expect(findMcpTool("")).toBeNull();
  });

  test("every tool maps to a declared REST route and OpenAPI operation", () => {
    const templateSegments = (value: string) =>
      value.split("?")[0]!.split("/").filter((segment) => segment.length > 0);

    for (const tool of MCP_TOOLS) {
      const call = tool.build(sampleArgs(tool));
      const actual = templateSegments(call.path);

      const definition = API_ROUTE_DEFINITIONS.find((route) => {
        if (route.method !== call.method) return false;
        const template = templateSegments(route.path);
        if (template.length !== actual.length) return false;
        return template.every((segment, index) =>
          segment.startsWith("{") ? isUuid(actual[index]) : segment === actual[index],
        );
      });

      expect(definition, `${tool.name} -> ${call.method} ${call.path}`).toBeDefined();
      if (!definition) continue;

      const operation = (
        openApiDocument.paths as unknown as Record<
          string,
          Record<string, { operationId?: string }>
        >
      )[definition.path]?.[definition.method.toLowerCase()];
      expect(operation?.operationId).toBe(definition.operationId);
    }
  });
});
