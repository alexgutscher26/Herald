import { Check, Minus, ShieldCheck } from "lucide-react";
import { Fragment } from "react";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import type { WorkspaceMemberView } from "@/features/workspace-settings/invitations";
import type { CustomRoleView } from "@/features/enterprise/identity";
import {
  PERMISSIONS,
  permissionsFor,
  resolveEffectivePermissions,
  WORKSPACE_ROLES,
  type Permission,
  type WorkspaceRole,
} from "@/lib/permissions";

/**
 * "Who can do what" for one workspace.
 *
 * Every cell is computed from `src/lib/permissions.ts` — the same module the
 * server checks — so this page cannot drift from enforcement the way a
 * hand-written table would. Only the human labels below are authored.
 */

const RESOURCE_LABELS: Record<string, string> = {
  workspace: "Workspace",
  member: "Members",
  product: "Products",
  release: "Releases",
  feedback: "Feedback",
  moderation: "Moderation",
  roadmap: "Roadmap",
  subscriber: "Subscribers",
  winback: "Win-back",
  conversation: "Conversations",
  juno: "Mira",
  widget: "Widget",
  analytics: "Analytics",
  integration: "Integrations",
  settings: "Settings",
};

const ACTION_LABELS: Record<string, string> = {
  read: "View",
  write: "Create and edit",
  comment: "Comment",
  create: "Create",
  update: "Update",
  delete: "Delete",
  manage: "Manage",
  approve: "Approve",
};

const ROLE_LABELS: Record<WorkspaceRole, { name: string; summary: string }> = {
  owner: { name: "Owner", summary: "Billing, membership, deletion. At least one always remains." },
  admin: { name: "Admin", summary: "Product and operational settings. Paid seat." },
  editor: { name: "Editor", summary: "Releases, feedback, moderation, roadmap. Paid seat." },
  viewer: { name: "Viewer", summary: "Read and comment only. Free — no paid seat." },
};

type Row = { resource: string; permission: Permission; action: string };

function rowFor(permission: Permission): Row {
  const [resource = permission, action = "manage"] = permission.split(":");
  return { resource, permission, action };
}

const ROWS: Row[] = PERMISSIONS.map(rowFor);
const RESOURCES = [...new Set(ROWS.map((row) => row.resource))];

function Cell({ granted }: { granted: boolean }) {
  return (
    <td className="px-2 py-2 text-center">
      {granted ? (
        <>
          <Check className="mx-auto size-4 text-success" aria-hidden="true" />
          <span className="sr-only">Allowed</span>
        </>
      ) : (
        <>
          <Minus className="mx-auto size-4 text-muted-foreground/60" aria-hidden="true" />
          <span className="sr-only">Not allowed</span>
        </>
      )}
    </td>
  );
}

export function PermissionsView(props: {
  workspaceSlug: string;
  workspaceName: string;
  currentRole: WorkspaceRole;
  members: WorkspaceMemberView[];
  customRoles: CustomRoleView[];
  assignments: Record<string, string>;
}) {
  const { workspaceSlug, workspaceName, currentRole, members, customRoles, assignments } = props;
  const roleById = new Map(customRoles.map((role) => [role.id, role]));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Who can do what"
        description={`Roles in ${workspaceName}, generated from the permission matrix the server enforces.`}
        actions={
          <Link
            className="text-sm text-primary hover:underline"
            href={`/app/${encodeURIComponent(workspaceSlug)}/settings`}
          >
            Back to settings
          </Link>
        }
      />

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-2 rounded-lg border border-border/80 bg-muted/20 p-3.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                Roles are <strong className="text-foreground">workspace-wide</strong> and apply to
                every product in it. There are no per-product overrides — see
                <code className="mx-1 rounded bg-muted px-1 py-0.5">docs/adr/0003-workspace-wide-roles.md</code>
                for the decision.
              </p>
              <p>
                A custom role is additive: a member keeps their base role and gains the extra
                permissions. Owner-only controls can never be granted to a custom role.
              </p>
              <p>Hiding a button is never authorization; every server action checks the same matrix.</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">
                Permissions granted to each workspace role, grouped by resource
              </caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">Capability</th>
                  {WORKSPACE_ROLES.map((role) => (
                    <th key={role} scope="col" className="px-2 py-2 text-center font-medium">
                      <span className="block text-sm text-foreground">{ROLE_LABELS[role].name}</span>
                      <span className="block font-normal">
                        {permissionsFor(role).length} permissions
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RESOURCES.map((resource) => (
                  <Fragment key={resource}>
                    <tr className="bg-muted/30">
                      <th
                        scope="colgroup"
                        colSpan={WORKSPACE_ROLES.length + 1}
                        className="px-1 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        {RESOURCE_LABELS[resource] ?? resource}
                      </th>
                    </tr>
                    {ROWS.filter((row) => row.resource === resource).map((row) => (
                      <tr key={row.permission} className="border-b last:border-0">
                        <th scope="row" className="py-2 pr-3 text-left font-normal">
                          <span className="block">{ACTION_LABELS[row.action] ?? row.action}</span>
                          <code className="text-[11px] text-muted-foreground">{row.permission}</code>
                        </th>
                        {WORKSPACE_ROLES.map((role) => (
                          <Cell
                            key={role}
                            granted={permissionsFor(role).includes(row.permission)}
                          />
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
            {WORKSPACE_ROLES.map((role) => (
              <li key={role} className="rounded-lg border border-border/80 p-2.5">
                <span className="block text-sm font-medium text-foreground">
                  {ROLE_LABELS[role].name}
                  {role === currentRole ? " (you)" : ""}
                </span>
                {ROLE_LABELS[role].summary}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <h2 className="text-sm font-semibold">Members</h2>
            <p className="text-xs text-muted-foreground">
              Effective permissions are the base role plus any assigned custom role.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Member</th>
                  <th className="py-2 font-medium">Base role</th>
                  <th className="py-2 font-medium">Custom role</th>
                  <th className="py-2 text-right font-medium">Effective permissions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const customRole = roleById.get(assignments[member.userId] ?? "");
                  const effective = resolveEffectivePermissions(
                    member.role,
                    customRole?.permissions ?? null,
                  );
                  return (
                    <tr key={member.id} className="border-b last:border-0">
                      <td className="py-2">
                        <p className="font-medium">{member.name}</p>
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      </td>
                      <td className="py-2 capitalize">{member.role}</td>
                      <td className="py-2">{customRole?.name ?? "—"}</td>
                      <td className="py-2 text-right tabular-nums">{effective.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {customRoles.length > 0 ? (
            <div className="space-y-2 border-t pt-4">
              <h3 className="text-sm font-semibold">Custom roles</h3>
              {customRoles.map((role) => (
                <div key={role.id} className="rounded-lg border border-border/80 p-2.5">
                  <p className="text-sm font-medium">{role.name}</p>
                  {role.description ? (
                    <p className="text-xs text-muted-foreground">{role.description}</p>
                  ) : null}
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {role.permissions.length > 0 ? role.permissions.join(", ") : "no extra permissions"}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
