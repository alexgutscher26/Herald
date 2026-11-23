"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { user } from "@/db/schema/auth";
import type { ActionResult } from "@/features/live/action-result";
import { getAuth } from "@/lib/auth";
import { requireUser } from "@/lib/authz";
import { logEvent, serializeError } from "@/lib/logger";

import { assertSameOriginAction } from "@/features/live/action-origin";

import { listAccountDeletionBlockers } from "./account-settings";

/**
 * Delete the signed-in account.
 *
 * Better Auth owns the deletion (it verifies the password, removes the user and
 * its sessions) but not the workspace policy, so the ownership guard runs here
 * first and is re-checked at submit time to close the gap between rendering the
 * page and pressing the button.
 *
 * This is account deletion, not workspace deletion: workspaces the user owns
 * alone block it, and workspace data is never purged from this path.
 */

const deleteAccountSchema = z.object({
  password: z.string().min(1, "Enter your password.").max(200),
  confirmation: z.literal("DELETE", { message: "Confirm account deletion." }),
});

/**
 * Onboarding tips are account-level product mail, not workspace marketing.
 * The checkbox is the only thing this action reads; the user id comes from the
 * session, never from the form.
 */
export async function setOnboardingEmailsAction(formData: FormData): Promise<void> {
  await assertSameOriginAction();
  const current = await requireUser();
  const enabled = formData.get("onboardingEmails") === "on";

  await db
    .update(user)
    .set({ onboardingEmails: enabled, updatedAt: new Date() })
    .where(eq(user.id, current.id));

  revalidatePath("/app/account");
}

export async function deleteAccountAction(input: {
  password: string;
  confirmation: string;
}): Promise<ActionResult> {
  await assertSameOriginAction();
  const user = await requireUser();

  const parsed = deleteAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const blockers = await listAccountDeletionBlockers(user.id);
  if (blockers.length > 0) {
    const names = blockers.map((blocker) => blocker.name).join(", ");
    return {
      ok: false,
      error: `Transfer ownership of ${names} before deleting your account.`,
    };
  }

  try {
    await getAuth().api.deleteUser({
      body: { password: parsed.data.password },
      headers: await headers(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message.includes("Invalid password")) {
      return { ok: false, error: "That password is not correct." };
    }
    if (message.includes("Credential account not found")) {
      return {
        ok: false,
        error:
          "This account signs in with single sign-on, so it has no password to confirm.",
      };
    }
    if (message.includes("Session expired")) {
      return {
        ok: false,
        error: "For security, sign in again before deleting your account.",
      };
    }

    logEvent("error", "account.delete_failed", {
      userId: user.id,
      error: serializeError(error),
    });
    return { ok: false, error: "Could not delete the account. Please try again." };
  }

  logEvent("info", "account.deleted", { userId: user.id });
  return { ok: true };
}
