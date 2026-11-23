import {
  CreditCard,
  GitBranch,
  MessagesSquare,
  Send,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getBillingView } from "@/features/billing/service";
import { getSenderIdentity } from "@/features/email/identity";
import { getGithubAppConfig } from "@/features/github/app";
import { getGithubInstallationForProduct } from "@/features/github/service";
import { disconnectGithubInstallationAction } from "@/features/integrations/actions";
import { CrmSettings, IssueTrackerSettings, SupportToolSettings } from "@/features/integrations/settings";
import { listCrmConnections } from "@/features/integrations/crm-service";
import { listIssueConnectionsForSettings } from "@/features/integrations/issue-service";
import { disconnectSlackAction, saveSlackChannelAction } from "@/features/slack/actions";
import { listSlackChannels, type SlackChannel } from "@/features/slack/client";
import { getSlackConfig } from "@/features/slack/config";
import { getSlackIntegration } from "@/features/slack/service";
import { listWebhooks } from "@/features/webhooks/service";
import {
  listCaptureBoards,
  listSupportToolConnections,
} from "@/features/support-tools/service";
import { requireProductContext } from "@/lib/authz";
import { getEmailConfig } from "@/lib/env";

export const metadata = {
  title: "Integrations",
};

const ERROR_MESSAGES: Record<string, string> = {
  not_configured:
    "Slack is not configured on this deployment. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_SIGNING_SECRET and BETTER_AUTH_URL.",
  configuration: "The Slack configuration is incomplete. Check the deployment environment.",
  slack_install: "Slack did not complete the installation. Try connecting again.",
  invalid_state: "That Slack installation link expired. Start the connection again.",
  "That channel is not visible to the Slack app.":
    "That channel is not visible to the Slack app. Invite the bot to the channel and try again.",
  "That Slack channel is already connected to another product.":
    "That Slack channel is already connected to another product.",
};

function endpointHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function IntegrationCard({
  icon: Icon,
  name,
  purpose,
  status,
  children,
}: {
  icon: LucideIcon;
  name: string;
  purpose: string;
  status: { label: string; tone: StatusTone };
  children?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">{name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{purpose}</p>
            </div>
          </div>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t pt-2.5 text-sm first:border-t-0 first:pt-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

export default async function IntegrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{
    slack?: string;
    issue?: string;
    crm?: string;
    support?: string;
    github?: string;
    error?: string;
  }>;
}) {
  const [{ workspaceSlug, productSlug }, query] = await Promise.all([params, searchParams]);
  const context = await requireProductContext(workspaceSlug, productSlug, "settings:manage");
  const base = `/app/${workspaceSlug}/${productSlug}`;

  let configured = false;
  let configError = false;
  try {
    configured = getSlackConfig() !== null;
  } catch {
    configError = true;
  }

  let emailConfigured = false;
  let emailConfigError = false;
  try {
    emailConfigured = getEmailConfig() !== null;
  } catch {
    emailConfigError = true;
  }

  const [
    integration,
    billing,
    sender,
    webhooks,
    issueConnections,
    crmConnections,
    supportConnections,
    captureBoards,
    githubInstallation,
  ] =
    await Promise.all([
      getSlackIntegration(context.product.id),
      getBillingView(context.workspace.id),
      getSenderIdentity(context.workspace.id),
      listWebhooks(context.workspace.id),
      listIssueConnectionsForSettings(context.product.id),
      listCrmConnections(context.workspace.id),
      listSupportToolConnections(context.product.id),
      listCaptureBoards(context.product.id),
      getGithubInstallationForProduct(context.product.id),
    ]);

  let githubConfigured = false;
  let githubConfigError = false;
  try {
    githubConfigured = getGithubAppConfig() !== null;
  } catch {
    githubConfigError = true;
  }

  let channels: SlackChannel[] = [];
  let channelError: string | null = null;
  if (integration?.active && configured) {
    try {
      channels = await listSlackChannels(integration.accessToken);
    } catch {
      channelError =
        "Slack's channel list could not be loaded. Check that the app is still installed.";
    }
  }

  const installHref =
    `/api/integrations/slack/install?workspaceSlug=${encodeURIComponent(workspaceSlug)}` +
    `&productSlug=${encodeURIComponent(productSlug)}`;
  const currentValue =
    integration?.channelId && integration.channelName
      ? `${integration.channelId}:${encodeURIComponent(integration.channelName)}`
      : undefined;
  const errorMessage = query.error
    ? (ERROR_MESSAGES[query.error] ?? query.error)
    : null;

  const stripeStatus = !billing.configured
    ? ({ label: "Not configured", tone: "warning" } as const)
    : billing.hasCustomer
      ? ({ label: "Connected", tone: "success" } as const)
      : ({ label: "No billing account", tone: "neutral" } as const);

  const emailStatus = emailConfigError
    ? ({ label: "Configuration error", tone: "danger" } as const)
    : emailConfigured
      ? ({ label: "Configured", tone: "success" } as const)
      : ({ label: "Not configured", tone: "warning" } as const);

  const activeWebhooks = webhooks.filter((hook) => hook.active);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Integrations"
        description="Connect the tools this product already works with. A card only reports what the deployment can verify; nothing here is marked connected because a button was clicked."
      />

      {query.slack === "connected" && (
        <p className="rounded-md border border-success/40 bg-success-muted px-3 py-2 text-sm text-success">
          Slack connected. Choose the channel the bot should watch.
        </p>
      )}
      {query.slack === "channel_saved" && (
        <p className="rounded-md border border-success/40 bg-success-muted px-3 py-2 text-sm text-success">
          Slack channel saved.
        </p>
      )}
      {query.slack === "disconnected" && (
        <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          Slack disconnected. Existing links stay in the database for audit.
        </p>
      )}
      {query.issue === "saved" && (
        <p className="rounded-md border border-success/40 bg-success-muted px-3 py-2 text-sm text-success">
          Issue-tracker connection saved. Paste its webhook URL into the tracker, then
          link issues from a feedback request.
        </p>
      )}
      {query.issue === "disconnected" && (
        <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          Issue tracker disconnected. Existing issue links are retained for audit.
        </p>
      )}
      {query.issue === "token_rotated" && (
        <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          Webhook URL token rotated. The old URL now returns 404; update Jira or Azure DevOps with
          the new URL below.
        </p>
      )}
      {query.issue === "missing" && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          That issue-tracker connection no longer exists.
        </p>
      )}
      {query.crm === "saved" && (
        <p className="rounded-md border border-success/40 bg-success-muted px-3 py-2 text-sm text-success">
          CRM connection saved. A read-only sync was queued.
        </p>
      )}
      {query.crm === "queued" && (
        <p className="rounded-md border border-success/40 bg-success-muted px-3 py-2 text-sm text-success">
          CRM sync queued. The page reports the stored result, not an assumed success.
        </p>
      )}
      {query.crm === "disconnected" && (
        <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          CRM disconnected. Cached totals are retained until the next sync or removal.
        </p>
      )}
      {query.support === "saved" && (
        <p className="rounded-md border border-success/40 bg-success-muted px-3 py-2 text-sm text-success">
          Capture connection saved. Paste its webhook URL into the support tool.
        </p>
      )}
      {query.support === "disconnected" && (
        <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          Capture disconnected. The URL now returns 404 and existing requests stay in place.
        </p>
      )}
      {query.support === "token_rotated" && (
        <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          Webhook URL rotated. The previous URL no longer works; copy the new one into the
          support tool now.
        </p>
      )}
      {query.support === "missing" && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          The capture connection no longer exists.
        </p>
      )}
      {query.github === "connected" && (
        <p className="rounded-md border border-success/40 bg-success-muted px-3 py-2 text-sm text-success">
          GitHub App connected. Private-repository imports will use short-lived installation tokens.
        </p>
      )}
      {query.github === "disconnected" && (
        <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          GitHub App disconnected. Personal tokens are no longer used; install the App again to
          import a private repository.
        </p>
      )}
      {query.github === "lookup_failed" && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          GitHub did not return that installation. Check the App is installed and try again.
        </p>
      )}
      {query.github === "requested" && (
        <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          The GitHub organization owner must approve the installation before imports can use it.
        </p>
      )}
      {errorMessage && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <IntegrationCard
          icon={MessagesSquare}
          name="Slack"
          purpose="A message in a watched channel becomes a feedback request; status changes reply in the thread."
          status={
            integration?.active
              ? { label: "Connected", tone: "success" }
              : configured
                ? { label: "Ready to connect", tone: "neutral" }
                : { label: configError ? "Configuration error" : "Not configured", tone: "warning" }
          }
        >
          <dl className="space-y-2.5">
            <Fact label="Workspace">
              {integration?.teamName ?? "Not connected"}
            </Fact>
            <Fact label="Channel">
              {integration?.channelName ? `#${integration.channelName}` : "None selected"}
            </Fact>
            <Fact label="Last successful sync">Not tracked for this integration</Fact>
          </dl>

          {!configured ? (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Add the Slack app credentials to the deployment environment before connecting a
              workspace. OAuth is started by a server route, never by the browser alone.
            </p>
          ) : null}

          {integration?.active ? (
            <div className="space-y-3 border-t pt-3">
              {channelError ? <p className="text-sm text-destructive">{channelError}</p> : null}

              {channels.length > 0 || integration.channelId ? (
                <form action={saveSlackChannelAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                  <input type="hidden" name="productSlug" value={productSlug} />
                  <label className="min-w-56 flex-1 space-y-1 text-sm">
                    <span className="font-medium">Notification channel</span>
                    <select
                      className="h-9 w-full rounded-md border bg-background px-2"
                      name="channel"
                      defaultValue={currentValue}
                    >
                      {integration.channelId &&
                        !channels.some((channel) => channel.id === integration.channelId) && (
                          <option value={currentValue}>
                            #{integration.channelName ?? integration.channelId}
                          </option>
                        )}
                      {channels.map((channel) => (
                        <option
                          key={channel.id}
                          value={`${channel.id}:${encodeURIComponent(channel.name)}`}
                        >
                          #{channel.name}
                          {channel.isPrivate ? " (private)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button type="submit" variant="outline" size="sm">
                    Save channel
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Invite the Herald Slack app to a channel, then reload this page to choose it.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button asChild variant="outline" size="sm">
                  <a href={installHref}>Reconnect Slack</a>
                </Button>
                <form action={disconnectSlackAction}>
                  <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                  <input type="hidden" name="productSlug" value={productSlug} />
                  <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                    Disconnect
                  </Button>
                </form>
              </div>
            </div>
          ) : configured ? (
            <Button asChild size="sm">
              <a href={installHref}>Connect Slack</a>
            </Button>
          ) : null}

          <p className="text-xs leading-relaxed text-muted-foreground">
            When an AI provider is configured, messages are classified against this product&apos;s
            active boards. Without one, the first line becomes the title and the first active board
            is used, so filing never depends on an external service.
          </p>
        </IntegrationCard>

        <div className="lg:col-span-2">
          <IssueTrackerSettings
            workspaceSlug={workspaceSlug}
            productSlug={productSlug}
            connections={issueConnections}
          />
        </div>

        <div className="lg:col-span-2">
          <CrmSettings
            workspaceSlug={workspaceSlug}
            productSlug={productSlug}
            connections={crmConnections}
          />
        </div>

        <div className="lg:col-span-2">
          <SupportToolSettings
            workspaceSlug={workspaceSlug}
            productSlug={productSlug}
            connections={supportConnections}
            boards={captureBoards.map((board) => ({
              id: board.id,
              name: board.name,
              archivedAt: board.archivedAt?.toISOString() ?? null,
            }))}
          />
        </div>

        <IntegrationCard
          icon={CreditCard}
          name="Stripe"
          purpose="Billing events, plans and invoices. Subscription state is written only by the signed Stripe webhook."
          status={stripeStatus}
        >
          <dl className="space-y-2.5">
            <Fact label="Plan">{billing.planName}</Fact>
            <Fact label="Subscription">
              {billing.hasCustomer ? billing.status : "No billing account linked"}
            </Fact>
            <Fact label="Last successful sync">
              {billing.hasCustomer ? "Webhook-driven" : "Never"}
            </Fact>
          </dl>
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/${workspaceSlug}/settings`}>Open billing settings</Link>
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Cancellations are not ingested from Stripe automatically: win-back audiences come from
            CSV imports and the API today. Status here reports configuration and the stored
            subscription row — not a live Stripe API check on every page load.
          </p>
        </IntegrationCard>

        <IntegrationCard
          icon={Send}
          name="Resend"
          purpose="Deliver release announcements, weekly digests and win-back email."
          status={emailStatus}
        >
          <dl className="space-y-2.5">
            <Fact label="Sending as">
              {sender.from || "No sender resolved"}
            </Fact>
            <Fact label="Workspace sender identity">
              {sender.configured ? "Saved" : "Not saved"}
            </Fact>
            <Fact label="Last successful sync">Not tracked for this provider</Fact>
          </dl>
          <Button asChild variant="outline" size="sm">
            <Link href={`${base}/settings#sender-identity`}>Configure sender</Link>
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Provider credentials live in deployment environment variables. A test send from
            Subscribers records the real provider response and failure reason, so delivery is never
            inferred from a green badge.
          </p>
        </IntegrationCard>

        <IntegrationCard
          icon={GitBranch}
          name="GitHub"
          purpose="Import issues from private repositories through a GitHub App installation instead of a personal access token."
          status={
            githubInstallation
              ? { label: "Connected", tone: "success" }
              : githubConfigured
                ? { label: "Ready to install", tone: "neutral" }
                : { label: githubConfigError ? "Configuration error" : "Not configured", tone: "warning" }
          }
        >
          <dl className="space-y-2.5">
            <Fact label="Account">
              {githubInstallation?.accountLogin ?? "No App installation"}
            </Fact>
            <Fact label="Repositories">
              {githubInstallation?.repositorySelection === "selected"
                ? "Selected repositories"
                : githubInstallation
                  ? "All repositories"
                  : "—"}
            </Fact>
            <Fact label="Credential">
              {githubInstallation ? "Short-lived installation token" : "No personal token stored"}
            </Fact>
          </dl>
          {!githubConfigured ? (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Set <code>GITHUB_APP_ID</code>, <code>GITHUB_APP_SLUG</code> and{" "}
              <code>GITHUB_APP_PRIVATE_KEY</code> on the deployment, and point the App&apos;s setup
              URL at <code>/api/integrations/github/callback</code>.
            </p>
          ) : githubInstallation ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a
                  href={`/api/integrations/github/install?workspaceSlug=${encodeURIComponent(
                    workspaceSlug,
                  )}&productSlug=${encodeURIComponent(productSlug)}`}
                >
                  Reconfigure installation
                </a>
              </Button>
              <form action={disconnectGithubInstallationAction}>
                <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                <input type="hidden" name="productSlug" value={productSlug} />
                <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                  Disconnect
                </Button>
              </form>
            </div>
          ) : (
            <Button asChild size="sm">
              <a
                href={`/api/integrations/github/install?workspaceSlug=${encodeURIComponent(
                  workspaceSlug,
                )}&productSlug=${encodeURIComponent(productSlug)}`}
              >
                Install GitHub App
              </a>
            </Button>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            The App private key stays in the deployment environment. Herald mints a one-hour
            installation token only when importing issues; it is never stored or shown in the
            browser. A personal token remains optional for a one-off import.
          </p>
        </IntegrationCard>

        <div className="lg:col-span-2">
          <IntegrationCard
            icon={Webhook}
            name="Outbound webhooks"
            purpose="Send signed events to your own endpoint when requests, comments or changelogs change."
            status={
              activeWebhooks.length > 0
                ? { label: `${activeWebhooks.length} active`, tone: "success" }
                : { label: "No endpoints", tone: "neutral" }
            }
          >
            <dl className="space-y-2.5">
              <Fact label="Endpoints">{webhooks.length}</Fact>
              <Fact label="Delivery log">
                {webhooks.length > 0 ? "Dead-letter console available" : "No deliveries yet"}
              </Fact>
            </dl>

            {webhooks.length > 0 ? (
              <ul className="divide-y rounded-md border text-sm">
                {webhooks.slice(0, 4).map((hook) => (
                  <li key={hook.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{hook.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {endpointHost(hook.url)}
                      </span>
                    </span>
                    <StatusBadge tone={hook.active ? "success" : "neutral"}>
                      {hook.active ? "Active" : "Paused"}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            ) : null}

            <Button asChild variant="outline" size="sm">
              <Link href={`${base}/integrations/webhooks`}>Open webhook console</Link>
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Create endpoints, rotate signing secrets with a 24-hour overlap, inspect the event
              catalogue and replay dead-letter deliveries. Creating and rotating also remains
              available through <code>/api/app/{workspaceSlug}/webhooks</code>.
            </p>
          </IntegrationCard>
        </div>
      </div>
    </div>
  );
}
