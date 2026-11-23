import { Database, GitBranch, Link2, MessagesSquare, RefreshCw, RotateCw, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/shared/status-badge";

import {
  disconnectCrmAction,
  disconnectIssueTrackerAction,
  disconnectSupportToolAction,
  rotateIssueWebhookTokenAction,
  rotateSupportToolTokenAction,
  saveCrmAction,
  saveIssueTrackerAction,
  saveSupportToolAction,
  syncCrmNowAction,
} from "./actions";
import type { CrmConnectionView } from "./crm-service";
import { CRM_PROVIDER_LABELS } from "./crm-providers";
import type { IssueConnectionView } from "./issue-service";
import type { SupportToolConnectionView } from "@/features/support-tools/service";
import {
  ISSUE_PROVIDERS,
  ISSUE_PROVIDER_LABELS,
  defaultStatusMap,
  type IssueProvider,
  type IssueProviderConfig,
} from "./issue-providers";

function fact(label: string, value: string) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t pt-2.5 text-sm first:border-t-0 first:pt-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-right font-medium">{value}</dd>
    </div>
  );
}

function providerTargetFields(provider: IssueProvider, config: IssueProviderConfig) {
  if (provider === "linear") {
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={`${provider}-team`}>Team id</Label>
        <Input
          id={`${provider}-team`}
          name="linearTeamId"
          defaultValue={config.teamId ?? ""}
          placeholder="9cfb482a-81e3-4154-b5b9-2c805e70a02d"
          required
        />
      </div>
    );
  }
  if (provider === "jira") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor={`${provider}-url`}>Site origin</Label>
          <Input
            id={`${provider}-url`}
            name="jiraUrl"
            defaultValue={config.baseUrl ?? ""}
            placeholder="https://example.atlassian.net"
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${provider}-email`}>API user email</Label>
          <Input
            id={`${provider}-email`}
            name="jiraEmail"
            type="email"
            defaultValue={config.email ?? ""}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${provider}-project`}>Project key</Label>
          <Input
            id={`${provider}-project`}
            name="jiraProjectKey"
            defaultValue={config.projectKey ?? ""}
            placeholder="ENG"
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${provider}-type`}>Issue type</Label>
          <Input
            id={`${provider}-type`}
            name="jiraIssueType"
            defaultValue={config.issueType ?? "Task"}
            required
          />
        </div>
      </div>
    );
  }
  if (provider === "github") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${provider}-owner`}>Owner</Label>
          <Input
            id={`${provider}-owner`}
            name="githubOwner"
            defaultValue={config.owner ?? ""}
            placeholder="acme"
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${provider}-repo`}>Repository</Label>
          <Input
            id={`${provider}-repo`}
            name="githubRepo"
            defaultValue={config.repo ?? ""}
            placeholder="product"
            required
          />
        </div>
      </div>
    );
  }
  if (provider === "clickup") {
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={`${provider}-list`}>List id</Label>
        <Input
          id={`${provider}-list`}
          name="clickupListId"
          defaultValue={config.listId ?? ""}
          required
        />
      </div>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor={`${provider}-url`}>Organization URL</Label>
        <Input
          id={`${provider}-url`}
          name="azureUrl"
          defaultValue={config.baseUrl ?? "https://dev.azure.com"}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${provider}-org`}>Organization</Label>
        <Input
          id={`${provider}-org`}
          name="azureOrganization"
          defaultValue={config.organization ?? ""}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${provider}-project`}>Project</Label>
        <Input
          id={`${provider}-project`}
          name="azureProject"
          defaultValue={config.project ?? ""}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${provider}-type`}>Work item type</Label>
        <Input
          id={`${provider}-type`}
          name="azureWorkItemType"
          defaultValue={config.workItemType ?? "Issue"}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${provider}-area`}>Area path (optional)</Label>
        <Input
          id={`${provider}-area`}
          name="azureAreaPath"
          defaultValue={config.areaPath ?? ""}
        />
      </div>
    </div>
  );
}

function IssueForm({
  provider,
  workspaceSlug,
  productSlug,
  connection,
}: {
  provider: IssueProvider;
  workspaceSlug: string;
  productSlug: string;
  connection?: IssueConnectionView | undefined;
}) {
  const config = connection?.config ?? {};
  return (
    <form action={saveIssueTrackerAction} className="space-y-3 border-t pt-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="productSlug" value={productSlug} />
      <input type="hidden" name="provider" value={provider} />
      <div className="grid gap-1.5">
        <Label htmlFor={`${provider}-name`}>Display name</Label>
        <Input
          id={`${provider}-name`}
          name="name"
          defaultValue={connection?.name ?? ISSUE_PROVIDER_LABELS[provider]}
          maxLength={100}
        />
      </div>
      {providerTargetFields(provider, config)}
      <div className="grid gap-1.5">
        <Label htmlFor={`${provider}-token`}>
          API token{" "}
          {connection
            ? "(leave blank to keep the stored token)"
            : provider === "github"
              ? "(optional when the GitHub App is connected)"
              : ""}
        </Label>
        <Input
          id={`${provider}-token`}
          name="apiToken"
          type="password"
          autoComplete="off"
          placeholder={
            connection
              ? "Stored token unchanged"
              : provider === "github"
                ? "Leave blank to use the connected GitHub App"
                : "Read/write token for issue create"
          }
          required={!connection && provider !== "github"}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${provider}-webhook-secret`}>
          Webhook signing secret {connection ? "(leave blank to keep)" : "(required for Linear, GitHub and ClickUp)"}
        </Label>
        <Input
          id={`${provider}-webhook-secret`}
          name="webhookSecret"
          type="password"
          autoComplete="off"
          placeholder={connection ? "Stored secret unchanged" : "The secret configured in the tracker"}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${provider}-status-map`}>Status map (JSON)</Label>
        <Textarea
          id={`${provider}-status-map`}
          name="statusMap"
          rows={6}
          defaultValue={JSON.stringify(connection?.statusMap ?? defaultStatusMap(provider), null, 2)}
          spellCheck={false}
          className="font-mono text-xs"
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Keys are the tracker&apos;s status names (case-insensitive); values are open,
          under_review, planned, in_progress, shipped or closed.
        </p>
      </div>
      <Button type="submit" size="sm">
        {connection ? "Save connection" : `Connect ${ISSUE_PROVIDER_LABELS[provider]}`}
      </Button>
    </form>
  );
}

export function IssueTrackerSettings({
  workspaceSlug,
  productSlug,
  connections,
}: {
  workspaceSlug: string;
  productSlug: string;
  connections: IssueConnectionView[];
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
            <GitBranch className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Issue trackers</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Link a request to Linear, Jira, GitHub, ClickUp or Azure DevOps. Inbound
              status changes update the request and are audited per delivery.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {ISSUE_PROVIDERS.map((provider) => {
            const connection = connections.find((row) => row.provider === provider);
            return (
              <details
                key={provider}
                className="rounded-md border bg-muted/20 p-3"
                open={Boolean(connection?.active)}
              >
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm font-medium">
                  <span>{ISSUE_PROVIDER_LABELS[provider]}</span>
                  <StatusBadge tone={connection?.active ? "success" : "neutral"}>
                    {connection?.active ? "Connected" : connection ? "Disconnected" : "Not connected"}
                  </StatusBadge>
                </summary>
                <div className="mt-3 space-y-3">
                  {connection ? (
                    <>
                      <dl className="space-y-2.5">
                        {fact("Connection", connection.name)}
                        {fact(
                          "Last event",
                          connection.lastEventAt
                            ? new Date(connection.lastEventAt).toLocaleString()
                            : "No events yet",
                        )}
                      </dl>
                      <div className="rounded-md border bg-background p-2.5 text-xs">
                        <p className="font-medium">Webhook URL</p>
                        <code className="mt-1 block break-all text-muted-foreground">
                          {connection.webhookUrl}
                        </code>
                        <p className="mt-2 text-muted-foreground">
                          {provider === "linear" || provider === "github" || provider === "clickup"
                            ? "Configure the same signing secret in the tracker. Deliveries with a bad signature are rejected."
                            : "Jira and Azure DevOps do not sign admin webhooks; this unguessable URL is the authenticator. Treat it as a secret."}
                        </p>
                      </div>
                    </>
                  ) : null}
                  <IssueForm
                    provider={provider}
                    workspaceSlug={workspaceSlug}
                    productSlug={productSlug}
                    connection={connection}
                  />
                  {connection?.active ? (
                    <div className="flex flex-wrap gap-2">
                      {provider === "jira" || provider === "azure_devops" ? (
                        <form action={rotateIssueWebhookTokenAction}>
                          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                          <input type="hidden" name="productSlug" value={productSlug} />
                          <input type="hidden" name="provider" value={provider} />
                          <Button type="submit" variant="outline" size="sm">
                            <RotateCw aria-hidden="true" />
                            Rotate URL token
                          </Button>
                        </form>
                      ) : null}
                      <form action={disconnectIssueTrackerAction}>
                        <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                        <input type="hidden" name="productSlug" value={productSlug} />
                        <input type="hidden" name="provider" value={provider} />
                        <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                          <Unplug aria-hidden="true" />
                          Disconnect
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </div>
              </details>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function CrmForm({
  provider,
  workspaceSlug,
  productSlug,
  connection,
}: {
  provider: "hubspot" | "salesforce";
  workspaceSlug: string;
  productSlug: string;
  connection?: CrmConnectionView | undefined;
}) {
  return (
    <form action={saveCrmAction} className="space-y-3 border-t pt-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="productSlug" value={productSlug} />
      <input type="hidden" name="provider" value={provider} />
      <div className="grid gap-1.5">
        <Label htmlFor={`${provider}-crm-name`}>Display name</Label>
        <Input
          id={`${provider}-crm-name`}
          name="name"
          defaultValue={connection?.name ?? CRM_PROVIDER_LABELS[provider]}
          maxLength={100}
        />
      </div>
      {provider === "salesforce" ? (
        <div className="grid gap-1.5">
          <Label htmlFor={`${provider}-instance`}>Instance origin</Label>
          <Input
            id={`${provider}-instance`}
            name="instanceUrl"
            type="url"
            defaultValue={connection?.instanceUrl ?? ""}
            placeholder="https://acme.my.salesforce.com"
            required
          />
        </div>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor={`${provider}-crm-token`}>
          Read-only token {connection ? "(leave blank to keep)" : ""}
        </Label>
        <Input
          id={`${provider}-crm-token`}
          name="apiToken"
          type="password"
          autoComplete="off"
          required={!connection}
        />
      </div>
      <Button type="submit" size="sm">
        {connection ? "Save credentials" : `Connect ${CRM_PROVIDER_LABELS[provider]}`}
      </Button>
    </form>
  );
}

export function SupportToolSettings({
  workspaceSlug,
  productSlug,
  connections,
  boards,
}: {
  workspaceSlug: string;
  productSlug: string;
  connections: SupportToolConnectionView[];
  boards: Array<{ id: string; name: string; archivedAt: string | null }>;
}) {
  const activeBoards = boards.filter((board) => !board.archivedAt);
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
            <MessagesSquare className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Support-tool capture</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Turn an Intercom conversation or Zendesk ticket into a feedback request with a
              webhook. Captured requests start private to the extracted author; a teammate reviews
              them before they can appear publicly.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {(["intercom", "zendesk"] as const).map((provider) => {
            const connection = connections.find((row) => row.provider === provider);
            return (
              <details
                key={provider}
                className="rounded-md border bg-muted/20 p-3"
                open={Boolean(connection?.active)}
              >
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm font-medium">
                  <span>{provider === "intercom" ? "Intercom" : "Zendesk"}</span>
                  <StatusBadge tone={connection?.active ? "success" : "neutral"}>
                    {connection?.active ? "Connected" : connection ? "Disconnected" : "Not connected"}
                  </StatusBadge>
                </summary>
                <div className="mt-3 space-y-3">
                  {connection ? (
                    <>
                      <dl className="space-y-2.5">
                        {fact("Capture board", connection.boardName)}
                        {fact(
                          "Last captured",
                          connection.lastEventAt
                            ? new Date(connection.lastEventAt).toLocaleString()
                            : "No captures yet",
                        )}
                        {fact("Last error", connection.lastError ?? "None")}
                      </dl>
                      <div className="rounded-md border bg-background p-2.5 text-xs">
                        <p className="font-medium">Webhook URL</p>
                        <code className="mt-1 block break-all text-muted-foreground">
                          {connection.webhookUrl}
                        </code>
                        <p className="mt-2 text-muted-foreground">
                          This URL is the authenticator. Treat it as a secret. Rotating it makes
                          the previous URL fail immediately, so update the provider in the same
                          step.
                        </p>
                      </div>
                      {connection.active ? (
                        <div className="flex flex-wrap gap-2">
                          <form action={rotateSupportToolTokenAction}>
                            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                            <input type="hidden" name="productSlug" value={productSlug} />
                            <input type="hidden" name="provider" value={provider} />
                            <Button type="submit" variant="outline" size="sm">
                              <RotateCw aria-hidden="true" />
                              Rotate URL
                            </Button>
                          </form>
                          <form action={disconnectSupportToolAction}>
                            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                            <input type="hidden" name="productSlug" value={productSlug} />
                            <input type="hidden" name="provider" value={provider} />
                            <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                              <Unplug aria-hidden="true" />
                              Disconnect
                            </Button>
                          </form>
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  <form action={saveSupportToolAction} className="space-y-3 border-t pt-3">
                    <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                    <input type="hidden" name="productSlug" value={productSlug} />
                    <input type="hidden" name="provider" value={provider} />
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${provider}-support-name`}>Display name</Label>
                      <Input
                        id={`${provider}-support-name`}
                        name="name"
                        defaultValue={connection?.name ?? (provider === "intercom" ? "Intercom" : "Zendesk")}
                        maxLength={100}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${provider}-capture-board`}>Create requests on</Label>
                      <select
                        id={`${provider}-capture-board`}
                        name="boardId"
                        defaultValue={connection?.boardId ?? activeBoards[0]?.id ?? ""}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        required
                      >
                        <option value="">Choose a board</option>
                        {activeBoards.map((board) => (
                          <option key={board.id} value={board.id}>
                            {board.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button type="submit" size="sm">
                      {connection ? "Save capture settings" : `Connect ${provider === "intercom" ? "Intercom" : "Zendesk"}`}
                    </Button>
                  </form>

                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {provider === "zendesk"
                      ? "Configure a Zendesk trigger webhook that sends the ticket JSON to this URL. Subject, description and requester become the request; ticket id deduplicates retries."
                      : "Subscribe this URL to Intercom conversation-created webhooks. The source subject/body and conversation parts become the request; conversation id deduplicates retries."}
                  </p>
                </div>
              </details>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export function CrmSettings({
  workspaceSlug,
  productSlug,
  connections,
}: {
  workspaceSlug: string;
  productSlug: string;
  connections: CrmConnectionView[];
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
            <Database className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">CRM snapshots</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Read-only HubSpot or Salesforce company, contact and open-deal totals. The
              sync job is the only writer; dashboard forms never accept cached values.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {(["hubspot", "salesforce"] as const).map((provider) => {
            const connection = connections.find((row) => row.provider === provider);
            return (
              <details
                key={provider}
                className="rounded-md border bg-muted/20 p-3"
                open={Boolean(connection?.active)}
              >
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm font-medium">
                  <span>{CRM_PROVIDER_LABELS[provider]}</span>
                  <StatusBadge tone={connection?.active ? "success" : "neutral"}>
                    {connection?.active ? "Connected" : connection ? "Disconnected" : "Not connected"}
                  </StatusBadge>
                </summary>
                <div className="mt-3 space-y-3">
                  {connection ? (
                    <>
                      <dl className="space-y-2.5">
                        {fact("Connection", connection.name)}
                        {fact("Linked companies", String(connection.companyCount))}
                        {fact(
                          "Last sync",
                          connection.lastSyncedAt
                            ? new Date(connection.lastSyncedAt).toLocaleString()
                            : "Never",
                        )}
                        {fact("Last error", connection.lastError ?? "None")}
                      </dl>
                      {connection.active ? (
                        <div className="flex flex-wrap gap-2">
                          <form action={syncCrmNowAction}>
                            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                            <input type="hidden" name="productSlug" value={productSlug} />
                            <input type="hidden" name="provider" value={provider} />
                            <Button type="submit" variant="outline" size="sm">
                              <RefreshCw aria-hidden="true" />
                              Sync now
                            </Button>
                          </form>
                          <form action={disconnectCrmAction}>
                            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                            <input type="hidden" name="productSlug" value={productSlug} />
                            <input type="hidden" name="provider" value={provider} />
                            <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                              <Unplug aria-hidden="true" />
                              Disconnect
                            </Button>
                          </form>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <CrmForm
                    provider={provider}
                    workspaceSlug={workspaceSlug}
                    productSlug={productSlug}
                    connection={connection}
                  />
                </div>
              </details>
            );
          })}
        </div>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Link2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Companies are matched by their stored domain or external id. Contacts are
          cached only for customers who already belong to that company.
        </p>
      </CardContent>
    </Card>
  );
}
