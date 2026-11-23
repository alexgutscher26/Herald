"use client";

import { useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ConfirmDialogProps = {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  children?: ReactNode;
  /**
   * Use only for workspace-level actions. The person must type this exact
   * value before the confirm button enables. Reversible actions should use an
   * Undo toast instead of a dialog.
   */
  confirmText?: string;
};

/**
 * Confirmation for destructive or hard-to-reverse actions.
 *
 * Typed confirmation is reserved for workspace-level changes (deleting or
 * transferring a whole workspace). Everything else uses a normal confirmation,
 * and reversible changes use an Undo toast instead.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  children,
  confirmText,
}: ConfirmDialogProps) {
  const [value, setValue] = useState("");
  const confirmed = !confirmText || value === confirmText;

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) setValue("");
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {confirmText ? (
          <div className="space-y-2">
            <Label htmlFor="confirm-dialog-text">
              Type <span className="font-mono">{confirmText}</span> to confirm
            </Label>
            <Input
              id="confirm-dialog-text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={confirmText}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={!confirmed}
            onClick={(event) => {
              if (!confirmed) {
                event.preventDefault();
                return;
              }
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
