import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

/**
 * Local boundary rule: a `"use client"` module may never import the database
 * layer. The database module is server-only, and an accidental client import
 * turns into a bundling error or, worse, a build that silently ships server
 * code. This inspects the directive directly so it works for any path.
 */
const heraldPlugin = {
  rules: {
    "no-db-in-client": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Prevent client components from importing the server-only database layer.",
        },
        schema: [],
        messages: {
          forbidden:
            "Client components must not import {{source}}. Read data in a server component, query or route handler and pass a serializable value down.",
        },
      },
      create(context) {
        let isClientComponent = false;
        return {
          Program(node) {
            isClientComponent = node.body.some(
              (statement) =>
                statement.type === "ExpressionStatement" &&
                statement.directive === "use client",
            );
          },
          ImportDeclaration(node) {
            if (!isClientComponent) return;
            // Type-only imports are erased at build time, so they cannot pull
            // server code into the browser bundle. Runtime imports stay banned.
            if (node.importKind === "type") return;
            const source = node.source.value;
            if (typeof source !== "string") return;
            if (
              source === "@/db" ||
              source.startsWith("@/db/") ||
              source === "@/lib/authz"
            ) {
              context.report({ node, messageId: "forbidden", data: { source } });
            }
          },
        };
      },
    },
  },
};

const typedRules = {
  files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  plugins: { "@typescript-eslint": tsPlugin },
  rules: {
    "no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": [
      "error",
      { checksVoidReturn: { attributes: false } },
    ],
    "@typescript-eslint/no-explicit-any": "warn",
  },
};

const clientBoundary = {
  files: ["src/**/*.{ts,tsx}"],
  plugins: { herald: heraldPlugin },
  rules: { "herald/no-db-in-client": "error" },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  typedRules,
  clientBoundary,
  globalIgnores([
    "node_modules/**",
    ".next/**",
    ".next-e2e/**",
    "out/**",
    "build/**",
    "coverage/**",
    "test-results/**",
    "next-env.d.ts",
    "drizzle/**",
  ]),
]);

export default eslintConfig;
