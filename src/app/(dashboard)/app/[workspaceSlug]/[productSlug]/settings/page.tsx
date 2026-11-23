import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { DashboardViewBeacon } from "@/features/analytics/view-beacon";
import { SettingsSectionNav } from "@/components/shared/settings-section-nav";
import { Button } from "@/components/ui/button";
import { listBoardsForProduct } from "@/db/queries/boards";
import { listConversationMacros } from "@/features/conversations/macros";
import { ConversationMacrosSettingsView } from "@/features/conversations/macros-settings-view";
import { ConversationFeedbackSettingsView } from "@/features/conversations/support-settings-view";
import {
  ensureProductSupportSettings,
  listIntakeQuestionsForSettings,
} from "@/features/conversations/support-settings";
import { getWorkspaceBranding } from "@/features/branding/branding";
import { listCustomFieldsForProduct } from "@/db/queries/custom-fields";
import { BrandingSettingsView } from "@/features/branding/branding-settings-view";
import { getIdentitySettings } from "@/features/customer-auth/identity-settings";
import { SsoSettingsView } from "@/features/customer-auth/sso-settings-view";
import { checkEmailDomainAuthFor } from "@/features/email/domain-auth";
import { EmailDomainAuthView } from "@/features/email/domain-auth-view";
import { EmailPreviewView } from "@/features/email/email-preview-view";
import { getSenderIdentity } from "@/features/email/identity";
import { buildEmailPreviews } from "@/features/email/previews";
import { SenderIdentityView } from "@/features/email/sender-identity-view";
import { ensureProductEmailSettings } from "@/features/email/inbound";
import { getJunoActivity } from "@/features/juno/activity";
import { JunoActivityView } from "@/features/juno/activity-view";
import {
  listAgentActionRuns,
  listAgentActionSettings,
} from "@/features/juno/agent-actions";
import { AgentActionsView } from "@/features/juno/agent-actions-view";
import { listRecentSuggestions } from "@/features/juno/auxiliary";
import { listEvalStatus } from "@/features/juno/evaluation";
import { JunoEvaluationView } from "@/features/juno/evaluation-view";
import { JunoSettingsView } from "@/features/juno/settings-view";
import { JunoKnowledgeTasksView } from "@/features/juno/knowledge-tasks-view";
import { JunoRedactionAuditView } from "@/features/juno/redaction-audit-view";
import { getWorkspaceRedactionReport } from "@/features/juno/audit";
import { listOpenKnowledgeTasks } from "@/features/juno/knowledge-tasks";
import { ensureJunoSettings } from "@/features/juno/settings";
import { JunoSuggestionsView } from "@/features/juno/suggestions-view";
import { listKnowledgeSources } from "@/features/juno/sources";
import { SupportSettingsView } from "@/features/operators/settings-view";
import {
  listOperatorSettings,
  touchOperatorPresence,
} from "@/features/operators/service";
import { CustomFieldsView } from "@/features/products/custom-fields-view";
import { ProductDetailsView } from "@/features/products/details-view";
import { workspaceHasFeature } from "@/features/entitlements/entitlements";
import { resolveProductPage } from "@/lib/product-page";
import { getServerEnv } from "@/lib/env";
import { hasPermission } from "@/lib/permissions";

export const metadata = {
  title: "Settings",
};

