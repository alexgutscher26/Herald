import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata = {
  title: "Reset your password",
};

/**
 * Request a password-reset link.
 *
 * Reachable while signed out, and reachable while signed in too: someone who is
 * still signed in on a device they lost may need to reset from here.
 */
export default function ForgotPasswordPage() {
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-6 space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          Enter the address you sign in with and we will email you a single-use link.
        </p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
