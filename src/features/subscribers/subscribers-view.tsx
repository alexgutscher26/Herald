"use client";

import {
  Ban,
  Download,
  Mail,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  UserPlus,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { ColumnResizer, ColumnSettings } from "@/components/shared/column-settings";
import { SearchInput } from "@/components/shared/search-input";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Toolbar, ToolbarGroup } from "@/components/shared/toolbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeliveryLogView } from "@/features/email/delivery-log-view";
import { SubscriberGrowthChart } from "@/features/subscribers/growth-chart";
import { TopicManager } from "@/features/subscribers/topic-manager";
import {
  addSubscriberAction,
  removeSuppressionsAction,
  setSubscriberStatusAction,
  suppressEmailAction,
  syncFollowersAction,
} from "@/features/subscribers/actions";
import type { DeliveryLog, DeliveryStatus } from "@/db/queries/notifications";
import type {
  SubscriberFilters,
  SubscriberGrowthWeek,
  SubscriberList,
  SubscriberRow,
  SubscriberSource,
  SubscriberStatus,
  SuppressionRow,
} from "@/db/queries/subscribers";
import { formatDate } from "@/lib/format";
import { useColumnLayout, type ColumnDefinition } from "@/lib/list-preferences";

const SUBSCRIBER_COLUMNS: ColumnDefinition[] = [
  {
    id: "subscriber",
    label: "Subscriber",
    defaultWidth: 260,
    minWidth: 200,
    defaultVisible: true,
    required: true,
  },
  { id: "status", label: "Status", defaultWidth: 110, minWidth: 90, defaultVisible: true },
  { id: "source", label: "Source", defaultWidth: 120, minWidth: 90, defaultVisible: true },
  {
    id: "preferences",
    label: "Preferences",
    defaultWidth: 220,
    minWidth: 150,
    defaultVisible: true,
  },
  { id: "added", label: "Added", defaultWidth: 120, minWidth: 100, defaultVisible: true },
];

type SuppressionReason = SuppressionRow["reason"];

const STATUS_LABELS: Record<SubscriberStatus, string> = {
  active: "Active",
  pending: "Pending",
  unsubscribed: "Unsubscribed",
};

const STATUS_TONES: Record<SubscriberStatus, StatusTone> = {
  active: "success",
  pending: "warning",
  unsubscribed: "neutral",
};

const SOURCE_LABELS: Record<string, string> = {
  widget: "Widget",
  import: "Import",
  api: "API",
  manual: "Manual",
  follower: "Follower",
};

const STATUS_OPTIONS: (SubscriberStatus | "all")[] = [
  "all",
  "active",
  "pending",
  "unsubscribed",
];

const SOURCE_OPTIONS: (SubscriberSource | "all")[] = [
  "all",
  "follower",
  "import",
  "manual",
  "widget",
  "api",
];

