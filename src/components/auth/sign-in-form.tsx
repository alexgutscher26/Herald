"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { normalizeEmail } from "@/lib/email";
import { authClient } from "@/lib/auth-client";
import { userFacingErrorMessage } from "@/lib/error-message";

import { signInSchema, type SignInValues } from "./schemas";

type SignInFormProps = {
  redirectTo: string;
};

export function SignInForm({ redirectTo }: SignInFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [ssoEmail, setSsoEmail] = useState("");
  const [ssoPending, setSsoPending] = useState(false);
  // Set when the password was correct but the address has not been confirmed.
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
    mode: "onSubmit",
  });

  const { isSubmitting } = form.formState;

  async function onSubmit(values: SignInValues) {
    setServerError(null);
    setResent(false);
    const email = normalizeEmail(values.email);

    const { error } = await authClient.signIn.email({
      email,
      password: values.password,
    });

    if (error) {
      // The auth endpoints are throttled per address (see `AUTH_RATE_LIMIT_RULES`).
      if (error.status === 429) {
        setVerificationEmail(null);
        setServerError(
          "Too many sign-in attempts. Wait a few minutes and try again.",
        );
        return;
      }
      // Better Auth refuses a password sign-in for an unconfirmed address with
      // `EMAIL_NOT_VERIFIED`; offer the resend instead of a dead end.
      if ((error as { code?: string }).code === "EMAIL_NOT_VERIFIED") {
        setVerificationEmail(email);
        setServerError(
          "Confirm your email address before signing in. Check your inbox for the link.",
        );
        return;
      }
      setVerificationEmail(null);
      setServerError(
        userFacingErrorMessage(error, "Unable to sign in. Check your email and password and try again."),
      );
      return;
    }

    router.replace(redirectTo);
    router.refresh();
  }

  async function resendVerification() {
    if (!verificationEmail) return;
    setResending(true);
    const { error } = await authClient.sendVerificationEmail({
      email: verificationEmail,
      callbackURL: redirectTo,
    });
    setResending(false);
    if (error) {
      setServerError(
        userFacingErrorMessage(error, "Could not resend the verification email."),
      );
      return;
    }
    setResent(true);
  }

  async function onSsoSignIn() {
    setServerError(null);
    setSsoPending(true);
    const { data, error } = await authClient.signIn.sso({
      email: normalizeEmail(ssoEmail),
      callbackURL: redirectTo,
    });
    setSsoPending(false);
    if (error) {
      setServerError(
        userFacingErrorMessage(
          error,
          "No identity provider is configured for that email domain.",
        ),
      );
      return;
    }
    if (data?.url) window.location.assign(data.url);
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        className="space-y-4"
        aria-busy={isSubmitting}
      >
        {serverError ? (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        ) : null}

        {verificationEmail ? (
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">
              The link works once and expires in one hour.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              disabled={resending}
              onClick={() => void resendVerification()}
            >
              {resending
                ? "Sending…"
                : resent
                  ? "Verification email sent"
                  : "Resend verification email"}
            </Button>
          </div>
        ) : null}

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  disabled={isSubmitting}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  disabled={isSubmitting}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">or use your company SSO</span>
            <Separator className="flex-1" />
          </div>
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={ssoEmail}
            onChange={(event) => setSsoEmail(event.target.value)}
            disabled={ssoPending || isSubmitting}
            aria-label="Work email for single sign-on"
          />
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={ssoPending || isSubmitting || ssoEmail.trim().length === 0}
            onClick={onSsoSignIn}
          >
            {ssoPending ? "Redirecting…" : "Continue with SSO"}
          </Button>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          No account yet?{" "}
          <Link
            href={`/sign-up${redirectTo === "/app" ? "" : `?redirect=${encodeURIComponent(redirectTo)}`}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </p>
      </form>
    </Form>
  );
}