const SETTINGS_SECTIONS = [
  { id: "product-details", label: "Product details" },
  { id: "custom-fields", label: "Custom fields" },
  { id: "branding", label: "Branding" },
  { id: "identity", label: "Single sign-on" },
  { id: "support", label: "Support" },
  { id: "conversation-feedback", label: "Conversation feedback" },
  { id: "juno", label: "Juno" },
  { id: "agent-actions", label: "Agent actions" },
  { id: "sender-identity", label: "Sender identity" },
  { id: "email-previews", label: "Email previews" },
  { id: "email-authentication", label: "Email authentication" },
];

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
    const status = await searchParams;
  const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "settings:manage");

  const [
    settings,
    branding,
    email,
    senderIdentity,
    operators,
    juno,
    knowledgeSources,
    junoActivity,
    junoKnowledgeTasks,
    junoRedactionReport,
    junoEval,
    junoSuggestions,
    agentActions,
    agentRuns,
    hideAttributionAllowed,
    ssoAllowed,
    customFieldDefinitions,
    supportSettings,
    intakeQuestionRows,
    boardRows,
    macroRows,
  ] = await Promise.all([
      getIdentitySettings(context.workspace.id, context.workspace.slug),
      getWorkspaceBranding(context.workspace.id),
      ensureProductEmailSettings(context.product.id),
      getSenderIdentity(context.workspace.id),
      listOperatorSettings(context.workspace.id),
      ensureJunoSettings(context.product.id),
      listKnowledgeSources(context.product.id),
      getJunoActivity(context.product.id),
      listOpenKnowledgeTasks(context.product.id),
      getWorkspaceRedactionReport(context.workspace.id),
      listEvalStatus(context.product.id),
      listRecentSuggestions(context.product.id),
      listAgentActionSettings(context.product.id),
      listAgentActionRuns(context.product.id),
      workspaceHasFeature(context.workspace.id, "hideAttribution"),
      workspaceHasFeature(context.workspace.id, "sso"),
      listCustomFieldsForProduct(context.product.id, { includeArchived: true }),
      ensureProductSupportSettings(context.product.id),
      listIntakeQuestionsForSettings(context.product.id),
      listBoardsForProduct(context.product.id),
      listConversationMacros(context.product.id),
    ]);

  // DNS checks follow the workspace sender identity, not the deployment-wide
  // fallback, so the card describes the domain campaigns actually send from.
  const domainAuth = await checkEmailDomainAuthFor(senderIdentity.fromEmail, {
    source: senderIdentity.configured ? "workspace" : "deployment",
  });

  // Using the settings screen is itself a presence signal; the service ignores
  // editors, so a non-operator visit never creates an operator row.
  await touchOperatorPresence({
    workspaceId: context.workspace.id,
    userId: context.user.id,
  });

  const canManage = hasPermission(context.role, "settings:manage");
  const emailPreviews = buildEmailPreviews(new URL(getServerEnv().BETTER_AUTH_URL).origin);
  const logoUrl = branding.hasLogo
    ? `/api/public/workspaces/${encodeURIComponent(context.workspace.slug)}/logo?v=${
        branding.updatedAt ? new Date(branding.updatedAt).getTime() : 0
      }`
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <DashboardViewBeacon
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        surface="product_settings"
        sections={SETTINGS_SECTIONS.map((section) => section.id)}
      />
      <PageHeader
        title="Settings"
        description="How your public pages look, how customers sign in, and who answers conversations."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/${workspaceSlug}/settings`}>Workspace settings</Link>
          </Button>
        }
      />

      {status.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {status.error}
        </p>
      )}
      {status.saved && (
        <p className="rounded-md border border-success/30 bg-success-muted px-3 py-2 text-sm text-success">
          Settings saved.
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[190px_minmax(0,1fr)] xl:gap-8">
        <SettingsSectionNav sections={SETTINGS_SECTIONS} />
        <div className="min-w-0 space-y-6">
          <ProductDetailsView
            workspaceSlug={workspaceSlug}
            productSlug={productSlug}
            productName={context.product.name}
            initialDescription={context.product.description ?? ""}
            updatedAt={context.product.updatedAt.toISOString()}
            canManage={canManage}
          />

          <CustomFieldsView
            workspaceSlug={workspaceSlug}
            productSlug={productSlug}
            fields={customFieldDefinitions}
            canManage={canManage}
          />

          <BrandingSettingsView
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        workspaceName={context.workspace.name}
        initial={branding}
        logoUrl={logoUrl}
        canManage={canManage}
        hideAttributionAllowed={hideAttributionAllowed}
      />

      <SsoSettingsView
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        settings={settings}
        canManage={canManage}
        allowed={ssoAllowed}
      />

      <div id="support" className="scroll-mt-24">
        <SupportSettingsView
          workspaceSlug={workspaceSlug}
          productSlug={productSlug}
          email={email}
          operators={operators}
          canManage={canManage}
        />
      </div>

      <div id="conversation-macros" className="scroll-mt-24">
        <ConversationMacrosSettingsView
          workspaceSlug={workspaceSlug}
          productSlug={productSlug}
          macros={macroRows}
          members={operators
            .filter((operator) => operator.role === "owner" || operator.role === "admin")
            .map((operator) => ({
              id: operator.userId,
              name: operator.name,
              email: operator.email,
              role: operator.role,
            }))}
          canManage={canManage}
        />
      </div>

      <div id="conversation-feedback" className="scroll-mt-24">
        <ConversationFeedbackSettingsView
          workspaceSlug={workspaceSlug}
          productSlug={productSlug}
          csatEnabled={supportSettings.csatEnabled}
          sla={{
            enabled: supportSettings.slaEnabled,
            firstResponseMinutes: supportSettings.slaFirstResponseMinutes,
            businessHours: supportSettings.slaBusinessHours ?? null,
            timezone: supportSettings.slaTimezone,
          }}
          questions={intakeQuestionRows}
          boards={boardRows
            .filter((board) => !board.archivedAt)
            .map((board) => ({ id: board.id, name: board.name }))}
          canManage={canManage}
        />
      </div>

      <JunoSettingsView
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        settings={juno}
        sources={knowledgeSources}
        canManage={hasPermission(context.role, "juno:manage")}
      />

      <AgentActionsView
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        actions={agentActions}
        runs={agentRuns}
        canManage={hasPermission(context.role, "juno:manage")}
      />

      <JunoActivityView activity={junoActivity} />

      <JunoKnowledgeTasksView
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        tasks={junoKnowledgeTasks}
        canManage={hasPermission(context.role, "juno:manage")}
      />

      <JunoRedactionAuditView report={junoRedactionReport} />

      <JunoEvaluationView
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        cases={junoEval}
        canManage={hasPermission(context.role, "juno:manage")}
      />

      <JunoSuggestionsView suggestions={junoSuggestions} />

                <SenderIdentityView
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        identity={senderIdentity}
        canManage={canManage}
      />

          <EmailPreviewView previews={emailPreviews} />

          <EmailDomainAuthView report={domainAuth} />
        </div>
      </div>
    </div>
  );
}
