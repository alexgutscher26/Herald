import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { WEBHOOK_EVENT_CATALOG, webhookExampleEnvelope } from "@/features/webhooks/catalog";
import { listWebhooks, listWorkspaceDeliveries } from "@/features/webhooks/service";
import {
  WebhookConsole,
  type WebhookConsoleDelivery,
  type WebhookConsoleEndpoint,
  type WebhookConsoleEvent,
} from "@/features/webhooks/webhook-console";
import { resolveProductPage } from "@/lib/product-page";

export const metadata = {
  title: "Webhooks",
};

export default async function WebhooksPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
}) {
    const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "settings:manage");

  const [hooks, failed, skipped] = await Promise.all([
    listWebhooks(context.workspace.id),
    listWorkspaceDeliveries({
      workspaceId: context.workspace.id,
      status: "failed",
      limit: 100,
    }),
    listWorkspaceDeliveries({
      workspaceId: context.workspace.id,
      status: "skipped",
      limit: 100,
    }),
  ]);

  const endpoints: WebhookConsoleEndpoint[] = hooks.map((hook) => ({
    id: hook.id,
    name: hook.name,
    url: hook.url,
    events: hook.events,
    active: hook.active,
    previousSecretExpiresAt: hook.previousSecretExpiresAt?.toISOString() ?? null,
  }));

  const deadLetters: WebhookConsoleDelivery[] = [...failed, ...skipped]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 100)
    .map((delivery) => ({
      id: delivery.id,
      event: delivery.event,
      status: delivery.status,
      attempts: delivery.attempts,
      responseStatus: delivery.responseStatus,
      error: delivery.error,
      createdAt: delivery.createdAt.toISOString(),
      webhook: delivery.webhook,
    }));

  const events: WebhookConsoleEvent[] = WEBHOOK_EVENT_CATALOG.map((definition) => ({
    event: definition.event,
    label: definition.label,
    description: definition.description,
    example: definition.example,
    envelope: webhookExampleEnvelope(definition.event),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Webhooks"
        description="Signed outbound events, replayable delivery failures and per-event payload examples. The cron worker owns delivery; this page never claims a receiver accepted anything."
      />
      <Link
        href={`/app/${workspaceSlug}/${productSlug}/integrations`}
        className="inline-flex text-sm font-medium text-primary hover:underline"
      >
        Back to integrations
      </Link>
      <WebhookConsole
        workspaceSlug={workspaceSlug}
        endpoints={endpoints}
        failedDeliveries={deadLetters}
        events={events}
      />
    </div>
  );
}
