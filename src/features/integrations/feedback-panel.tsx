"use client";

import { ExternalLink, GitBranch, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  createIssueForFeedbackAction,
  getFeedbackIntegrationViewAction,
  linkExistingIssueAction,
} from "./actions";
import type { FeedbackIntegrationView } from "./issue-service";
import type { IssueProvider } from "./issue-providers";

function money(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 0,
  }).format(value / 100);
}

export function FeedbackIntegrationPanel({
  workspaceSlug,
  productSlug,
  postId,
  canWrite,
}: {
  workspaceSlug: string;
  productSlug: string;
  postId: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<FeedbackIntegrationView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const [linking, setLinking] = useState<IssueProvider | null>(null);
  const [linkId, setLinkId] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const load = useCallback(async () => {
    const result = await getFeedbackIntegrationViewAction({
      workspaceSlug,
      productSlug,
      postId,
    });
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setLoadError(null);
    setView(result.data);
  }, [postId, productSlug, workspaceSlug]);

  useEffect(() => {
    let cancelled = false;
    getFeedbackIntegrationViewAction({ workspaceSlug, productSlug, postId })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setLoadError(result.error);
          return;
        }
        setLoadError(null);
        setView(result.data);
      })
      .catch(() => {
        if (!cancelled) setLoadError("The tracker data could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [postId, productSlug, workspaceSlug]);

  function create(provider: IssueProvider) {
    startBusy(async () => {
      const result = await createIssueForFeedbackAction({
        workspaceSlug,
        productSlug,
        postId,
        provider,
      });
      if (!result.ok) {
        toast.error("Could not create the issue", { description: result.error });
        await load();
        return;
      }
      toast.success(result.created ? "Issue created and linked" : "Issue already linked");
      await load();
      router.refresh();
    });
  }

  function link(provider: IssueProvider) {
    if (linkId.trim() === "") {
      toast.error("Enter the issue id or key.");
      return;
    }
    startBusy(async () => {
      const result = await linkExistingIssueAction({
        workspaceSlug,
        productSlug,
        postId,
        provider,
        externalId: linkId,
        externalUrl: linkUrl || undefined,
      });
      if (!result.ok) {
        toast.error("Could not link the issue", { description: result.error });
        return;
      }
      toast.success("Issue linked");
      setLinking(null);
      setLinkId("");
      setLinkUrl("");
      await load();
      router.refresh();
    });
  }

  if (loadError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
        Issue tracker data could not be loaded: {loadError}
      </div>
    );
  }
  if (!view) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        Loading linked issues and CRM snapshot…
      </div>
    );
  }

  const linkedProviders = new Set(view.links.map((link) => link.provider));
  const available = view.connections.filter(
    (connection) => !linkedProviders.has(connection.provider),
  );

  if (view.links.length === 0 && view.connections.length === 0 && !view.crm) return null;

  return (
    <Card className="border-dashed">
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <GitBranch className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs font-medium">Tracker and CRM</p>
        </div>

        {view.crm ? (
          <div className="rounded-md border bg-muted/30 p-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {view.crm.companyName} · {view.crm.provider === "hubspot" ? "HubSpot" : "Salesforce"}
              </span>
              <span className="text-muted-foreground">
                {view.crm.syncedAt
                  ? `Synced ${new Date(view.crm.syncedAt).toLocaleString()}`
                  : "Not synced"}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Contacts</dt>
                <dd className="font-medium">{view.crm.contactCount ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Open deals</dt>
                <dd className="font-medium">{view.crm.openDealCount ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Open value</dt>
                <dd className="font-medium">{money(view.crm.openDealValueCents)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Annual revenue</dt>
                <dd className="font-medium">{money(view.crm.annualRevenueCents)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Cached from the CRM by a background job; not editable here.
            </p>
          </div>
        ) : null}

        {view.links.length > 0 ? (
          <ul className="divide-y rounded-md border text-xs">
            {view.links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                <span className="min-w-0">
                  <span className="block font-medium">
                    {link.providerLabel}
                    {link.externalKey ? ` · ${link.externalKey}` : ""}
                  </span>
                  <span className="block text-muted-foreground">
                    {link.state === "linked"
                      ? link.externalStatus ?? "Linked"
                      : link.state === "failed"
                        ? link.lastError ?? "Creation failed"
                        : "Creating…"}
                  </span>
                </span>
                {link.externalUrl ? (
                  <a
                    href={link.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    Open <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {view.connections.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No issue tracker is connected. An admin can add one on{" "}
            <a
              className="font-medium text-primary hover:underline"
              href={`/app/${workspaceSlug}/${productSlug}/integrations`}
            >
              Integrations
            </a>
            .
          </p>
        ) : null}

        {canWrite && available.length > 0 ? (
          <div className="space-y-2 border-t pt-2">
            {available.map((connection) => (
              <div key={connection.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => create(connection.provider)}
                  >
                    {busy ? <RefreshCw className="size-3.5 animate-spin" /> : null}
                    Create {connection.providerLabel} issue
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setLinking(linking === connection.provider ? null : connection.provider)}
                  >
                    Link existing
                  </Button>
                </div>
                {linking === connection.provider ? (
                  <div className="grid gap-2 rounded-md border bg-muted/30 p-2.5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <div className="grid gap-1">
                      <Label htmlFor={`link-id-${connection.id}`} className="text-[11px]">
                        Issue id or key
                      </Label>
                      <Input
                        id={`link-id-${connection.id}`}
                        value={linkId}
                        onChange={(event) => setLinkId(event.target.value)}
                        maxLength={300}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`link-url-${connection.id}`} className="text-[11px]">
                        URL (optional)
                      </Label>
                      <Input
                        id={`link-url-${connection.id}`}
                        value={linkUrl}
                        onChange={(event) => setLinkUrl(event.target.value)}
                        maxLength={2_000}
                        type="url"
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => link(connection.provider)}
                    >
                      Link
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
