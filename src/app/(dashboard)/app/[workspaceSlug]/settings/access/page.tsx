import { PermissionsView } from "@/features/workspace-settings/permissions-view";
import { getEnterpriseIdentity } from "@/features/enterprise/identity";
import { listWorkspaceMembers } from "@/features/workspace-settings/invitations";
import { requireWorkspaceContext } from "@/lib/authz";

export const metadata = { title: "Who can do what" };

/**
 * Read-only access map for the current workspace.
 *
 * `member:read` is the bar: owners and admins can see the team, editors and
 * viewers cannot. The page never reads or writes members' data beyond name,
 * email and role.
 */
export default async function WorkspaceAccessPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const context = await requireWorkspaceContext(workspaceSlug, "member:read");

  const [members, enterprise] = await Promise.all([
    listWorkspaceMembers(context.workspace.id),
    getEnterpriseIdentity(context.workspace.id),
  ]);

  return (
    <PermissionsView
      workspaceSlug={workspaceSlug}
      workspaceName={context.workspace.name}
      currentRole={context.role}
      members={members}
      customRoles={enterprise.customRoles}
      assignments={enterprise.assignments}
    />
  );
}
