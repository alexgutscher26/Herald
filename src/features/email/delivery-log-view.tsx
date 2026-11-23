"use client";

import { Mail, RefreshCw, RotateCcw, Search, Send } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import type {
  DeliveryLog,
  DeliveryLogRow,
  DeliveryStatus,
} from "@/db/queries/notifications";
import { retryDeliveryAction, sendTestEmailAction } from "@/features/email/actions";
import { formatDateTime } from "@/lib/format";

/**
 * Email operations in the dashboard.
 *
 * The delivery log is the outbox the jobs runner and the provider adapter write
 * to, shown without a second status model. Test sends use the real provider and
 * are intentionally not recorded here: they have no product content or
 * subscriber behind them.
 */

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: "Queued",
  sent: "Sent",
  failed: "Failed",
  bounced: "Bounced",
  complained: "Complaint",
  skipped: "Skipped",
};

const STATUS_TONES: Record<DeliveryStatus, StatusTone> = {
  pending: "warning",
  sent: "success",
  failed: "danger",
  bounced: "danger",
  complained: "danger",
  skipped: "neutral",
};

const TEMPLATE_LABELS: Record<DeliveryLogRow["template"], string> = {
  release_published: "Release update",
  winback_campaign: "Win-back campaign",
  feedback_status_changed: "Status change",
  feedback_reply: "Reply",
  conversation_reply: "Conversation reply",
  conversation_csat: "CSAT request",
  conversation_notification: "Conversation alert",
  conversation_away_reply: "Away reply",
  conversation_transcript: "Conversation transcript",
  weekly_digest: "Weekly digest",
  daily_digest: "Daily digest",
  outbound_message: "Outbound message",
};

function contentLabel(row: DeliveryLogRow): string {
  return (
    row.releaseTitle ??
    row.feedbackTitle ??
    row.campaignTitle ??
    TEMPLATE_LABELS[row.template]
  );
}

