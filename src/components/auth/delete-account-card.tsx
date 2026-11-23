"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteAccountAction } from "@/features/account/actions";
import type { AccountDeletionBlocker } from "@/features/account/account-settings";

type DeleteAccountCardProps = {
  email: string;
  hasPassword: boolean;
  blockers: AccountDeletionBlocker[];
};

/**
 * Delete the signed-in account.
 *
 * The password is required and the final action uses the shared confirmation
 * dialog: typed confirmation is reserved for workspace-level changes. When the
 * account is the sole owner of a workspace the form is replaced by the reason it
 * is blocked, with a link to transfer ownership — workspace deletion is a
 * separate flow and is never triggered from here.
 */
export function DeleteAccountCard({
  email,
  hasPassword,
  blockers,
}: DeleteAccountCardProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const blocked = blockers.length > 0;
  const canSubmit = hasPassword && !blocked && password.length > 0 && !pending;

  function submit() {
    setError(null);
    startTransition(async () => {
      // The action keeps its literal guard; typing is no longer the UI pattern.
      const result = await deleteAccountAction({ password, confirmation: "DELETE" });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Account deleted");
      router.replace("/sign-in");
      router.refresh();
    });
  }

  if (blocked) {
    return (
      <div className="space-y-3">
        <Alert>
          <AlertDescription>
            You are the only owner of{" "}
            {blockers.map((blocker, index) => (
              <span key={blocker.workspaceId}>
                {index > 0 ? ", " : ""}
                <Link
                  href={`/app/${encodeURIComponent(blocker.slug)}/settings`}
                  className="font-medium underline underline-offset-4"
                >
                  {blocker.name}
                </Link>
              </span>
            ))}
            . Transfer ownership to a teammate (or delete the workspace) before
            deleting your account, so no workspace is left without an owner.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!hasPassword) {
    return (
      <Alert>
        <AlertDescription>
          {email} signs in through single sign-on, so there is no password to confirm
          here. Ask a workspace owner to remove you from the workspace instead.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="delete-account-password">Password</Label>
        <Input
          id="delete-account-password"
          type="password"
          autoComplete="current-password"
          placeholder="Confirm with your password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={pending}
        />
      </div>

      <ConfirmDialog
        trigger={
          <Button type="button" variant="destructive" disabled={!canSubmit}>
            {pending ? "Deleting…" : "Delete my account"}
          </Button>
        }
        title="Delete your account?"
        description={
          <>
            This permanently deletes {email} and signs you out. It cannot be undone from
            the app. Workspaces you own must be transferred first.
          </>
        }
        confirmLabel="Delete account"
        onConfirm={submit}
      />
    </div>
  );
}
