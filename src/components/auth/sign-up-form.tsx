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
import { normalizeEmail } from "@/lib/email";
import { authClient } from "@/lib/auth-client";
import { userFacingErrorMessage } from "@/lib/error-message";

import { signUpSchema, type SignUpValues } from "./schemas";

type SignUpFormProps = {
  redirectTo: string;
};

export function SignUpForm({ redirectTo }: SignUpFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  // Set when sign-up created an unconfirmed account instead of a session.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const form = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "" },
    mode: "onSubmit",
  });

  const { isSubmitting } = form.formState;

  async function onSubmit(values: SignUpValues) {
    setServerError(null);
    setResent(false);
    const email = normalizeEmail(values.email);

    const { data, error } = await authClient.signUp.email({
      name: values.name.trim(),
      email,
      password: values.password,
      callbackURL: redirectTo,
    });

    if (error) {
      setServerError(
        userFacingErrorMessage(error, "Unable to create your account. Please try again."),
      );
      return;
    }

    // With verification required, sign-up returns `token: null`: the account
    // exists but no session is issued until the emailed link is opened.
    if (!data?.token) {
      setPendingEmail(email);
      return;
    }

    router.replace(redirectTo);
    router.refresh();
  }

  async function resendVerification() {
    if (!pendingEmail) return;
    setResending(true);
    const { error } = await authClient.sendVerificationEmail({
      email: pendingEmail,
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

  if (pendingEmail) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            Check {pendingEmail} for the confirmation link. It works once, expires in one
            hour, and signs you in when you open it.
          </AlertDescription>
        </Alert>
        {serverError ? (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={resending}
          onClick={() => void resendVerification()}
        >
          {resending
            ? "Sending…"
            : resent
              ? "Verification email sent"
              : "Resend verification email"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already confirmed?{" "}
          <Link
            href={`/sign-in${redirectTo === "/app" ? "" : `?redirect=${encodeURIComponent(redirectTo)}`}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    );
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

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input
                  autoComplete="name"
                  placeholder="Ada Lovelace"
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
                  autoComplete="new-password"
                  placeholder="At least 10 characters"
                  disabled={isSubmitting}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={`/sign-in${redirectTo === "/app" ? "" : `?redirect=${encodeURIComponent(redirectTo)}`}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </form>
    </Form>
  );
}