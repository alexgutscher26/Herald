import { describe, expect, test } from "bun:test";

import { ssoAccessDecision, isScimAssignableRole } from "@/features/enterprise/policy";
import {
  CUSTOM_ROLE_PERMISSIONS,
  resolveEffectivePermissions,
  validateCustomPermissions,
} from "@/lib/permissions";

describe("enterprise identity policy", () => {
  test("enforced SSO requires a linked provider account", () => {
    expect(
      ssoAccessDecision({ enforced: false, providerId: null, hasLinkedAccount: false }),
    ).toBe("allow");
    expect(
      ssoAccessDecision({
        enforced: true,
        providerId: "workspace-a",
        hasLinkedAccount: false,
      }),
    ).toBe("sso_required");
    expect(
      ssoAccessDecision({
        enforced: true,
        providerId: "workspace-a",
        hasLinkedAccount: true,
      }),
    ).toBe("allow");
  });

  test("turning enforcement off restores the password path immediately", () => {
    expect(
      ssoAccessDecision({
        enforced: false,
        providerId: "workspace-a",
        hasLinkedAccount: false,
      }),
    ).toBe("allow");
  });

  test("an enforced workspace without a provider cannot lock members out", () => {
    expect(
      ssoAccessDecision({ enforced: true, providerId: null, hasLinkedAccount: false }),
    ).toBe("allow");
  });

  test("SCIM cannot provision an owner", () => {
    expect(isScimAssignableRole("admin")).toBe(true);
    expect(isScimAssignableRole("editor")).toBe(true);
    expect(isScimAssignableRole("viewer")).toBe(true);
    expect(isScimAssignableRole("owner")).toBe(false);
  });
});

describe("custom admin roles", () => {
  test("custom roles add permissions without removing the base role", () => {
    const effective = resolveEffectivePermissions("editor", ["subscriber:write"]);
    expect(effective).toContain("release:write");
    expect(effective).toContain("subscriber:write");
  });

  test("owner-only permissions cannot be granted", () => {
    expect(validateCustomPermissions(["member:manage", "workspace:delete"])).toEqual([]);
    expect(CUSTOM_ROLE_PERMISSIONS).not.toContain("member:manage" as never);
  });

  test("unknown and duplicate permissions are dropped", () => {
    expect(
      validateCustomPermissions(["settings:manage", "settings:manage", "root:everything"]),
    ).toEqual(["settings:manage"]);
  });

  test("removing a custom role leaves the base role intact", () => {
    expect(resolveEffectivePermissions("admin", null)).toContain("settings:manage");
    expect(resolveEffectivePermissions("viewer", null)).not.toContain("settings:manage");
  });
});
