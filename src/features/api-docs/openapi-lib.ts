/**
 * Pure OpenAPI parsing, operation listing and breaking-change comparison.
 *
 * The importer accepts JSON only. YAML would need a second parser and a second
 * set of edge cases; a CI job can convert YAML before upload. Paths and
 * operations are treated as a contract, not a rendering concern: a removed
 * path, method, required parameter, request body or response is breaking.
 */

export const OPENAPI_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "trace",
] as const;

export type OpenApiOperation = {
  method: string;
  path: string;
  operationId: string | null;
  summary: string | null;
  write: boolean;
};

export type OpenApiChange = {
  severity: "breaking" | "compatible";
  kind: string;
  method: string | null;
  path: string | null;
  detail: string;
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

export function parseOpenApiDocument(input: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("OpenAPI documents must be JSON. Convert YAML before importing.");
  }
  if (!isObject(parsed)) throw new Error("The OpenAPI document must be a JSON object.");
  if (typeof parsed.openapi !== "string" || !parsed.openapi.startsWith("3.")) {
    throw new Error("Only OpenAPI 3.x documents are supported.");
  }
  if (!isObject(parsed.info) || typeof parsed.info.title !== "string") {
    throw new Error("The OpenAPI document needs info.title.");
  }
  if (!isObject(parsed.paths)) {
    throw new Error("The OpenAPI document needs a paths object.");
  }
  return parsed;
}

export function openApiTitle(document: JsonObject): string {
  const info = asObject(document.info);
  return typeof info.title === "string" ? info.title.slice(0, 120) : "API";
}

export function listOpenApiOperations(document: JsonObject): OpenApiOperation[] {
  const paths = asObject(document.paths);
  const operations: OpenApiOperation[] = [];

  for (const [path, rawPath] of Object.entries(paths)) {
    if (!isObject(rawPath)) continue;
    for (const method of OPENAPI_METHODS) {
      const operation = rawPath[method];
      if (!isObject(operation)) continue;
      operations.push({
        method: method.toUpperCase(),
        path,
        operationId:
          typeof operation.operationId === "string" ? operation.operationId : null,
        summary: typeof operation.summary === "string" ? operation.summary : null,
        write: method !== "get" && method !== "head" && method !== "options",
      });
    }
  }

  return operations.sort((left, right) =>
    `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`),
  );
}

function parameters(operation: JsonObject): Map<string, JsonObject> {
  const map = new Map<string, JsonObject>();
  const list = Array.isArray(operation.parameters) ? operation.parameters : [];
  for (const entry of list) {
    if (!isObject(entry)) continue;
    const name = typeof entry.name === "string" ? entry.name : "";
    const location = typeof entry.in === "string" ? entry.in : "";
    if (name) map.set(`${location}:${name}`, entry);
  }
  return map;
}

function schemaType(parameter: JsonObject): string | null {
  const schema = asObject(parameter.schema);
  return typeof schema.type === "string" ? schema.type : null;
}

function requestBodyRequired(operation: JsonObject): boolean {
  return asObject(operation.requestBody).required === true;
}

function requiredProperties(operation: JsonObject): Set<string> {
  const schema = asObject(asObject(operation.requestBody).content);
  const first = Object.values(schema)[0];
  const properties = asObject(asObject(first).schema);
  const required = Array.isArray(properties.required) ? properties.required : [];
  return new Set(required.filter((value): value is string => typeof value === "string"));
}

function responseCodes(operation: JsonObject): Set<string> {
  return new Set(Object.keys(asObject(operation.responses)));
}

export function diffOpenApi(previous: JsonObject, next: JsonObject): OpenApiChange[] {
  const changes: OpenApiChange[] = [];
  const previousPaths = asObject(previous.paths);
  const nextPaths = asObject(next.paths);

  for (const [path, rawPreviousPath] of Object.entries(previousPaths)) {
    const previousPath = asObject(rawPreviousPath);
    const nextPath = nextPaths[path];
    if (!isObject(nextPath)) {
      changes.push({
        severity: "breaking",
        kind: "path_removed",
        method: null,
        path,
        detail: `Path ${path} was removed.`,
      });
      continue;
    }

    for (const method of OPENAPI_METHODS) {
      const before = previousPath[method];
      if (!isObject(before)) continue;
      const after = nextPath[method];
      if (!isObject(after)) {
        changes.push({
          severity: "breaking",
          kind: "operation_removed",
          method: method.toUpperCase(),
          path,
          detail: `${method.toUpperCase()} ${path} was removed.`,
        });
        continue;
      }

      const beforeParameters = parameters(before);
      const afterParameters = parameters(after);
      for (const [key, parameter] of beforeParameters) {
        const name = `${parameter.in ?? "parameter"}:${parameter.name ?? key}`;
        const replacement = afterParameters.get(key);
        if (!replacement) {
          if (parameter.required === true) {
            changes.push({
              severity: "breaking",
              kind: "required_parameter_removed",
              method: method.toUpperCase(),
              path,
              detail: `${name} is no longer accepted.`,
            });
          } else {
            changes.push({
              severity: "compatible",
              kind: "optional_parameter_removed",
              method: method.toUpperCase(),
              path,
              detail: `${name} was removed.`,
            });
          }
          continue;
        }
        const beforeType = schemaType(parameter);
        const afterType = schemaType(replacement);
        if (beforeType && afterType && beforeType !== afterType) {
          changes.push({
            severity: "breaking",
            kind: "parameter_type_changed",
            method: method.toUpperCase(),
            path,
            detail: `${name} changed from ${beforeType} to ${afterType}.`,
          });
        }
      }
      for (const [key, parameter] of afterParameters) {
        if (!beforeParameters.has(key) && parameter.required === true) {
          changes.push({
            severity: "breaking",
            kind: "required_parameter_added",
            method: method.toUpperCase(),
            path,
            detail: `${parameter.in ?? "parameter"}:${parameter.name ?? key} is newly required.`,
          });
        }
      }

      if (!requestBodyRequired(before) && requestBodyRequired(after)) {
        changes.push({
          severity: "breaking",
          kind: "request_body_now_required",
          method: method.toUpperCase(),
          path,
          detail: "The request body became required.",
        });
      }

      const beforeRequired = requiredProperties(before);
      const afterRequired = requiredProperties(after);
      for (const property of afterRequired) {
        if (!beforeRequired.has(property)) {
          changes.push({
            severity: "breaking",
            kind: "required_property_added",
            method: method.toUpperCase(),
            path,
            detail: `Request property "${property}" is newly required.`,
          });
        }
      }

      const beforeResponses = responseCodes(before);
      const afterResponses = responseCodes(after);
      for (const code of beforeResponses) {
        if (!afterResponses.has(code)) {
          changes.push({
            severity: "breaking",
            kind: "response_removed",
            method: method.toUpperCase(),
            path,
            detail: `Response ${code} was removed.`,
          });
        }
      }
    }
  }

  for (const [path, rawNextPath] of Object.entries(nextPaths)) {
    const previousPath = asObject(previousPaths[path]);
    for (const method of OPENAPI_METHODS) {
      if (isObject(previousPath[method]) || !isObject(asObject(rawNextPath)[method])) {
        continue;
      }
      changes.push({
        severity: "compatible",
        kind: "operation_added",
        method: method.toUpperCase(),
        path,
        detail: `${method.toUpperCase()} ${path} was added.`,
      });
    }
  }

  return changes;
}

export function hasBreakingChanges(changes: readonly OpenApiChange[]): boolean {
  return changes.some((change) => change.severity === "breaking");
}
