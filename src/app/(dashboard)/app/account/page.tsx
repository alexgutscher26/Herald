import { eq } from "drizzle-orm";
import { Newspaper } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { user as userTable } from "@/db/schema/auth";
import { ChangeEmailForm } from "@/components/auth/change-email-form";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { DeleteAccountCard } from "@/components/auth/delete-account-card";
import { PageHeader } from "@/components/shared/page-header";
import {
  getAccountSecuritySummary,
  listAccountDeletionBlockers,
} from "@/features/account/account-settings";
import { setOnboardingEmailsAction } from "@/features/account/actions";
import { isAuthEmailConfigured } from "@/features/email/auth-mail";
import { requireUser } from "@/lib/authz";

export const metadata = {
  title: "Account settings",
};

/**
 * Account-level settings.
 *
 * Separate from workspace settings on purpose: workspace settings require
 * `settings:manage`, while every member must be able to manage their own
 * sign-in details, including viewers.
 */
export default async function AccountSettingsPage() {
  const user = await requireUser();

  const [security, blockers, preferences] = await Promise.all([
    getAccountSecuritySummary(user.id),
    listAccountDeletionBlockers(user.id),
    db
      .select({ onboardingEmails: userTable.onboardingEmails })
      .from(userTable)
      .where(eq(userTable.id, user.id))
      .limit(1),
  ]);
  const onboardingEmails = preferences[0]?.onboardingEmails ?? true;
  // An email change is two confirmation emails; without a provider neither can
  // be delivered, so the form is omitted rather than failing on submit.
  const canChangeEmail = isAuthEmailConfigured();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <Link href="/app" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded bg-primary text-primary-foreground"
          >
            <Newspaper className="size-3" />
          </span>
          Herald
        </Link>
        <Link href="/app" className="text-xs text-muted-foreground hover:text-foreground">
          Back to workspace
        </Link>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 space-y-6 px-4 py-10">
        <PageHeader
          title="Account settings"
          description="Your sign-in details. These follow your account across every workspace."
        />

        <section
          aria-labelledby="email-heading"
          className="rounded-lg border bg-card p-6 shadow-sm"
        >
          <h2 id="email-heading" className="text-sm font-semibold tracking-tight">
            Email address
          </h2>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">
            You sign in as <span className="font-medium text-foreground">{user.email}</span>.
          </p>
          {canChangeEmail ? (
            <ChangeEmailForm currentEmail={user.email} />
          ) : (
            <p className="text-xs text-muted-foreground">
              Changing your address needs confirmation emails, which this deployment
              cannot send. Ask an operator to enable outbound email.
            </p>
          )}
        </section>

        <section
          aria-labelledby="password-heading"
          className="rounded-lg border bg-card p-6 shadow-sm"
        >
          <h2 id="password-heading" className="text-sm font-semibold tracking-tight">
            Password
          </h2>
          {security.hasPassword ? (
            <>
              <p className="mb-4 mt-1 text-xs text-muted-foreground">
                Confirm your current password to set a new one. Saving signs out every
                other session; this browser stays signed in.
              </p>
              <ChangePasswordForm />
              <p className="mt-4 text-xs text-muted-foreground">
                Forgot the current password?{" "}
                <Link
                  href="/forgot-password"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  Reset it by email
                </Link>
                .
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              This account signs in with single sign-on, so it has no Herald password.
            </p>
          )}
        </section>

        <section
          id="email-preferences"
          aria-labelledby="email-preferences-heading"
          className="rounded-lg border bg-card p-6 shadow-sm"
        >
          <h2
            id="email-preferences-heading"
            className="text-sm font-semibold tracking-tight"
          >
            Onboarding emails
          </h2>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">
            Four short setup tips: welcome, your first board, your first release and the
            widget install. Turning this off does not affect verification, billing or
            product-update email.
          </p>
          <form action={setOnboardingEmailsAction} className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="onboardingEmails"
                defaultChecked={onboardingEmails}
                className="size-4 accent-[#1f6b45]"
              />
              Send me onboarding tips
            </label>
            <Button type="submit" variant="outline" size="sm">
              Save
            </Button>
          </form>
        </section>

        <section
          aria-labelledby="delete-heading"
          className="rounded-lg border border-destructive/40 bg-card p-6 shadow-sm"
        >
          <h2 id="delete-heading" className="text-sm font-semibold tracking-tight">
            Delete account
          </h2>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">
            Removes your sign-in, sessions and workspace memberships. Workspaces you
            own are not deleted — transfer ownership first, or they block the deletion.
            This cannot be undone.
          </p>
          <DeleteAccountCard
            email={user.email}
            hasPassword={security.hasPassword}
            blockers={blockers}
          />
        </section>
      </main>
    </div>
  );
}
