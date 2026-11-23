import { describe, expect, test } from "bun:test";

import {
  hasPermission,
  isAtLeast,
  isWorkspaceRole,
  PERMISSIONS,
  permissionsFor,
  PermissionDeniedError,
  requirePermission,
  WORKSPACE_ROLES,
  type Permission,
  type WorkspaceRole,
} from "@/lib/permissions";

const ROLES: WorkspaceRole[] = ["owner", "admin", "editor", "viewer"];
const STAFF_ROLES: WorkspaceRole[] = ["owner", "admin", "editor"];

describe("permission matrix", () => {
  test("every declared permission is granted to at least one role", () => {
    for (const permission of PERMISSIONS) {
      const grantedTo = ROLES.filter((role) => hasPermission(role, permission));
      expect(grantedTo.length).toBeGreaterThan(0);
    }
  });

  test("privilege is strictly nested: owner ⊇ admin ⊇ editor ⊇ viewer", () => {
    const viewer = new Set(permissionsFor("viewer"));
    const editor = new Set(permissionsFor("editor"));
    const admin = new Set(permissionsFor("admin"));
    const owner = new Set(permissionsFor("owner"));

    for (const permission of viewer) expect(editor.has(permission)).toBe(true);
    for (const permission of editor) expect(admin.has(permission)).toBe(true);
    for (const permission of admin) expect(owner.has(permission)).toBe(true);
  });

  test("viewers can read and comment but cannot author or change content", () => {
    for (const permission of [
      "workspace:read",
      "product:read",
      "release:read",
      "feedback:read",
      "feedback:comment",
      "roadmap:read",
    ] as const) {
      expect(hasPermission("viewer", permission)).toBe(true);
    }

    for (const permission of [
      "feedback:write",
      "release:write",
      "roadmap:write",
      "moderation:manage",
      "analytics:read",
      "member:read",
      "settings:manage",
    ] as const) {
      expect(hasPermission("viewer", permission)).toBe(false);
    }
  });

  test("every content role may comment, and viewers own no write permission", () => {
    for (const role of STAFF_ROLES) {
      expect(hasPermission(role, "feedback:comment")).toBe(true);
    }
    expect(permissionsFor("viewer").every((permission) => !permission.endsWith(":write"))).toBe(
      true,
    );
  });

  test("membership management is owner-only", () => {
    expect(hasPermission("owner", "member:manage")).toBe(true);
    expect(hasPermission("admin", "member:manage")).toBe(false);
    expect(hasPermission("editor", "member:manage")).toBe(false);
  });

  test("sensitive workspace settings and deletion are owner-only", () => {
    for (const permission of ["workspace:update", "workspace:delete"] as const) {
      expect(hasPermission("owner", permission)).toBe(true);
      expect(hasPermission("admin", permission)).toBe(false);
      expect(hasPermission("editor", permission)).toBe(false);
    }
  });

  test("admins manage products but editors do not", () => {
    for (const permission of ["product:create", "product:update", "product:delete"] as const) {
      expect(hasPermission("admin", permission)).toBe(true);
      expect(hasPermission("editor", permission)).toBe(false);
    }
  });

  test("editors can manage release, feedback, moderation and roadmap content", () => {
    for (const permission of [
      "release:write",
      "feedback:write",
      "moderation:read",
      "moderation:manage",
      "roadmap:write",
    ] as const) {
      expect(hasPermission("editor", permission)).toBe(true);
      expect(hasPermission("admin", permission)).toBe(true);
      expect(hasPermission("owner", permission)).toBe(true);
    }
  });

  test("the conversation inbox and Juno are operator surfaces, not editor ones", () => {
    for (const permission of [
      "conversation:read",
      "conversation:write",
      "juno:read",
      "juno:manage",
    ] as const) {
      expect(hasPermission("owner", permission)).toBe(true);
      expect(hasPermission("admin", permission)).toBe(true);
      expect(hasPermission("editor", permission)).toBe(false);
    }
  });

  test("operational surfaces are restricted to owner and admin", () => {
    for (const permission of [
      "subscriber:write",
      "winback:manage",
      "winback:approve",
      "conversation:read",
      "conversation:write",
      "juno:read",
      "juno:manage",
      "widget:manage",
      "integration:manage",
      "settings:manage",
    ] as const) {
      expect(hasPermission("owner", permission)).toBe(true);
      expect(hasPermission("admin", permission)).toBe(true);
      expect(hasPermission("editor", permission)).toBe(false);
    }
  });

  test("read access to the product areas is available to every role", () => {
    for (const permission of [
      "workspace:read",
      "product:read",
      "release:read",
      "feedback:read",
      "moderation:read",
      "roadmap:read",
      "subscriber:read",
      "winback:read",
      "analytics:read",
    ] as const) {
      for (const role of STAFF_ROLES) expect(hasPermission(role, permission)).toBe(true);
    }
  });

  test("deny by default: unknown permissions are never granted", () => {
    const unknown = "billing:delete" as Permission;
    for (const role of ROLES) {
      expect(hasPermission(role, unknown)).toBe(false);
    }
    expect(PERMISSIONS.includes(unknown)).toBe(false);
  });

  test("an unknown role holds no permissions", () => {
    const bogus = "superuser" as unknown as WorkspaceRole;
    expect(hasPermission(bogus, "workspace:read")).toBe(false);
    expect(permissionsFor(bogus)).toEqual([]);
    expect(isWorkspaceRole(bogus)).toBe(false);
    expect(isWorkspaceRole("owner")).toBe(true);
    expect(isWorkspaceRole(42)).toBe(false);
  });
});

describe("requirePermission", () => {
  test("passes silently when allowed", () => {
    expect(() => requirePermission("admin", "product:create")).not.toThrow();
  });

  test("throws PermissionDeniedError carrying role and permission", () => {
    try {
      requirePermission("editor", "product:create");
      throw new Error("expected requirePermission to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDeniedError);
      const denied = error as PermissionDeniedError;
      expect(denied.role).toBe("editor");
      expect(denied.permission).toBe("product:create");
      expect(denied.message).toContain("editor");
      expect(denied.message).toContain("product:create");
    }
  });
});

describe("isAtLeast", () => {
  test("orders owner > admin > editor > viewer", () => {
    expect(isAtLeast("owner", "admin")).toBe(true);
    expect(isAtLeast("admin", "admin")).toBe(true);
    expect(isAtLeast("editor", "admin")).toBe(false);
    expect(isAtLeast("editor", "editor")).toBe(true);
    expect(isAtLeast("viewer", "editor")).toBe(false);
    expect(isAtLeast("viewer", "viewer")).toBe(true);
    expect(isAtLeast("admin", "owner")).toBe(false);
  });

  test("role ranking matches granted permissions", () => {
    for (const lower of ROLES) {
      for (const higher of ROLES) {
        if (isAtLeast(higher, lower)) {
          for (const permission of permissionsFor(lower)) {
            expect(hasPermission(higher, permission)).toBe(true);
          }
        }
      }
    }
  });
});

test("WORKSPACE_ROLES only contains recognised roles", () => {
  expect([...WORKSPACE_ROLES].sort()).toEqual(["admin", "editor", "owner", "viewer"]);
});