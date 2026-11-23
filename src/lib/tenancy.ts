/**
 * Pure tenant-safety helpers.
 *
 * Kept free of framework, database and `server-only` imports so the rules can
 * be unit-tested with `bun test` and reused by server code. They mirror the
 * composite foreign keys in `src/db/schema`, so a violation is caught in
 * application logic *and* by the database.
 */

/** Raised when two records are joined across different products. */
export class CrossProductError extends Error {
  readonly expected: string;
  readonly actual: string;

  constructor(label: string, expected: string, actual: string) {
    super(`${label} belongs to a different product.`);
    this.name = "CrossProductError";
    this.expected = expected;
    this.actual = actual;
  }
}

/** Raised when two records are joined across different workspaces. */
export class CrossWorkspaceError extends Error {
  readonly expected: string;
  readonly actual: string;

  constructor(label: string, expected: string, actual: string) {
    super(`${label} belongs to a different workspace.`);
    this.name = "CrossWorkspaceError";
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Validate that two records belong to the same product before linking them.
 *
 * @param expectedProductId product id already resolved through an authorized
 *                          workspace context — never a client-supplied value.
 */
export function assertSameProduct(
  expectedProductId: string,
  actual: { productId: string },
  label = "Record",
): void {
  if (expectedProductId !== actual.productId) {
    throw new CrossProductError(label, expectedProductId, actual.productId);
  }
}

/**
 * Validate that two records belong to the same workspace. Used for
 * workspace-scoped references that the schema cannot constrain directly, such
 * as linking a release to a cancellation reason.
 */
export function assertSameWorkspace(
  expectedWorkspaceId: string,
  actual: { workspaceId: string },
  label = "Record",
): void {
  if (expectedWorkspaceId !== actual.workspaceId) {
    throw new CrossWorkspaceError(label, expectedWorkspaceId, actual.workspaceId);
  }
}