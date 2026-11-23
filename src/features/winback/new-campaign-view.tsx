"use client";

import { ArrowLeft, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createCampaignAction } from "./actions";
import type { WinbackAudienceCounts } from "./service";

export function NewCampaignView({
  workspaceSlug,
  productSlug,
  releases,
  segments,
  audience,
  allowed,
  senderProblem,
  initialName = "",
  initialReleaseId = "",
}: {
  workspaceSlug: string;
  productSlug: string;
  releases: { id: string; title: string; status: string }[];
  segments: { id: string; name: string }[];
  audience: WinbackAudienceCounts;
  allowed: boolean;
  senderProblem: string | null;
  initialName?: string;
  initialReleaseId?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState("");
  const [releaseId, setReleaseId] = useState(initialReleaseId);
  const [segmentId, setSegmentId] = useState("");
  const [messageB, setMessageB] = useState("");
  const [abTestPercent, setAbTestPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createCampaignAction({
        workspaceSlug,
        productSlug,
        name,
        description,
        releaseId: releaseId === "" ? null : releaseId,
        segmentId: segmentId === "" ? null : segmentId,
        messageB: abTestPercent > 0 ? messageB : null,
        abTestPercent,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Campaign saved as a draft", {
        description: "It still needs a separate approval before it can send.",
      });
      router.push(
        `/app/${workspaceSlug}/${productSlug}/winback/campaigns/${result.data.campaignId}`,
      );
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="New win-back campaign"
        description="Build the audience from cancelled, eligible customers and point them to the release that answers their reason."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/${workspaceSlug}/${productSlug}/winback`}>
              <ArrowLeft aria-hidden="true" />
              Back
            </Link>
          </Button>
        }
      />

      {!allowed ? (
        <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          Campaigns are not available on the current plan.
        </p>
      ) : null}

      {senderProblem ? (
        <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          {senderProblem}{" "}
          <Link className="underline underline-offset-2" href={`/app/${workspaceSlug}/${productSlug}/settings#sender-identity`}>
            Configure sender identity
          </Link>
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Campaign</CardTitle>
            <CardDescription>
              The name is internal. The message is the body customers receive.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-4">
              <div className="grid gap-1.5">
                <Label htmlFor="campaign-name">Campaign name</Label>
                <Input
                  id="campaign-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={160}
                  placeholder="The reporting fix is live"
                  disabled={!allowed || pending}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="campaign-release">Linked release (optional)</Label>
                <select
                  id="campaign-release"
                  value={releaseId}
                  onChange={(event) => setReleaseId(event.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  disabled={!allowed || pending}
                >
                  <option value="">No linked release</option>
                  {releases.map((release) => (
                    <option key={release.id} value={release.id}>
                      {release.title} ({release.status})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  The email links to this update. A draft or archived release cannot be sent.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="campaign-segment">Segment (optional)</Label>
                <select
                  id="campaign-segment"
                  value={segmentId}
                  onChange={(event) => setSegmentId(event.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  disabled={!allowed || pending}
                >
                  <option value="">All eligible cancelled customers</option>
                  {segments.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  A segment narrows the audience by traits, plan and activity. With one selected,
                  only matching cancelled customers are eligible.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="campaign-body">Message</Label>
                <Textarea
                  id="campaign-body"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={8}
                  maxLength={5000}
                  placeholder="Explain what changed, why it matters to them, and how to come back."
                  disabled={!allowed || pending}
                />
                <p className="text-xs text-muted-foreground">
                  This is the variant A message, and what everyone receives when no A/B test
                  is configured.
                </p>
              </div>

              <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="campaign-ab-percent">A/B test slice (%)</Label>
                  <Input
                    id="campaign-ab-percent"
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={abTestPercent}
                    onChange={(event) =>
                      setAbTestPercent(
                        Math.min(Math.max(Number(event.target.value) || 0, 0), 100),
                      )
                    }
                    disabled={!allowed || pending}
                  />
                  <p className="text-xs text-muted-foreground">
                    The share of eligible recipients included in the test, split evenly
                    between the two messages by a stable hash. Everyone outside the slice
                    receives variant A. Set 0 to turn the test off.
                  </p>
                </div>
                {abTestPercent > 0 ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="campaign-body-b">Variant B message</Label>
                    <Textarea
                      id="campaign-body-b"
                      value={messageB}
                      onChange={(event) => setMessageB(event.target.value)}
                      rows={6}
                      maxLength={5000}
                      placeholder="Write a different pitch for the test slice."
                      disabled={!allowed || pending}
                    />
                  </div>
                ) : null}
              </div>

              {error ? (
                <p role="alert" className="text-xs font-medium text-destructive">{error}</p>
              ) : null}

              <Button type="submit" disabled={!allowed || pending}>
                <Send aria-hidden="true" />
                {pending ? "Saving…" : "Save draft"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Saving does not send anything. Submit the draft for approval, then approve and
                send from the campaign page.
              </p>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estimated audience</CardTitle>
            <CardDescription>
              Cancelled customers who are eligible, reachable and not already contacted.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Eligible recipients</p>
              <p className="mt-1.5 [font-family:var(--font-archivo)] text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{audience.eligible}</p>
            </div>
            <Count label="No email" value={audience.no_email} />
            <Count label="Not eligible" value={audience.ineligible} />
            <Count label="Opted out of win-back" value={audience.winback_opted_out} />
            <Count label="Unsubscribed or suppressed" value={audience.unsubscribed} />
            <Count label="Already received a campaign" value={audience.already_received} />
            <Count label="Outside the selected segment" value={audience.segment_mismatch} />
            <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">
              This preview is before any selected segment. The campaign page shows the exact
              recipient count after saving. The final send re-checks suppression, opt-outs and
              the segment. A customer who changes their mind after this preview is excluded,
              not emailed.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
