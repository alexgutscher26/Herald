import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";
import ts from "typescript";

const SRC = path.join(import.meta.dir, "..", "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function describeModule(file: string): {
  isClient: boolean;
  imports: { specifier: string; typeOnly: boolean }[];
} {
  const source = readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const isClient = parsed.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === "use client",
  );

  const imports: { specifier: string; typeOnly: boolean }[] = [];
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    imports.push({
      specifier: statement.moduleSpecifier.text,
      typeOnly: statement.importClause?.isTypeOnly ?? false,
    });
  }

  return { isClient, imports };
}

function isForbiddenClientImport(specifier: string): boolean {
  return (
    specifier === "@/db" ||
    specifier.startsWith("@/db/") ||
    specifier === "@/lib/authz" ||
    specifier === "server-only"
  );
}

describe("module boundaries", () => {
  test("client components have no runtime server-only imports", () => {
    const violations = sourceFiles(SRC).flatMap((file) => {
      const { isClient, imports } = describeModule(file);
      if (!isClient) return [];
      return imports
        .filter((entry) => !entry.typeOnly && isForbiddenClientImport(entry.specifier))
        .map((entry) => `${path.relative(SRC, file)}: ${entry.specifier}`);
    });

    expect(violations).toEqual([]);
  });

});
