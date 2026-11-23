import { describe, expect, test } from "bun:test";

import {
  assertSameProduct,
  assertSameWorkspace,
  CrossProductError,
  CrossWorkspaceError,
} from "@/lib/tenancy";

const PRODUCT_A = "00000000-0000-4000-8000-00000000000a";
const PRODUCT_B = "00000000-0000-4000-8000-00000000000b";
const WORKSPACE_A = "00000000-0000-4000-8000-000000000001";
const WORKSPACE_B = "00000000-0000-4000-8000-000000000002";

describe("assertSameProduct", () => {
  test("passes when both records belong to the same product", () => {
    expect(() => assertSameProduct(PRODUCT_A, { productId: PRODUCT_A })).not.toThrow();
  });

  test("throws CrossProductError when the products differ", () => {
    try {
      assertSameProduct(PRODUCT_A, { productId: PRODUCT_B }, "Roadmap item");
      throw new Error("expected assertSameProduct to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CrossProductError);
      const crossProduct = error as CrossProductError;
      expect(crossProduct.message).toContain("Roadmap item");
      expect(crossProduct.expected).toBe(PRODUCT_A);
      expect(crossProduct.actual).toBe(PRODUCT_B);
    }
  });

  test("the default label is still meaningful", () => {
    expect(() => assertSameProduct(PRODUCT_A, { productId: PRODUCT_B })).toThrow(
      /Record belongs to a different product/,
    );
  });

  test("an empty or foreign product id never matches by accident", () => {
    expect(() => assertSameProduct(PRODUCT_A, { productId: "" })).toThrow(CrossProductError);
    expect(() => assertSameProduct(PRODUCT_A, { productId: PRODUCT_B })).toThrow(
      CrossProductError,
    );
  });
});

describe("assertSameWorkspace", () => {
  test("passes when both records belong to the same workspace", () => {
    expect(() => assertSameWorkspace(WORKSPACE_A, { workspaceId: WORKSPACE_A })).not.toThrow();
  });

  test("throws CrossWorkspaceError when the workspaces differ", () => {
    try {
      assertSameWorkspace(WORKSPACE_A, { workspaceId: WORKSPACE_B }, "Cancellation reason");
      throw new Error("expected assertSameWorkspace to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CrossWorkspaceError);
      const crossWorkspace = error as CrossWorkspaceError;
      expect(crossWorkspace.message).toContain("Cancellation reason");
      expect(crossWorkspace.expected).toBe(WORKSPACE_A);
      expect(crossWorkspace.actual).toBe(WORKSPACE_B);
    }
  });
});