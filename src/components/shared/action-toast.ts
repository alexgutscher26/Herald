"use client";

import { toast } from "sonner";

import type { ActionFailure } from "@/lib/action-result";

/**
 * The single toast adapter for server-action results.
 *
 * Every client caller should route an action result through this helper rather
 * than reading `result.error` itself, so a plan-limit failure always offers the
 * same upgrade action and successes use one pattern.
 *
 * Do not show a success toast for a change the page already shows. Use
 * `toastUndoable` for a reversible change instead: the toast is the Undo
 * affordance, not a second confirmation.
 */

export function toastActionFailure(
  result: Pick<ActionFailure, "error" | "billingUrl">,
): void {
  const billingUrl = result.billingUrl;
  toast.error(
    result.error,
    billingUrl
      ? {
          action: {
            label: "Plan",
            onClick: () => (location.href = billingUrl),
          },
        }
      : {},
  );
}

type UndoToastInput = {
  /** Past tense, e.g. `"Roadmap" archived`. */
  message: string;
  /** One sentence explaining what changed and how to reverse it. */
  description: string;
  onUndo: () => void;
  undoLabel?: string;
};

/**
 * The single pattern for a reversible destructive action: perform it, then
 * offer Undo in a toast. Workspace-level actions still use typed confirmation.
 */
export function toastUndoable({
  message,
  description,
  onUndo,
  undoLabel = "Undo",
}: UndoToastInput): void {
  toast(message, {
    description,
    duration: 8000,
    action: {
      label: undoLabel,
      onClick: onUndo,
    },
  });
}
