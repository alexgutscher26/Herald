/**
 * Workspace permission matrix.
 *
 * This module is pure: no database, no request context, no framework imports.
 * It is the single source of truth for role → permission mapping and is
 * unit-tested in `tests/permissions.test.ts`.
 *
 * ## Roles
 * | Role   | Summary                                                        |
 * | ------ | -------------------------------------------------------------- |
 * | owner  | Full control: membership, sensitive workspace settings, deletion |
 * | admin  | Product configuration plus operational surfaces (subscribers, win-back, integrations, widget, settings) |
 * | editor | Day-to-day content: releases, feedback, roadmap                 |
 * | viewer | Free, read/comment-only stakeholder: no paid seat, no content writes |
 *
 * ## Permission matrix
 * | Permission            | owner | admin | editor | viewer |
 * | --------------------- | :---: | :---: | :----: | :----: |
 * | workspace:read        |  ✅   |  ✅   |  ✅    |  ✅    |
 * | workspace:update      |  ✅   |  ❌   |  ❌    |  ❌    |
 * | workspace:delete      |  ✅   |  ❌   |  ❌    |  ❌    |
 * | member:read           |  ✅   |  ✅   |  ❌    |  ❌    |
 * | member:manage         |  ✅   |  ❌   |  ❌    |  ❌    |
 * | product:read          |  ✅   |  ✅   |  ✅    |  ✅    |
 * | product:create        |  ✅   |  ✅   |  ❌    |  ❌    |
 * | product:update        |  ✅   |  ✅   |  ❌    |  ❌    |
 * | product:delete        |  ✅   |  ✅   |  ❌    |  ❌    |
 * | release:read          |  ✅   |  ✅   |  ✅    |  ✅    |
 * | release:write         |  ✅   |  ✅   |  ✅    |  ❌    |
 * | feedback:read         |  ✅   |  ✅   |  ✅    |  ✅    |
 * | feedback:comment      |  ✅   |  ✅   |  ✅    |  ✅    |
 * | feedback:write        |  ✅   |  ✅   |  ✅    |  ❌    |
 * | moderation:read       |  ✅   |  ✅   |  ✅    |  ❌    |
 * | moderation:manage     |  ✅   |  ✅   |  ✅    |  ❌    |
 * | roadmap:read          |  ✅   |  ✅   |  ✅    |  ✅    |
 * | roadmap:write         |  ✅   |  ✅   |  ✅    |  ❌    |
 * | subscriber:read       |  ✅   |  ✅   |  ✅    |  ❌    |
 * | subscriber:write      |  ✅   |  ✅   |  ❌    |  ❌    |
 * | winback:read          |  ✅   |  ✅   |  ✅    |  ❌    |
 * | winback:manage        |  ✅   |  ✅   |  ❌    |  ❌    |
 * | winback:approve       |  ✅   |  ✅   |  ❌    |  ❌    |
 * | conversation:read     |  ✅   |  ✅   |  ❌    |  ❌    |
 * | conversation:write    |  ✅   |  ✅   |  ❌    |  ❌    |
 * | juno:read             |  ✅   |  ✅   |  ❌    |  ❌    |
 * | juno:manage           |  ✅   |  ✅   |  ❌    |  ❌    |
 * | widget:manage         |  ✅   |  ✅   |  ❌    |  ❌    |
 * | analytics:read        |  ✅   |  ✅   |  ✅    |  ❌    |
 * | integration:manage    |  ✅   |  ✅   |  ❌    |  ❌    |
 * | settings:manage       |  ✅   |  ✅   |  ❌    |  ❌    |
 *
 * Rules of the road:
 * - `viewer` is a free stakeholder seat: read/comment only, and excluded from
 *   the paid member count in `src/features/entitlements/entitlements.ts`.
 * - `feedback:comment` is deliberately narrower than `feedback:write`: it
 *   allows a comment on an existing request, never a new post, status change,
 *   merge or internal note (those check `feedback:write`).
 * - Deny by default: a permission missing from a role's list is denied.
 * - Hiding a button is never authorization. Every server action, route handler
 *   and privileged data-access function must call `requirePermission`.
 * - Client-supplied workspace/product identifiers are never trusted; they are
 *   resolved through `requireWorkspaceMembership` / `requireProduct` first.
 */

export const WORKSPACE_ROLES = ["owner", "admin", "editor", "viewer"] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PERMISSIONS = [
  "workspace:read",
  "workspace:update",
  "workspace:delete",
  "member:read",
  "member:manage",
  "product:read",
  "product:create",
  "product:update",
  "product:delete",
  "release:read",
  "release:write",
  "feedback:read",
  "feedback:comment",
  "feedback:write",
  "moderation:read",
  "moderation:manage",
  "roadmap:read",
  "roadmap:write",
  "subscriber:read",
  "subscriber:write",
  "winback:read",
  "winback:manage",
  "winback:approve",
  "conversation:read",
  "conversation:write",
  "juno:read",
  "juno:manage",
  "widget:manage",
  "analytics:read",
  "integration:manage",
  "settings:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const OWNER_ONLY: readonly Permission[] = [
  "workspace:update",
  "workspace:delete",
  "member:manage",
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  "workspace:read",
  "member:read",
  "product:read",
  "product:create",
  "product:update",
  "product:delete",
  "release:read",
  "release:write",
  "feedback:read",
  "feedback:comment",
  "feedback:write",
  "moderation:read",
  "moderation:manage",
  "roadmap:read",
  "roadmap:write",
  "subscriber:read",
  "subscriber:write",
  "winback:read",
  "winback:manage",
  "winback:approve",
  "conversation:read",
  "conversation:write",
  "juno:read",
  "juno:manage",
  "widget:manage",
  "analytics:read",
  "integration:manage",
  "settings:manage",
];

