"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
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
import { authClient } from "@/lib/auth-client";
import { normalizeEmail } from "@/lib/email";

import { forgotPasswordSchema, type ForgotPasswordValues } from "./account-schemas";

/**
 * Ask for a reset link.
 *
 * The confirmation is deliberately identical whether or not the address has an
 * account — Better Auth answers the same way, and the form must not turn that
 * into an account directory.
 */
export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
    mode: "onSubmit",
  });

  const { isSubmitting } = form.formState;

  async function onSubmit(values: ForgotPasswordValues) {
    setServerError(null);
    const email = normalizeEmail(values.email);

    // A transport failure is reported the same way as success: the caller
    // cannot tell the difference, and the neutral copy is still true. Throttling
    // is the one answer the person must act on, so it is shown as an error.
    const result = await authClient
      .requestPasswordReset({ email, redirectTo: "/reset-password" })
      .catch(() => null);

    if (result?.error?.status === 429) {
      setServerError("Too many reset requests. Wait a few minutes and try again.");
      return;
    }

    setSentTo(email);
  }

  if (sentTo) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            If {sentTo} has an account, a reset link is on its way. It works once and
            expires in one hour.
          </AlertDescription>
        </Alert>
        <p className="text-sm text-muted-foreground">
          Nothing arrived? Check your spam folder, or{" "}
          <button
            type="button"
            className="font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => setSentTo(null)}
          >
            try another address
          </button>
          .
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/sign-in">Back to sign in</Link>
        </Button>
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

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Email me a reset link"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Remembered it?{" "}
          <Link
            href="/sign-in"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </form>
    </Form>
  );
}
