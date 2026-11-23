"use client";

import {
  CalendarClock,
  Lightbulb,
  MailPlus,
  Megaphone,
  Tags,
  Upload,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/shared/page-header";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dismissSuggestionAction } from "./actions";
import type {
  CancellationReasonPerformance,
  WinbackOpportunityList,
} from "./opportunities";
import type { WinbackOverview } from "./service";
import type { WinbackSuggestionView } from "./suggestions";
import { formatDate } from "@/lib/format";

const APPROVAL_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
};

const APPROVAL_TONES: Record<string, StatusTone> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "success",
  rejected: "danger",
};

const SEND_LABELS: Record<string, string> = {
  not_sent: "Not sent",
  sending: "Sending",
  paused: "Paused",
  sent: "Sent",
  partially_sent: "Partially sent",
  failed: "Failed",
};

const SEND_TONES: Record<string, StatusTone> = {
  not_sent: "neutral",
  sending: "warning",
  paused: "warning",
  sent: "success",
  partially_sent: "warning",
  failed: "danger",
};

const EXCLUSION_LABELS: Record<string, string> = {
  no_email: "No email address",
  ineligible: "Win-back not allowed",
  unsubscribed: "Unsubscribed or suppressed",
  winback_opted_out: "Opted out of win-back",
  already_received: "Already received a campaign",
  segment_mismatch: "Outside the selected segment",
  campaign_not_approved: "Campaign was not approved",
  campaign_stopped: "Campaign was stopped",
};