export function DeliveryLogView({
  workspaceSlug,
  productSlug,
  timeZone,
  log,
  canSendTest,
  canRetry,
  defaultTestEmail,
  filters,
}: {
  workspaceSlug: string;
  productSlug: string;
  timeZone: string;
  log: DeliveryLog;
  canSendTest: boolean;
  canRetry: boolean;
  defaultTestEmail: string;
  filters: { search: string; status: DeliveryStatus | "all" };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(filters.search);
  const [status, setStatus] = useState<DeliveryStatus | "all">(filters.status);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testEmail, setTestEmail] = useState(defaultTestEmail);
  const [testCustomerMode, setTestCustomerMode] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  function applyFilters(event?: FormEvent): void {
    event?.preventDefault();
    const params = new URLSearchParams(window.location.search);
    if (search.trim()) params.set("logQ", search.trim());
    else params.delete("logQ");
    if (status === "all") params.delete("logStatus");
    else params.set("logStatus", status);
    params.delete("page");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function retry(row: DeliveryLogRow): void {
    setRetryingId(row.id);
    startTransition(async () => {
      const result = await retryDeliveryAction({
        workspaceSlug,
        productSlug,
        deliveryId: row.id,
      });
      setRetryingId(null);
      if (!result.ok) {
        toast.error("Could not retry delivery", { description: result.error });
        return;
      }
      toast.success("Delivery queued for retry", {
        description: `${row.recipientEmail} will be attempted again.`,
      });
      router.refresh();
    });
  }

  function openTest(): void {
    setTestError(null);
    setTestResult(null);
    setTestOpen(true);
  }

  function sendTest(event: FormEvent): void {
    event.preventDefault();
    setTestError(null);
    setTestResult(null);

    startTransition(async () => {
      const result = await sendTestEmailAction({
        workspaceSlug,
        productSlug,
        to: testEmail,
        mode: testCustomerMode ? "customer" : "test",
      });

      if (!result.ok) {
        setTestError(result.error);
        return;
      }

      const sentCount = result.data.recipients.length;
      setTestResult(
        sentCount === 1
          ? result.data.providerMessageId
            ? `Provider accepted the message (${result.data.providerMessageId}).`
            : "Provider accepted the message."
          : `Provider accepted ${sentCount} messages.`,
      );
      if (result.data.failures.length > 0) {
        setTestError(
          result.data.failures
            .map((failure) => `${failure.email}: ${failure.error}`)
            .join(" "),
        );
      }
      toast.success(sentCount === 1 ? "Test email sent" : "Test emails sent", {
        description: `Check ${result.data.recipients.join(", ")}.`,
      });
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Mail className="size-4" aria-hidden="true" />
            Email delivery
          </CardTitle>
          <CardDescription>
            Every notification email this product queued, including pending jobs, provider
            failures and suppressed addresses. Test sends are not recorded here.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => startTransition(() => router.refresh())}
          >
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
          {canSendTest ? (
            <Button type="button" size="sm" onClick={openTest}>
              <Send aria-hidden="true" />
              Send test email
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-56 flex-1 gap-1.5">
            <Label htmlFor="delivery-search" className="text-xs">
              Search deliveries
            </Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="delivery-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Recipient, message, error or provider id"
                maxLength={200}
                className="pl-8"
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="delivery-status" className="text-xs">
              Status
            </Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as DeliveryStatus | "all")}
            >
              <SelectTrigger id="delivery-status" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {(Object.keys(STATUS_LABELS) as DeliveryStatus[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" variant="outline" size="sm">
            Apply
          </Button>
        </form>

        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Delivery status counts"
        >
          {(Object.keys(STATUS_LABELS) as DeliveryStatus[]).map((status) => (
            <span
              key={status}
              className="rounded-md border bg-muted/30 px-2 py-1 text-xs text-muted-foreground"
            >
              {STATUS_LABELS[status]}{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {log.counts[status]}
              </span>
            </span>
          ))}
          <span className="rounded-md border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
            Total{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {log.unfilteredTotal}
            </span>
            {log.total !== log.unfilteredTotal ? (
              <span> · {log.total} matching</span>
            ) : null}
          </span>
        </div>

        {log.rows.length === 0 ? (
          <EmptyState
            compact
            icon={Mail}
            title={
              filters.search || filters.status !== "all"
                ? "No delivery matches these filters"
                : "No email has been queued yet"
            }
            description={
              filters.search || filters.status !== "all"
                ? "Try a different search or delivery status."
                : "Publishing a release or changing a request status with notifications on will start the log."
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[880px] text-left text-sm">
              <caption className="sr-only">
                The {log.rows.length} most recent email deliveries for this product
              </caption>
              <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Recipient
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Message
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Attempts
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    When
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Error
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {log.rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="px-3 py-2.5 font-medium text-foreground">
                      {row.recipientEmail}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-sm">{contentLabel(row)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {TEMPLATE_LABELS[row.template]}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge tone={STATUS_TONES[row.status]}>
                        {STATUS_LABELS[row.status]}
                      </StatusBadge>
                      {row.deferUntil ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Quiet until {formatDateTime(row.deferUntil, timeZone)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                      {row.attempts}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {formatDateTime(row.sentAt ?? row.createdAt, timeZone)}
                    </td>
                    <td className="max-w-56 px-3 py-2.5 text-xs text-destructive">
                      {row.error ? (
                        <span className="line-clamp-2 break-words">{row.error}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {canRetry &&
                      (row.status === "failed" ||
                        row.status === "bounced" ||
                        row.status === "complained" ||
                        row.status === "skipped") ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={pending || retryingId === row.id}
                          onClick={() => retry(row)}
                        >
                          <RotateCcw aria-hidden="true" />
                          {retryingId === row.id ? "Retrying…" : "Retry"}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {log.total > log.rows.length ? (
          <p className="text-xs text-muted-foreground">
            Showing the {log.rows.length} most recent of {log.total} matching deliveries. Older rows
            stay available to the jobs runner.
          </p>
        ) : null}

        <p className="text-xs leading-relaxed text-muted-foreground">
          Requires <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code>. Suppressed addresses
          are skipped before every send.
        </p>
      </CardContent>

      <Dialog
        open={testOpen}
        onOpenChange={(next) => {
          setTestOpen(next);
          if (next) {
            setTestError(null);
            setTestResult(null);
          }
        }}
      >
        <DialogContent>
          <form onSubmit={sendTest} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Send a test email</DialogTitle>
              <DialogDescription>
                Sends real messages through the configured provider, up to five addresses at a
                time. Suppressed addresses are rejected, and the send is not added to the
                delivery log.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-1.5">
              <Label htmlFor="test-email-recipient">Recipients</Label>
              <Input
                id="test-email-recipient"
                type="text"
                required
                autoFocus
                maxLength={2000}
                value={testEmail}
                onChange={(event) => setTestEmail(event.target.value)}
                placeholder="you@example.com, teammate@example.com"
                aria-invalid={Boolean(testError)}
                aria-describedby={testError ? "test-email-error" : undefined}
              />
              <p className="text-xs text-muted-foreground">
                Up to five addresses, separated by commas, semicolons or spaces.
              </p>
            </div>

            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                checked={testCustomerMode}
                onChange={(event) => setTestCustomerMode(event.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="block font-medium">Send to me as a customer</span>
                <span className="block text-xs text-muted-foreground">
                  Uses the configured sender identity and a sample changelog email. The subject and
                  footer say it is a sample, and no subscription is created.
                </span>
              </span>
            </label>

            {testError ? (
              <p id="test-email-error" role="alert" className="text-xs font-medium text-destructive">
                {testError}
              </p>
            ) : null}
            {testResult ? (
              <p aria-live="polite" className="text-xs font-medium text-success">
                {testResult}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTestOpen(false)}>
                {testResult ? "Close" : "Cancel"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending || defaultTestEmail.length === 0}
                onClick={() => setTestEmail(defaultTestEmail)}
              >
                Use my email
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Sending…" : testResult ? "Send again" : "Send test"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
