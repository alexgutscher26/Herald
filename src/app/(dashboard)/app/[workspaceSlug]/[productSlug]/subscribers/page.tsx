import { getDeliveryLog, type DeliveryStatus } from "@/db/queries/notifications";
import {
  getSubscriberGrowth,
  listSubscribers,
  listSuppressions,
  type SubscriberSource,
  type SubscriberStatus,
} from "@/db/queries/subscribers";
import { SubscribersView } from "@/features/subscribers/subscribers-view";
import { listSubscriptionTopics } from "@/features/subscribers/subscription-topics";
import { resolveProductPage } from "@/lib/product-page";
import { hasPermission } from "@/lib/permissions";

export const metadata = {
  title: "Subscribers",
};

const STATUSES: SubscriberStatus[] = ["pending", "active", "unsubscribed"];
const SOURCES: SubscriberSource[] = ["widget", "import", "api", "manual", "follower"];
const DELIVERY_STATUSES: DeliveryStatus[] = [
  "pending",
  "sent",
  "failed",
  "bounced",
  "complained",
  "skipped",
];

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function SubscribersPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{
    q?: string | string[];
    status?: string | string[];
    source?: string | string[];
    page?: string | string[];
    logQ?: string | string[];
    logStatus?: string | string[];
  }>;
}) {
    const query = await searchParams;
  const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "subscriber:read");

  const search = first(query.q).trim().slice(0, 200);
  const statusValue = first(query.status);
  const sourceValue = first(query.source);
  const status = STATUSES.includes(statusValue as SubscriberStatus)
    ? (statusValue as SubscriberStatus)
    : "all";
  const source = SOURCES.includes(sourceValue as SubscriberSource)
    ? (sourceValue as SubscriberSource)
    : "all";
  const logSearch = first(query.logQ).trim().slice(0, 200);
  const logStatusValue = first(query.logStatus);
  const logStatus = DELIVERY_STATUSES.includes(logStatusValue as DeliveryStatus)
    ? (logStatusValue as DeliveryStatus)
    : "all";
  const requestedPage = Number.parseInt(first(query.page), 10);

  const [list, suppressions, deliveryLog, topics, growth] = await Promise.all([
    listSubscribers(
      context.product.id,
      {
        search,
        status,
        source,
        page: Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1,
      },
      context.workspace.id,
    ),
    listSuppressions(context.workspace.id, search),
    getDeliveryLog(context.product.id, context.workspace.id, {
      search: logSearch,
      status: logStatus,
    }),
    listSubscriptionTopics(context.product.id),
    getSubscriberGrowth(context.product.id, 12),
  ]);

  return (
    <SubscribersView
      key={`${search}|${status}|${source}|${logSearch}|${logStatus}`}
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      timeZone="UTC"
      canWrite={hasPermission(context.role, "subscriber:write")}
      list={list}
      growth={growth}
      suppressions={suppressions}
      deliveryLog={deliveryLog}
      topics={topics}
      canSendTest={hasPermission(context.role, "settings:manage")}
      canRetry={hasPermission(context.role, "settings:manage")}
      defaultTestEmail={context.user.email}
      filters={{ search, status, source }}
      deliveryFilters={{ search: logSearch, status: logStatus }}
    />
  );
}