export function WinbackView({
  workspaceSlug,
  productSlug,
  overview,
  opportunities,
  reasons,
  suggestions,
  canManage,
  allowed,
  senderProblem,
}: {
  workspaceSlug: string;
  productSlug: string;
  overview: WinbackOverview;
  opportunities: WinbackOpportunityList;
  reasons: CancellationReasonPerformance;
  suggestions: WinbackSuggestionView[];
  canManage: boolean;
  allowed: boolean;
  senderProblem: string | null;
}) {
  const router = useRouter();
  const base = `/app/${workspaceSlug}/${productSlug}`;
  const [pending, setPending] = useState(false);
  const [dismissing, startDismiss] = useTransition();
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  function dismiss(id: string): void {
    setDismissingId(id);
    startDismiss(async () => {
      const result = await dismissSuggestionAction({
        workspaceSlug,
        productSlug,
        suggestionId: id,
      });
      setDismissingId(null);
      if (!result.ok) {
        toast.error("The suggestion was not dismissed", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  async function importCsv(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }

    const form = new FormData();
    form.set("file", file);
    setPending(true);
    try {
      const response = await fetch(
        `/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
          productSlug,
        )}/winback/import`,
        { method: "POST", body: form },
      );
      const payload = (await response.json().catch(() => null)) as
        | {
            import?: {
              total: number;
              created: number;
              updated: number;
              skipped: number;
              invalid: number;
            };
            error?: string;
          }
        | null;
      if (!response.ok || !payload?.import) {
        setError(payload?.error ?? "The import could not be completed.");
        return;
      }
      toast.success(`Imported ${payload.import.total} cancellation rows`, {
        description: `${payload.import.created} new customers · ${payload.import.updated} updated · ${payload.import.skipped} duplicate cancellations · ${payload.import.invalid} invalid rows skipped`,
      });
      setFile(null);
      setImportOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Win-back"
        description="Reach customers who cancelled after a release answers the reason they left."
        actions={
          <>
            {canManage ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload aria-hidden="true" />
                Import cancellations
              </Button>
            ) : null}
            {canManage ? (
              <Button asChild size="sm" disabled={!allowed}>
                <Link href={`${base}/winback/new`}>
                  <MailPlus aria-hidden="true" />
                  New campaign
                </Link>
              </Button>
            ) : null}
          </>
        }
        meta={
          <>
            <span>{overview.audience.cancelled} cancelled customers</span>
            <span aria-hidden="true">·</span>
            <span>{overview.audience.eligible} eligible to contact</span>
            <span aria-hidden="true">·</span>
            <span>{overview.reasons} cancellation reasons</span>
          </>
        }
      />

      {!allowed ? (
        <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          Win-back campaigns are not available on the current plan. Audience preview and
          reporting stay visible so you can see what the plan would unlock.
        </p>
      ) : null}

      {senderProblem ? (
        <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          {senderProblem}{" "}
          <Link className="underline underline-offset-2" href={`${base}/settings#sender-identity`}>
            Configure sender identity
          </Link>
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          label="Cancelled"
          value={overview.audience.cancelled}
          detail="Customers imported with a cancellation event"
        />
        <SummaryCard
          label="Matched"
          value={opportunities.matched}
          detail="Cancellation reason matches a published release"
        />
        <SummaryCard
          label="Eligible"
          value={overview.audience.eligible}
          detail="Cancelled, eligible, reachable and not already contacted"
        />
        <SummaryCard
          label="Excluded"
          value={overview.audience.excluded}
          detail="No address, ineligible, opted out, suppressed or already received"
        />
        <SummaryCard
          label="Returns"
          value={overview.campaigns.reduce((sum, campaign) => sum + campaign.returned, 0)}
          detail="Confirmed and inferred attribution across campaigns"
        />
      </div>

      {suggestions.length > 0 ? (
        <Card className="border-primary/30 bg-primary/[0.03]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="size-4" aria-hidden="true" />
              Suggested campaigns
            </CardTitle>
            <CardDescription>
              These appear automatically when a release linked to a cancellation reason is
              published. Nothing is created, approved or sent until you start a campaign.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {suggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {suggestion.releaseTitle}{" "}
                    <span className="font-normal text-muted-foreground">answers</span>{" "}
                    {suggestion.reasonLabel}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {suggestion.eligible === 0
                      ? "No eligible cancelled customers right now."
                      : `${suggestion.eligible} eligible cancelled customer${suggestion.eligible === 1 ? "" : "s"} can be contacted.`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {suggestion.campaignId ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`${base}/winback/campaigns/${suggestion.campaignId}`}>
                        Open campaign
                      </Link>
                    </Button>
                  ) : canManage ? (
                    <Button asChild size="sm" disabled={!allowed}>
                      <Link
                        href={`${base}/winback/new?releaseId=${suggestion.releaseId}&name=${encodeURIComponent(
                          `${suggestion.releaseTitle}: ${suggestion.reasonLabel}`,
                        )}`}
                      >
                        Create campaign
                      </Link>
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => dismiss(suggestion.id)}
                      disabled={dismissing && dismissingId === suggestion.id}
                    >
                      Dismiss
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="opportunities" className="space-y-2">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="opportunities">
            Opportunities
            <span className="rounded bg-muted px-1 text-[11px] tabular-nums text-muted-foreground">
              {opportunities.eligible}
            </span>
          </TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="reasons">Cancellation reasons</TabsTrigger>
        </TabsList>

        <TabsContent value="opportunities" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-4" aria-hidden="true" />
                Former customers a shipped release answers
              </CardTitle>
              <CardDescription>
                A match exists because the customer recorded a cancellation reason and a
                published release was explicitly linked to that same reason. There is no
                confidence score: the link is a decision someone made, not a guess.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {opportunities.items.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No reason-to-release matches yet"
                  description="Link a cancellation reason to a release in the release editor, then publish it. Matches appear here as soon as both records exist."
                  action={
                    <Button asChild variant="outline" size="sm">
                      <Link href={`${base}/releases`}>Open releases</Link>
                    </Button>
                  }
                />
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[880px] text-left text-sm">
                    <caption className="sr-only">
                      Former customers whose cancellation reason matches a shipped release
                    </caption>
                    <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">Customer</th>
                        <th scope="col" className="px-3 py-2 font-medium">Cancellation reason</th>
                        <th scope="col" className="px-3 py-2 font-medium">Cancelled</th>
                        <th scope="col" className="px-3 py-2 font-medium">Matched release</th>
                        <th scope="col" className="px-3 py-2 font-medium">Contact eligibility</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {opportunities.items.map((item) => (
                        <tr key={item.customerAccountId} className="align-top">
                          <td className="px-3 py-2.5">
                            <span className="font-medium">
                              {item.name ?? "Unnamed customer"}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {item.email ?? "No email address"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge tone="neutral">{item.reasonLabel}</StatusBadge>
                          </td>
                          <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">
                            {formatDate(item.cancelledAt, "UTC")}
                          </td>
                          <td className="px-3 py-2.5">
                            <ul className="space-y-1">
                              {item.releases.map((release) => (
                                <li key={release.id}>
                                  <Link
                                    href={`${base}/releases/${release.id}/edit`}
                                    className="text-xs font-medium text-foreground underline-offset-2 hover:underline"
                                  >
                                    {release.title}
                                  </Link>
                                  <span className="block text-[11px] text-muted-foreground">
                                    {release.publishedAt
                                      ? `Published ${formatDate(release.publishedAt, "UTC")}`
                                      : "Published"}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </td>
                          <td className="px-3 py-2.5">
                            {item.eligible ? (
                              <StatusBadge tone="success">Eligible</StatusBadge>
                            ) : (
                              <StatusBadge tone="warning">
                                {EXCLUSION_LABELS[item.exclusionReason ?? ""] ??
                                  "Not contactable"}
                              </StatusBadge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Eligibility is re-checked by the same audience rules the send step runs, so a
                customer listed as eligible here is accepted for the same reasons a campaign
                would accept them. Nothing is sent from this list.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="campaigns" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Megaphone className="size-4" aria-hidden="true" />
                Campaigns
              </CardTitle>
              <CardDescription>
                A draft becomes sendable only after a separate approval. Publishing a release
                never starts a campaign.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {overview.campaigns.length === 0 ? (
                <EmptyState
                  icon={Megaphone}
                  title="No win-back campaigns yet"
                  description="Import cancellations, then create a campaign that points back to the release that addresses their reason."
                />
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[820px] text-left text-sm">
                    <caption className="sr-only">Win-back campaigns</caption>
                    <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">Campaign</th>
                        <th scope="col" className="px-3 py-2 font-medium">Approval</th>
                        <th scope="col" className="px-3 py-2 font-medium">Sending</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Audience</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Sent</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Returns</th>
                        <th scope="col" className="px-3 py-2 font-medium">Release</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          <span className="sr-only">Open</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {overview.campaigns.map((campaign) => (
                        <tr key={campaign.id} className="align-top">
                          <td className="px-3 py-2.5">
                            <Link
                              className="font-medium text-foreground hover:underline"
                              href={`${base}/winback/campaigns/${campaign.id}`}
                            >
                              {campaign.name}
                            </Link>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {formatDate(campaign.createdAt, "UTC")}
                            </p>
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge tone={APPROVAL_TONES[campaign.approvalStatus] ?? "neutral"}>
                              {APPROVAL_LABELS[campaign.approvalStatus] ?? campaign.approvalStatus}
                            </StatusBadge>
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge tone={SEND_TONES[campaign.sendStatus] ?? "neutral"}>
                              {SEND_LABELS[campaign.sendStatus] ?? campaign.sendStatus}
                            </StatusBadge>
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                            {campaign.recipients - campaign.excluded} eligible
                            <span className="block text-muted-foreground">
                              {campaign.excluded} excluded
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums">{campaign.sent}</td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums">{campaign.returned}</td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">
                            {campaign.releaseTitle ?? "No linked release"}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Button asChild variant="ghost" size="sm">
                              <Link href={`${base}/winback/campaigns/${campaign.id}`}>Open</Link>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Excluded because</CardTitle>
              <CardDescription>
                Every cancelled customer is accounted for before approval. The send step re-checks
                these rules so a late opt-out or bounce still wins.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 text-xs">
              <Exclusion label="No email" value={overview.audience.no_email} />
              <Exclusion label="Not eligible" value={overview.audience.ineligible} />
              <Exclusion label="Opted out" value={overview.audience.winback_opted_out} />
              <Exclusion label="Unsubscribed or suppressed" value={overview.audience.unsubscribed} />
              <Exclusion label="Already received" value={overview.audience.already_received} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reasons">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tags className="size-4" aria-hidden="true" />
                Cancellation reasons
              </CardTitle>
              <CardDescription>
                Reasons come from the cancellation import, which creates a tag for each label it
                has not seen. Reason-to-release links are edited in the release editor. Returns
                count only emails that were actually sent, and &ldquo;inferred&rdquo; is not
                proof that the email caused the return.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {reasons.best ? (
                <p className="rounded-md border border-success/40 bg-success-muted px-3 py-2 text-sm text-success">
                  Best return rate: <strong>{reasons.best.label}</strong>{" "}
                  ({(reasons.best.returnRate * 100).toFixed(0)}% of {reasons.best.sent} sends).
                  Small samples can swing widely; treat this as a direction, not a verdict.
                </p>
              ) : null}

              {reasons.unmatched > 0 ? (
                <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
                  {reasons.unmatched === 1
                    ? "1 reason has cancellations but no published release linked to it."
                    : `${reasons.unmatched} reasons have cancellations but no published release linked to them.`}{" "}
                  Those customers cannot appear as opportunities until a release links the reason.
                </p>
              ) : null}

              {reasons.reasons.length === 0 ? (
                <EmptyState
                  icon={Tags}
                  title="No cancellation reasons"
                  description="Import a cancellations CSV with a reason column, or record reasons through the API. Tags appear here once they exist."
                />
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[960px] text-left text-sm">
                    <caption className="sr-only">Cancellation reasons and their release links</caption>
                    <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">Reason</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Cancellations</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Sent</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Returns</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Return rate</th>
                        <th scope="col" className="px-3 py-2 font-medium">Published releases linked</th>
                        <th scope="col" className="px-3 py-2 font-medium">Coverage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {reasons.reasons.map((reason) => (
                        <tr key={reason.id} className="align-top">
                          <td className="px-3 py-2.5">
                            <span className="font-medium">{reason.label}</span>
                            {reason.description ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {reason.description}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                            {reason.cancellations}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                            {reason.sent}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                            {reason.returned}
                            {reason.confirmed > 0 ? (
                              <span className="block text-[10px] text-muted-foreground">
                                {reason.confirmed} confirmed
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                            {reason.returnRate === null
                              ? "—"
                              : `${(reason.returnRate * 100).toFixed(0)}%`}
                          </td>
                          <td className="px-3 py-2.5">
                            {reason.releases.length === 0 ? (
                              <span className="text-xs text-muted-foreground">None linked</span>
                            ) : (
                              <ul className="space-y-1">
                                {reason.releases.map((release) => (
                                  <li key={release.id}>
                                    <Link
                                      href={`${base}/releases/${release.id}/edit`}
                                      className="text-xs font-medium underline-offset-2 hover:underline"
                                    >
                                      {release.title}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {reason.releases.length > 0 ? (
                              <StatusBadge tone="success">Matched</StatusBadge>
                            ) : reason.cancellations > 0 ? (
                              <StatusBadge tone="warning">Unmatched</StatusBadge>
                            ) : (
                              <StatusBadge tone="neutral">No cancellations</StatusBadge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <CalendarClock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                A reason is only useful when it is specific enough to point at shipped work. Prefer
                “too expensive for a solo founder” over “other”.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <form onSubmit={(event) => void importCsv(event)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Import cancellations</DialogTitle>
              <DialogDescription>
                CSV with an <code>email</code> column. Optional columns: <code>name</code>,{" "}
                <code>external_id</code>, <code>cancelled_at</code>, <code>reason</code> and{" "}
                <code>feedback</code>. Up to 10,000 rows or 5 MB. Replaying a file does not
                duplicate a cancellation.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="winback-import-file">CSV file</Label>
              <Input
                id="winback-import-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "winback-import-error" : undefined}
              />
            </div>
            {error ? (
              <p id="winback-import-error" role="alert" className="text-xs font-medium text-destructive">{error}</p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !file}>
                {pending ? "Importing…" : "Import"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-[10px] border bg-card p-4 shadow-[0_1px_2px_rgba(23,22,20,0.04)]">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1.5 [font-family:var(--font-archivo)] text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{value.toLocaleString("en")}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

function Exclusion({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-md border bg-muted/30 px-2 py-1 text-muted-foreground">
      {label} <span className="font-semibold tabular-nums text-foreground">{value}</span>
    </span>
  );
}
