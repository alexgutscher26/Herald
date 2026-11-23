import Link from "next/link";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Choose a new password",
};

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string }>;
};

/**
 * Complete a password reset.
 *
 * The token arrives in the query string from the emailed link. It is never
 * rendered, logged or kept in state longer than the form needs it.
 */
export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token.trim() : "";

  if (token === "") {
    return (
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-4 space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">This link is incomplete</h1>
          <p className="text-sm text-muted-foreground">
            Open the reset link from your email again, or request a new one.
          </p>
        </div>
        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-6 space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">
          The link works once. Saving signs out every other session.
        </p>
      </div>
      <ResetPasswordForm token={token} />
    </div>
  );
}
