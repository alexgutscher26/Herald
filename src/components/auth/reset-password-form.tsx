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

import { resetPasswordSchema, type ResetPasswordValues } from "./account-schemas";

type ResetPasswordFormProps = {
  token: string;
};

type ResetResponse = {
  ok?: boolean;
  error?: string;
};

/**
 * Finish a reset with the emailed token.
 *
 * Posts to `/api/auth/password-reset`, which spends the token and then hands it
 * to Better Auth. The endpoint, not this form, decides whether the token is
 * still valid, so the answer is surfaced verbatim.
 */
export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
    mode: "onSubmit",
  });

  const { isSubmitting } = form.formState;

  async function onSubmit(values: ResetPasswordValues) {
    setServerError(null);

    let response: Response;
    try {
      response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password: values.password }),
      });
    } catch {
      setServerError("Could not reach the server. Check your connection and try again.");
      return;
    }

    const payload = (await response.json().catch(() => null)) as ResetResponse | null;
    if (!response.ok || !payload?.ok) {
      setServerError(
        payload?.error ?? "Could not change the password. Please try again.",
      );
      return;
    }

    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            Password changed. Every other session was signed out — sign in again with the
            new password.
          </AlertDescription>
        </Alert>
        <Button asChild className="w-full">
          <Link href="/sign-in">Sign in</Link>
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
            <AlertDescription>
              {serverError}{" "}
              <Link
                href="/forgot-password"
                className="font-medium underline underline-offset-4"
              >
                Request a new link
              </Link>
              .
            </AlertDescription>
          </Alert>
        ) : null}

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
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

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm new password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Repeat the new password"
                  disabled={isSubmitting}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Set password"}
        </Button>
      </form>
    </Form>
  );
}