const EDITOR_PERMISSIONS: readonly Permission[] = [
  "workspace:read",
  "product:read",
  "release:read",
  "release:write",
  "feedback:read",
  "feedback:comment",
  "feedback:write",
  "moderation:read",
  "moderation:manage",
  "roadmap:read",
  "roadmap:write",
  "subscriber:read",
  "winback:read",
  "analytics:read",
];

/**
 * A free stakeholder seat: read the customer-facing surfaces and leave
 * comments, but never create or change content. Viewers do not consume a
 * paid team seat (see `countWorkspaceUsage`).
 */
const VIEWER_PERMISSIONS: readonly Permission[] = [
  "workspace:read",
  "product:read",
  "release:read",
  "feedback:read",
  "feedback:comment",
  "roadmap:read",
];

const OWNER_PERMISSIONS: readonly Permission[] = [
  ...new Set<Permission>([...ADMIN_PERMISSIONS, ...EDITOR_PERMISSIONS, ...OWNER_ONLY]),
];

const ROLE_PERMISSIONS: Record<WorkspaceRole, readonly Permission[]> = {
  owner: OWNER_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  editor: EDITOR_PERMISSIONS,
  viewer: VIEWER_PERMISSIONS,
};

/** Ordered from most to least privileged. */
const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 3,
  admin: 2,
  editor: 1,
  viewer: 0,
};

/** Narrow an arbitrary string to a known role. */
export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

/** Deny-by-default permission check. Unknown roles/permissions always fail. */
export function hasPermission(role: WorkspaceRole, permission: Permission): boolean {
  const allowed = ROLE_PERMISSIONS[role];
  if (!allowed) return false;
  return allowed.includes(permission);
}

/** True when `role` is at least as privileged as `minimum`. */
export function isAtLeast(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export class PermissionDeniedError extends Error {
  readonly role: WorkspaceRole;
  readonly permission: Permission;

  constructor(role: WorkspaceRole, permission: Permission) {
    super(`Role "${role}" is not permitted to perform "${permission}".`);
    this.name = "PermissionDeniedError";
    this.role = role;
    this.permission = permission;
  }
}

/** Throws `PermissionDeniedError` when the role lacks the permission. */
export function requirePermission(
  role: WorkspaceRole,
  permission: Permission,
): asserts role is WorkspaceRole {
  if (!hasPermission(role, permission)) {
    throw new PermissionDeniedError(role, permission);
  }
}

/** Every permission granted to a role — useful for UI affordances only. */
export function permissionsFor(role: WorkspaceRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/**
 * Permissions an owner may hand to a custom admin role.
 *
 * Owner-only controls stay out: a custom role can widen operational access,
 * never transfer ownership, delete the workspace or manage membership. Base
 * role permissions are also included, because a custom role is additive to the
 * member's role rather than a replacement.
 */
export const CUSTOM_ROLE_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter(
  (permission) => !OWNER_ONLY.includes(permission),
);

export function isCustomRolePermission(value: unknown): value is Permission {
  return typeof value === "string" && CUSTOM_ROLE_PERMISSIONS.includes(value as Permission);
}

/**
 * Normalise a submitted custom permission list. Unknown, duplicate or
 * owner-only entries are dropped rather than trusted; callers store only the
 * returned array.
 */
export function validateCustomPermissions(input: unknown): Permission[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter(isCustomRolePermission))];
}

/**
 * Effective permissions = base role ∪ custom role. A stale custom role can
 * never remove a base permission, so downgrading a base role still applies
 * immediately; removing the custom role drops the extra grants.
 */
export function resolveEffectivePermissions(
  role: WorkspaceRole,
  customPermissions: readonly string[] | null | undefined,
): Permission[] {
  const effective = new Set<Permission>(permissionsFor(role));
  for (const permission of validateCustomPermissions(customPermissions)) {
    effective.add(permission);
  }
  return [...effective];
}

export function hasEffectivePermission(
  permissions: readonly Permission[],
  permission: Permission,
): boolean {
  return permissions.includes(permission);
}

/** Throws when the resolved permission set lacks `permission`. */
export function requireEffectivePermission(
  role: WorkspaceRole,
  permissions: readonly Permission[],
  permission: Permission,
): void {
  if (!hasEffectivePermission(permissions, permission)) {
    throw new PermissionDeniedError(role, permission);
  }
}