function buildQuery(
  base: SubscriberFilters & {
    search: string;
    status: SubscriberStatus | "all";
    source: SubscriberSource | "all";
  },
  page?: number,
  delivery?: { search: string; status: DeliveryStatus | "all" },
): string {
  const params = new URLSearchParams();
  if (base.search.trim() !== "") params.set("q", base.search.trim());
  if (base.status !== "all") params.set("status", base.status);
  if (base.source !== "all") params.set("source", base.source);
  if (delivery?.search.trim()) params.set("logQ", delivery.search.trim());
  if (delivery && delivery.status !== "all") params.set("logStatus", delivery.status);
  if (page && page > 1) params.set("page", String(page));
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

export function SubscribersView({
  workspaceSlug,
  productSlug,
  timeZone,
  canWrite,
  list,
  growth,
  suppressions,
  deliveryLog,
  topics,
  canSendTest,
  canRetry,
  defaultTestEmail,
  filters,
  deliveryFilters,
}: {
  workspaceSlug: string;
  productSlug: string;
  timeZone: string;
  canWrite: boolean;
  list: SubscriberList;
  growth: SubscriberGrowthWeek[];
  suppressions: SuppressionRow[];
  deliveryLog: DeliveryLog;
  topics: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    active: boolean;
    builtIn: boolean;
    tag: boolean;
  }[];
  canSendTest: boolean;
  canRetry: boolean;
  defaultTestEmail: string;
  deliveryFilters: { search: string; status: DeliveryStatus | "all" };
  filters: {
    search: string;
    status: SubscriberStatus | "all";
    source: SubscriberSource | "all";
  };
}) {
  const router = useRouter();
  const [search, setSearch] = useState(filters.search);
  const columns = useColumnLayout(`${workspaceSlug}/${productSlug}/subscribers`, SUBSCRIBER_COLUMNS);
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [suppressionEmail, setSuppressionEmail] = useState("");
  const [suppressionNote, setSuppressionNote] = useState("");
  const [suppressionReason, setSuppressionReason] = useState<SuppressionReason>("manual");
  const [suppressionError, setSuppressionError] = useState<string | null>(null);
  const [suppressionImportOpen, setSuppressionImportOpen] = useState(false);
  const [suppressionImportFile, setSuppressionImportFile] = useState<File | null>(null);
  const [suppressionImportError, setSuppressionImportError] = useState<string | null>(null);

  const basePath = `/app/${workspaceSlug}/${productSlug}/subscribers`;

  function pushFilters(next: Partial<typeof filters> & { page?: number }): void {
    const merged = { ...filters, search, ...next };
    const query = buildQuery(
      {
        search: merged.search,
        status: merged.status,
        source: merged.source,
      },
      next.page,
      deliveryFilters,
    );
    startTransition(() => router.push(`${basePath}${query}`));
  }

  function statusChange(row: SubscriberRow, status: SubscriberStatus): void {
    startTransition(async () => {
      const result = await setSubscriberStatusAction({
        workspaceSlug,
        productSlug,
        subscriberId: row.id,
        status,
      });
      if (!result.ok) {
        toast.error("Could not update that subscriber", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  function syncFollowers(): void {
    startTransition(async () => {
      const result = await syncFollowersAction({ workspaceSlug, productSlug });
      if (!result.ok) {
        toast.error("Could not sync followers", { description: result.error });
        return;
      }
      toast.success(
        `${result.data.created} added, ${result.data.linked} linked to existing addresses`,
        {
          description: `${result.data.followers} follower${
            result.data.followers === 1 ? "" : "s"
          } checked. Existing subscription choices were preserved.`,
        },
      );
      router.refresh();
    });
  }

  function handleAdd(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addSubscriberAction({
        workspaceSlug,
        productSlug,
        email,
        name: name.trim() === "" ? undefined : name,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.data.requiresConfirmation) {
        if (result.data.confirmationError) {
          toast.warning("Subscriber added, but the confirmation email failed", {
            description: result.data.confirmationError,
          });
        } else {
          toast.success("Confirmation email sent", {
            description: "They stay pending until they open the link.",
          });
        }
      }
      setEmail("");
      setName("");
      setAddOpen(false);
      router.refresh();
    });
  }

  async function handleImport(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!importFile) {
      setError("Choose a CSV file first.");
      return;
    }

    const form = new FormData();
    form.set("file", importFile);

    try {
      const response = await fetch(
        `/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
          productSlug,
        )}/subscribers/import`,
        { method: "POST", body: form },
      );
      const payload = (await response.json().catch(() => null)) as
        | {
            import?: { created: number; updated: number; invalid: number; total: number };
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.import) {
        setError(payload?.error ?? "The import could not be completed.");
        return;
      }

      toast.success(`Imported ${payload.import.total} subscriber rows`, {
        description: `${payload.import.created} new · ${payload.import.updated} updated${
          payload.import.invalid > 0
            ? ` · ${payload.import.invalid} invalid row${
                payload.import.invalid === 1 ? "" : "s"
              } skipped`
            : ""
        }`,
      });
      setImportFile(null);
      setImportOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
  }

  function suppress(event: FormEvent): void {
    event.preventDefault();
    setSuppressionError(null);
    startTransition(async () => {
      const result = await suppressEmailAction({
        workspaceSlug,
        productSlug,
        email: suppressionEmail,
        note: suppressionNote.trim() === "" ? undefined : suppressionNote,
        reason: suppressionReason,
      });
      if (!result.ok) {
        setSuppressionError(result.error);
        return;
      }
      setSuppressionEmail("");
      setSuppressionNote("");
      setSuppressionReason("manual");
      router.refresh();
    });
  }

  async function handleSuppressionImport(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSuppressionImportError(null);
    if (!suppressionImportFile) {
      setSuppressionImportError("Choose a CSV file first.");
      return;
    }

    const form = new FormData();
    form.set("file", suppressionImportFile);

    try {
      const response = await fetch(
        `/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
          productSlug,
        )}/subscribers/suppressions/import`,
        { method: "POST", body: form },
      );
      const payload = (await response.json().catch(() => null)) as
        | {
            import?: { imported: number; invalid: number; unknownReasons: number };
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.import) {
        setSuppressionImportError(payload?.error ?? "Could not import that file.");
        return;
      }

      toast.success(
        `${payload.import.imported} suppression${
          payload.import.imported === 1 ? "" : "s"
        } imported`,
        {
          description: [
            payload.import.invalid > 0
              ? `${payload.import.invalid} invalid row${
                  payload.import.invalid === 1 ? "" : "s"
                } skipped`
              : "",
            payload.import.unknownReasons > 0
              ? `${payload.import.unknownReasons} unknown reason${
                  payload.import.unknownReasons === 1 ? "" : "s"
                } imported as manual`
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
        },
      );
      setSuppressionImportFile(null);
      setSuppressionImportOpen(false);
      router.refresh();
    } catch {
      setSuppressionImportError(
        "Could not reach the server. Check your connection and try again.",
      );
    }
  }

  function removeSuppression(id: string): void {
    startTransition(async () => {
      const result = await removeSuppressionsAction({
        workspaceSlug,
        productSlug,
        ids: [id],
      });
      if (!result.ok) {
        toast.error("Could not remove that suppression", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  const hasFilters = filters.search !== "" || filters.status !== "all" || filters.source !== "all";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Subscribers"
        description="The audience for product updates, request status changes, replies and the weekly digest."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a
                href={`/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
                  productSlug,
                )}/subscribers/export`}
              >
                <Download aria-hidden="true" />
                Export CSV
              </a>
            </Button>
            {canWrite ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={syncFollowers}>
                  <RefreshCw aria-hidden="true" />
                  Sync followers
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                  <Upload aria-hidden="true" />
                  Import
                </Button>
                <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
                  <UserPlus aria-hidden="true" />
                  Add subscriber
                </Button>
              </>
            ) : null}
          </>
        }
        meta={
          <>
            <span>{list.counts.total} total</span>
            <span aria-hidden="true">·</span>
            <span>{list.counts.active} active</span>
            <span aria-hidden="true">·</span>
            <span>{list.counts.pending} pending</span>
            <span aria-hidden="true">·</span>
            <span>{list.counts.suppressed} suppressed address{list.counts.suppressed === 1 ? "" : "es"}</span>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Active" value={list.counts.active} detail="Receive product updates" />
        <SummaryCard
          label="Pending"
          value={list.counts.pending}
          detail="Followers who have not opted in to updates"
        />
        <SummaryCard
          label="Unsubscribed"
          value={list.counts.unsubscribed}
          detail="Kept so they are never re-added silently"
        />
        <SummaryCard
          label="Suppressed"
          value={list.counts.suppressed}
          detail="No email is sent to these addresses"
        />
      </div>

      <SubscriberGrowthChart weeks={growth} />

      <TopicManager
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        canWrite={canWrite}
        topics={topics}
      />

      <Toolbar>
        <ToolbarGroup>
          <form
            className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              pushFilters({ page: 1 });
            }}
          >
            <SearchInput
              inputId="subscriber-search"
              value={search}
              onChange={setSearch}
              placeholder="Search email or name…"
              label="Search subscribers"
              className="sm:w-72"
            />
            <Button type="submit" variant="outline" size="sm" disabled={pending}>
              Search
            </Button>
          </form>
          <Select
            value={filters.status}
            onValueChange={(value) => pushFilters({ status: value as SubscriberStatus | "all" })}
          >
            <SelectTrigger size="sm" className="w-36 bg-background" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((status) => (
                <SelectItem key={status} value={status}>
                  {status === "all" ? "All statuses" : STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.source}
            onValueChange={(value) => pushFilters({ source: value as SubscriberSource | "all" })}
          >
            <SelectTrigger size="sm" className="w-36 bg-background" aria-label="Filter by source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((source) => (
                <SelectItem key={source} value={source}>
                  {source === "all" ? "All sources" : SOURCE_LABELS[source] ?? source}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                startTransition(() => router.push(basePath));
              }}
            >
              Clear filters
            </Button>
          ) : null}
          <ColumnSettings
            columns={SUBSCRIBER_COLUMNS}
            isVisible={columns.isVisible}
            onToggle={columns.setVisible}
            onReset={columns.reset}
          />
        </ToolbarGroup>
        <p className="text-xs tabular-nums text-muted-foreground">
          {list.total} matching · page {list.page} of {list.totalPages}
        </p>
      </Toolbar>

      {list.rows.length === 0 ? (
        <EmptyState
          icon={Mail}
          title={hasFilters ? "No subscribers match" : "No subscribers yet"}
          description={
            hasFilters
              ? "Try a different search, status or source."
              : "Add an address, import a CSV, or sync the people already following requests."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[760px] table-fixed text-left text-sm">
            <colgroup>
              <col style={{ width: columns.widthOf("subscriber") }} />
              {columns.isVisible("status") ? (
                <col style={{ width: columns.widthOf("status") }} />
              ) : null}
              {columns.isVisible("source") ? (
                <col style={{ width: columns.widthOf("source") }} />
              ) : null}
              {columns.isVisible("preferences") ? (
                <col style={{ width: columns.widthOf("preferences") }} />
              ) : null}
              {columns.isVisible("added") ? (
                <col style={{ width: columns.widthOf("added") }} />
              ) : null}
              <col style={{ width: 170 }} />
            </colgroup>
            <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="relative px-3 py-2 font-medium">
                  Subscriber
                  <ColumnResizer
                    label="Subscriber"
                    width={columns.widthOf("subscriber")}
                    minWidth={200}
                    onChange={(width) => columns.setWidth("subscriber", width)}
                  />
                </th>
                {columns.isVisible("status") ? (
                  <th scope="col" className="relative px-3 py-2 font-medium">
                    Status
                    <ColumnResizer
                      label="Status"
                      width={columns.widthOf("status")}
                      minWidth={90}
                      onChange={(width) => columns.setWidth("status", width)}
                    />
                  </th>
                ) : null}
                {columns.isVisible("source") ? (
                  <th scope="col" className="relative px-3 py-2 font-medium">
                    Source
                    <ColumnResizer
                      label="Source"
                      width={columns.widthOf("source")}
                      minWidth={90}
                      onChange={(width) => columns.setWidth("source", width)}
                    />
                  </th>
                ) : null}
                {columns.isVisible("preferences") ? (
                  <th scope="col" className="relative px-3 py-2 font-medium">
                    Preferences
                    <ColumnResizer
                      label="Preferences"
                      width={columns.widthOf("preferences")}
                      minWidth={150}
                      onChange={(width) => columns.setWidth("preferences", width)}
                    />
                  </th>
                ) : null}
                {columns.isVisible("added") ? (
                  <th scope="col" className="relative px-3 py-2 font-medium">
                    Added
                    <ColumnResizer
                      label="Added"
                      width={columns.widthOf("added")}
                      minWidth={100}
                      onChange={(width) => columns.setWidth("added", width)}
                    />
                  </th>
                ) : null}
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.rows.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`${basePath}/${row.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {row.email}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {row.name ?? (row.customerId ? "Linked customer" : "No name")}
                    </p>
                  </td>
                  {columns.isVisible("status") ? (
                    <td className="px-3 py-2.5">
                      <StatusBadge tone={STATUS_TONES[row.status]}>
                        {STATUS_LABELS[row.status]}
                      </StatusBadge>
                    </td>
                  ) : null}
                  {columns.isVisible("source") ? (
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {SOURCE_LABELS[row.source] ?? row.source}
                    </td>
                  ) : null}
                  {columns.isVisible("preferences") ? (
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {row.status === "active" ? <PreferenceChip label="Updates" /> : null}
                        {row.notifyStatusChanges ? <PreferenceChip label="Status" /> : null}
                        {row.notifyReplies ? <PreferenceChip label="Replies" /> : null}
                        {row.digestFrequency === "daily" ? (
                          <PreferenceChip label="Daily digest" />
                        ) : row.weeklyDigest || row.digestFrequency === "weekly" ? (
                          <PreferenceChip label="Weekly digest" />
                        ) : null}
                        {row.status !== "active" &&
                        !row.notifyStatusChanges &&
                        !row.notifyReplies &&
                        !row.weeklyDigest &&
                        row.digestFrequency === "off" ? (
                          <span className="text-xs text-muted-foreground">None</span>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                  {columns.isVisible("added") ? (
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {formatDate(row.createdAt, timeZone)}
                    </td>
                  ) : null}
                  <td className="px-3 py-2.5">
                    {canWrite ? (
                      <div className="flex justify-end gap-1">
                        {row.status === "active" ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => statusChange(row, "unsubscribed")}
                          >
                            Unsubscribe
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => statusChange(row, "active")}
                          >
                            <RotateCcw aria-hidden="true" />
                            {row.status === "pending" ? "Activate" : "Resubscribe"}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            setSuppressionEmail(row.email);
                            setSuppressionError(null);
                            document.getElementById("suppression-email")?.focus();
                          }}
                          aria-label={`Suppress ${row.email}`}
                        >
                          <Ban aria-hidden="true" />
                        </Button>
                      </div>
                    ) : (
                      <span className="block text-right text-xs text-muted-foreground">Read only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.totalPages > 1 ? (
        <nav
          aria-label="Subscriber pagination"
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || list.page <= 1}
            onClick={() => pushFilters({ page: list.page - 1 })}
          >
            Previous
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            Page {list.page} of {list.totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || list.page >= list.totalPages}
            onClick={() => pushFilters({ page: list.page + 1 })}
          >
            Next
          </Button>
        </nav>
      ) : null}

      <DeliveryLogView
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        timeZone={timeZone}
        log={deliveryLog}
        canSendTest={canSendTest}
        canRetry={canRetry}
        defaultTestEmail={defaultTestEmail}
        filters={deliveryFilters}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4" aria-hidden="true" />
            Suppression list
          </CardTitle>
          <CardDescription>
            Suppressed addresses are skipped before every send, even if a row above is active.
            This list is workspace-wide.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {canWrite ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSuppressionImportError(null);
                  setSuppressionImportOpen(true);
                }}
              >
                <Upload aria-hidden="true" />
                Import CSV
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <a
                href={`/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
                  productSlug,
                )}/subscribers/suppressions/export`}
                download
              >
                <Download aria-hidden="true" />
                Export CSV
              </a>
            </Button>
          </div>

          {canWrite ? (
            <form onSubmit={suppress} className="flex flex-wrap items-end gap-2">
              <div className="grid min-w-56 flex-1 gap-1.5">
                <Label htmlFor="suppression-email" className="text-xs">
                  Email address
                </Label>
                <Input
                  id="suppression-email"
                  type="email"
                  required
                  value={suppressionEmail}
                  onChange={(event) => setSuppressionEmail(event.target.value)}
                  placeholder="Someone who should never be emailed"
                  aria-invalid={Boolean(suppressionError)}
                  aria-describedby={suppressionError ? "suppression-error" : undefined}
                />
              </div>
              <div className="grid w-40 gap-1.5">
                <Label htmlFor="suppression-reason" className="text-xs">
                  Reason
                </Label>
                <Select
                  value={suppressionReason}
                  onValueChange={(value) => setSuppressionReason(value as SuppressionReason)}
                >
                  <SelectTrigger id="suppression-reason">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="hard_bounce">Hard bounce</SelectItem>
                    <SelectItem value="complaint">Complaint</SelectItem>
                    <SelectItem value="unsubscribe">Unsubscribe</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid min-w-48 flex-1 gap-1.5">
                <Label htmlFor="suppression-note" className="text-xs">
                  Note (optional)
                </Label>
                <Input
                  id="suppression-note"
                  value={suppressionNote}
                  onChange={(event) => setSuppressionNote(event.target.value)}
                  placeholder="Why this address is suppressed"
                />
              </div>
              <Button type="submit" variant="outline" size="sm" disabled={pending}>
                Suppress
              </Button>
            </form>
          ) : null}
          {suppressionError ? (
            <p id="suppression-error" role="alert" className="text-xs font-medium text-destructive">
              {suppressionError}
            </p>
          ) : null}

          {suppressions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No suppressed addresses. Bounces, complaints and manual suppressions appear here.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {suppressions.map((suppression) => (
                <li
                  key={suppression.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{suppression.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {suppression.reason.replaceAll("_", " ")} ·{" "}
                      {formatDate(suppression.createdAt, timeZone)}
                      {suppression.note ? ` · ${suppression.note}` : ""}
                    </p>
                  </div>
                  {canWrite ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => removeSuppression(suppression.id)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <form onSubmit={handleAdd} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add a subscriber</DialogTitle>
              <DialogDescription>
                They immediately receive product updates. Status and reply notifications stay on
                unless they change them from the preference link in an email.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="new-subscriber-email">Email address</Label>
              <Input
                id="new-subscriber-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "subscriber-add-error" : undefined}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-subscriber-name">Name (optional)</Label>
              <Input
                id="new-subscriber-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
              />
            </div>
            {error ? (
              <p id="subscriber-add-error" role="alert" className="text-xs font-medium text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Adding…" : "Add subscriber"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={suppressionImportOpen} onOpenChange={setSuppressionImportOpen}>
        <DialogContent>
          <form onSubmit={(event) => void handleSuppressionImport(event)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Import suppressions</DialogTitle>
              <DialogDescription>
                CSV with an <code>email</code> column and optional <code>reason</code> and{" "}
                <code>note</code> columns. Reasons are <code>hard_bounce</code>,{" "}
                <code>complaint</code>, <code>manual</code> and <code>unsubscribe</code>. Up to
                10,000 rows or 5 MB. Re-importing an address updates its reason and note.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="suppression-import-file">CSV file</Label>
              <Input
                id="suppression-import-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) =>
                  setSuppressionImportFile(event.target.files?.[0] ?? null)
                }
                aria-invalid={Boolean(suppressionImportError)}
                aria-describedby={
                  suppressionImportError ? "suppression-import-error" : undefined
                }
              />
            </div>
            {suppressionImportError ? (
              <p id="suppression-import-error" role="alert" className="text-xs font-medium text-destructive">
                {suppressionImportError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSuppressionImportOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !suppressionImportFile}>
                {pending ? "Importing…" : "Import"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <form onSubmit={(event) => void handleImport(event)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Import subscribers</DialogTitle>
              <DialogDescription>
                CSV with an <code>email</code> column. Optional columns are <code>name</code>,{" "}
                <code>status</code> and <code>source</code>. Up to 10,000 rows or 5 MB.
                Existing unsubscribe tokens are preserved.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="subscriber-import-file">CSV file</Label>
              <Input
                id="subscriber-import-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "subscriber-import-error" : undefined}
              />
            </div>
            {error ? (
              <p id="subscriber-import-error" role="alert" className="text-xs font-medium text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !importFile}>
                {pending ? "Importing…" : "Import"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="rounded-[10px] border bg-card p-4 shadow-[0_1px_2px_rgba(23,22,20,0.04)]">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1.5 [font-family:var(--font-archivo)] text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{value.toLocaleString("en")}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

function PreferenceChip({ label }: { label: string }) {
  return (
    <span className="rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}
