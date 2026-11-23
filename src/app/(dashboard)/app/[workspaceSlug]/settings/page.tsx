import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { SettingsSectionNav } from "@/components/shared/settings-section-nav";
import { Button } from "@/components/ui/button";
import { DashboardViewBeacon } from "@/features/analytics/view-beacon";
import { getBillingView } from "@/features/billing/service";
import { getWorkspaceBranding } from "@/features/branding/branding";
import { BrandingSettingsView } from "@/features/branding/branding-settings-view";
import { getIdentitySettings } from "@/features/customer-auth/identity-settings";
import {
  getWorkspaceEntitlements,
  getWorkspaceUsageMeters,
} from "@/features/entitlements/entitlements";
import { listProductsForWorkspace } from "@/db/queries/workspaces";
import { listWorkspaceInvitations, listWorkspaceMembers } from "@/features/workspace-settings/invitations";
import { DomainSettingsView } from "@/features/workspace-settings/domain-settings-view";
import {
  AUDIT_RETENTION_DAYS,
  getWorkspaceDeletion,
  listWorkspaceAuditEvents,
} from "@/features/data-controls/service";
import { parseAuditFilters } from "@/features/data-controls/audit-filters";
import { getEnterpriseIdentity } from "@/features/enterprise/identity";
import { EnterpriseSettings } from "@/features/enterprise/enterprise-settings";
import { getDomainClaim } from "@/features/workspace-settings/domain-claims";
import { getWorkspaceDomain } from "@/features/workspace-settings/domains";
import { listWorkspaceTokens } from "@/features/workspace-settings/queries";
import { WorkspaceSettingsView } from "@/features/workspace-settings/workspace-settings-view";
import { requireWorkspaceContext } from "@/lib/authz";

export const metadata = { title: "Workspace settings" };

export default async function WorkspaceSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const context = await requireWorkspaceContext(workspaceSlug, "settings:manage");
  const auditFilters = parseAuditFilters(query);
  // The audit log is an owner surface. Admins can manage settings but never
  // read the owner-only administrative history.
  const auditPromise =
    context.role === "owner"
      ? listWorkspaceAuditEvents(context.workspace.id, { filters: auditFilters, limit: 100 })
      : Promise.resolve([]);

  const [products, members, invitations, tokens, billing, entitlements, usageMeters, identity, domain, deletion, audit, enterprise, domainClaim] =
    await Promise.all([
      listProductsForWorkspace(context.workspace.id),
      listWorkspaceMembers(context.workspace.id),
      listWorkspaceInvitations(context.workspace.id),
      listWorkspaceTokens(context.workspace.id),
      getBillingView(context.workspace.id),
      getWorkspaceEntitlements(context.workspace.id),
      getWorkspaceUsageMeters(context.workspace.id),
      getIdentitySettings(context.workspace.id, context.workspace.slug),
      getWorkspaceDomain(context.workspace.id),
      getWorkspaceDeletion(context.workspace.id),
      auditPromise,
      getEnterpriseIdentity(context.workspace.id),
      getDomainClaim(context.workspace.id),
    ]);

  const firstProduct = products[0] ?? null;
  const branding = firstProduct
    ? await getWorkspaceBranding(context.workspace.id)
    : null;
  const logoUrl =
    branding?.hasLogo && firstProduct
      ? `/api/public/workspaces/${encodeURIComponent(context.workspace.slug)}/logo?v=${
          branding.updatedAt ? new Date(branding.updatedAt).getTime() : 0
        }`
      : null;

  const sections = [
    { id: "general", label: "General" },
    { id: "team", label: "Team" },
    ...(context.role === "owner"
      ? [{ id: "email-capture", label: "Domain capture" }]
      : []),
    { id: "billing", label: "Billing" },
    { id: "tokens", label: "API tokens" },
    { id: "enterprise", label: "Enterprise" },
    { id: "privacy", label: "Privacy" },
    { id: "danger", label: "Danger zone" },
    ...(context.role === "owner" ? [{ id: "audit", label: "Audit log" }] : []),
    { id: "product", label: "Products" },
    ...(firstProduct
      ? [
          { id: "branding", label: "Branding" },
          { id: "domain", label: "Domain" },
        ]
      : []),
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <DashboardViewBeacon
        workspaceSlug={workspaceSlug}
        surface="workspace_settings"
        sections={sections.map((section) => section.id)}
      />
      <PageHeader
        title="Workspace settings"
        description="Billing, teammates, API access and the public identity of this workspace."
        actions={
          firstProduct ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/${workspaceSlug}/${firstProduct.slug}`}>Back to product</Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 xl:grid-cols-[190px_minmax(0,1fr)] xl:gap-8">
        <SettingsSectionNav sections={sections} />
        <div className="min-w-0 space-y-6">
          <WorkspaceSettingsView
        workspaceSlug={workspaceSlug}
        workspaceName={context.workspace.name}
        role={context.role}
        members={members}
        invitations={invitations}
        tokens={tokens.map((token) => ({
          ...token,
          scopes: [...token.scopes],
          createdAt: token.createdAt.toISOString(),
          revokedAt: token.revokedAt?.toISOString() ?? null,
          expiresAt: token.expiresAt?.toISOString() ?? null,
          lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
        }))}
        billing={billing}
        usageMeters={usageMeters}
        privacy={{
          maskCustomerIdentity: identity.maskCustomerIdentity,
          allowed: entitlements.features.identityMasking,
        }}
        contentTranslationEnabled={branding?.contentTranslationEnabled ?? false}
        doubleOptIn={context.workspace.doubleOptIn}
        publicPlannedFor={context.workspace.publicPlannedFor}
        plan={entitlements.plan}
        products={products.map((product) => ({ slug: product.slug, name: product.name }))}
        currentUserId={context.user.id}
        deletion={
          deletion
            ? {
                purgeAfter: deletion.purgeAfter.toISOString(),
                cancelledAt: deletion.cancelledAt?.toISOString() ?? null,
              }
            : null
        }
        seats={{
          // `usage.members` already excludes viewers, which are free seats.
          paidUsed: entitlements.usage.members,
          paidLimit: entitlements.limits.members,
          viewers: entitlements.usage.viewers,
        }}
        domainClaim={domainClaim}
        audit={audit}
        auditFilters={auditFilters}
        auditRetentionDays={AUDIT_RETENTION_DAYS}
      />

      <EnterpriseSettings
        workspaceSlug={workspaceSlug}
        identity={enterprise}
        members={members.map((member) => ({
          userId: member.userId,
          name: member.name,
          email: member.email,
          role: member.role,
        }))}
        isOwner={context.role === "owner"}
        ssoAllowed={entitlements.features.sso}
      />

      {firstProduct && branding ? (
        <BrandingSettingsView
          workspaceSlug={workspaceSlug}
          productSlug={firstProduct.slug}
          workspaceName={context.workspace.name}
          initial={branding}
          logoUrl={logoUrl}
          canManage
          hideAttributionAllowed={entitlements.features.hideAttribution}
        />
      ) : null}

      {firstProduct ? (
        <DomainSettingsView
          workspaceSlug={workspaceSlug}
          productSlug={firstProduct.slug}
          domain={domain}
          canManage
          allowed={entitlements.features.customDomains}
        />
      ) : null}
        </div>
      </div>
    </div>
  );
}
