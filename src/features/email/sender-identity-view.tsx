"use client";

import { BadgeCheck, MailCheck, MailWarning } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/shared/settings-section";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  resendSenderVerificationAction,
  saveSenderIdentityAction,
} from "./actions";
import type { SenderIdentity } from "./identity";

export function SenderIdentityView({
  workspaceSlug,
  productSlug,
  identity,
  canManage,
}: {
  workspaceSlug: string;
  productSlug: string;
  identity: SenderIdentity;
  canManage: boolean;
}) {
  const router = useRouter();
  const [fromName, setFromName] = useState(identity.fromName);
  const [fromEmail, setFromEmail] = useState(identity.fromEmail);
  const [replyTo, setReplyTo] = useState(identity.replyTo ?? "");
  const [postalAddress, setPostalAddress] = useState(identity.postalAddress);
  const [pending, startTransition] = useTransition();

  function save(event: FormEvent): void {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveSenderIdentityAction({
        workspaceSlug,
        productSlug,
        fromName,
        fromEmail,
        replyTo: replyTo.trim() === "" ? undefined : replyTo,
        postalAddress,
      });
      if (!result.ok) {
        toast.error("Could not save the sender identity", { description: result.error });
        return;
      }
      if (result.data.verificationSentTo.length > 0) {
        toast.success("Verification email sent", {
          description: result.data.verificationSentTo.join(", "),
        });
      }
      if (result.data.verificationError) {
        toast.warning("Verification email not sent", {
          description: result.data.verificationError,
        });
      }
      router.refresh();
    });
  }

  function resend(purpose: "from" | "reply_to"): void {
    startTransition(async () => {
      const result = await resendSenderVerificationAction({
        workspaceSlug,
        productSlug,
        purpose,
      });
      if (!result.ok) {
        toast.error("Could not send the verification email", {
          description: result.error,
        });
        return;
      }
      toast.success("Verification email sent", { description: result.data.address });
    });
  }

  return (
    <SettingsSection
      id="sender-identity"
      icon={MailCheck}
      title="Sender identity"
      description="Who campaign and lifecycle email comes from. Campaigns also require a physical mailing address and include the recipient's unsubscribe link."
      badge={
        identity.configured ? (
          <StatusBadge tone="success">Configured</StatusBadge>
        ) : (
          <StatusBadge tone="warning">Needs setup</StatusBadge>
        )
      }
    >
      {!identity.configured ? (
        <p className="mb-4 rounded-lg border border-warning/40 bg-warning-muted px-3.5 py-3 text-xs leading-5 text-warning">
          {identity.fromEmail
            ? `Using the deployment fallback ${identity.fromEmail}. Save a workspace identity before approving a campaign.`
            : "No sender identity is configured for this workspace."}
        </p>
      ) : null}

      <form onSubmit={save} className="space-y-5">
        <div className="space-y-4 rounded-lg border border-border/80 bg-muted/20 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Sender details
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sender-name">From name</Label>
              <Input
                id="sender-name"
                value={fromName}
                onChange={(event) => setFromName(event.target.value)}
                maxLength={120}
                placeholder="Acme Product"
                disabled={!canManage || pending}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sender-email">From address</Label>
              <Input
                id="sender-email"
                type="email"
                value={fromEmail}
                onChange={(event) => setFromEmail(event.target.value)}
                maxLength={254}
                placeholder="updates@acme.com"
                disabled={!canManage || pending}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="sender-reply-to">Reply-to (optional)</Label>
            <Input
              id="sender-reply-to"
              type="email"
              value={replyTo}
              onChange={(event) => setReplyTo(event.target.value)}
              maxLength={254}
              placeholder="support@acme.com"
              disabled={!canManage || pending}
            />
            <p className="text-xs text-muted-foreground">
              Customer replies go here instead of the from address.
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Mailbox verification
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              {identity.fromVerifiedAt ? (
                <BadgeCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <MailWarning
                  className="mt-0.5 size-4 shrink-0 text-warning"
                  aria-hidden="true"
                />
              )}
              <div>
                <p className="text-sm font-medium text-foreground">From address</p>
                <p className="text-xs text-muted-foreground">
                  {identity.fromEmail || "Save an address first"}
                  {identity.fromVerifiedAt ? " — verified" : " — not verified"}
                </p>
              </div>
            </div>
            {identity.configured && !identity.fromVerifiedAt ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => resend("from")}
                disabled={!canManage || pending}
              >
                Send verification
              </Button>
            ) : null}
          </div>
          {identity.replyTo ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
              <div className="flex items-start gap-2.5">
                {identity.replyToVerifiedAt ? (
                  <BadgeCheck
                    className="mt-0.5 size-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                ) : (
                  <MailWarning
                    className="mt-0.5 size-4 shrink-0 text-warning"
                    aria-hidden="true"
                  />
                )}
                <div>
                  <p className="text-sm font-medium text-foreground">Reply-to address</p>
                  <p className="text-xs text-muted-foreground">
                    {identity.replyTo}
                    {identity.replyToVerifiedAt ? " — verified" : " — not verified"}
                  </p>
                </div>
              </div>
              {!identity.replyToVerifiedAt ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => resend("reply_to")}
                  disabled={!canManage || pending}
                >
                  Send verification
                </Button>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs leading-5 text-muted-foreground">
            Campaign and win-back sending stays blocked until the From address and any
            reply-to address have been verified. The link works once and expires after 24
            hours.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Compliance footer
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="sender-postal">Physical mailing address</Label>
            <Textarea
              id="sender-postal"
              value={postalAddress}
              onChange={(event) => setPostalAddress(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Acme Inc., 123 Main Street, Suite 4, Springfield, IL 62701"
              disabled={!canManage || pending}
            />
            <p className="text-xs text-muted-foreground">
              Included in the footer of campaign email. Required by anti-spam rules in many
              jurisdictions.
            </p>
          </div>
        </div>

        <div className="flex justify-end border-t border-border/70 pt-4">
          <Button type="submit" disabled={!canManage || pending}>
            {pending ? "Saving…" : "Save sender identity"}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}
