"use client";

import { MailCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
  eraseSubscriberAction,
  sendSubscriberConfirmationAction,
} from "@/features/subscribers/actions";

/**
 * Per-subscriber confirmation and erasure.
 *
 * Erasure is owner-only and asks the operator to type the address, so a
 * destructive privacy action cannot happen from a stray click.
 */
export function SubscriberDataControls({
  workspaceSlug,
  productSlug,
  subscriberId,
  email,
  pendingConfirmation,
  canWrite,
  canErase,
}: {
  workspaceSlug: string;
  productSlug: string;
  subscriberId: string;
  email: string;
  pendingConfirmation: boolean;
  canWrite: boolean;
  canErase: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [eraseOpen, setEraseOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");

  function resendConfirmation(): void {
    startTransition(async () => {
      const result = await sendSubscriberConfirmationAction({
        workspaceSlug,
        productSlug,
        subscriberId,
      });
      if (!result.ok) {
        toast.error("Could not send the confirmation", { description: result.error });
        return;
      }
      if (result.data.skipped) {
        toast.info(
          result.data.skipped === "already_confirmed"
            ? "This subscriber is already confirmed."
            : `No email sent (${result.data.skipped.replaceAll("_", " ")}).`,
        );
        return;
      }
      toast.success("Confirmation email sent", {
        description: `A fresh link was sent to ${email}.`,
      });
    });
  }

  function erase(): void {
    if (confirmEmail.trim().toLowerCase() !== email.toLowerCase()) {
      toast.error("Type the subscriber's email to confirm.");
      return;
    }
    startTransition(async () => {
      const result = await eraseSubscriberAction({ workspaceSlug, subscriberId });
      if (!result.ok) {
        toast.error("Could not erase that subscriber", { description: result.error });
        return;
      }
      toast.success("Subscriber erased", {
        description: result.data.customerErased
          ? "The subscriber and their linked customer record were deleted."
          : "The subscriber record was deleted.",
      });
      router.push(`/app/${workspaceSlug}/${productSlug}/subscribers`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {canWrite && pendingConfirmation ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={resendConfirmation}
        >
          <MailCheck aria-hidden="true" />
          {busy ? "Sending…" : "Send confirmation"}
        </Button>
      ) : null}

      {canErase ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">Erase this subscriber</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Deletes the address, preference link and a linked customer record, including their
            product events and sessions. This cannot be undone.
          </p>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="mt-3"
            onClick={() => {
              setConfirmEmail("");
              setEraseOpen(true);
            }}
          >
            <Trash2 aria-hidden="true" />
            Erase data
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Erasing a subscriber is an owner-only data-control action.
        </p>
      )}

      <Dialog open={eraseOpen} onOpenChange={setEraseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Erase {email}</DialogTitle>
            <DialogDescription>
              Type the address to confirm. The subscriber row and any linked public customer
              are deleted in one transaction, and the audit log records the erasure without
              storing the address.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="erase-subscriber-confirm">Email address</Label>
            <Input
              id="erase-subscriber-confirm"
              value={confirmEmail}
              onChange={(event) => setConfirmEmail(event.target.value)}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEraseOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={erase}>
              {busy ? "Erasing…" : "Erase permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
