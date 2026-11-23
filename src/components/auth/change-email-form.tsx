"use client";

import { zodResolver } from "@hookform/resolvers/zod";
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
import { userFacingErrorMessage } from "@/lib/error-message";

import { changeEmailSchema, type ChangeEmailValues } from "./account-schemas";

type ChangeEmailFormProps = {
  currentEmail: string;
};

/**
 * Start an email change.
 *
 * Better Auth runs this as two confirmations: the current inbox first, then the
 * new address. Nothing changes until both links are opened, so a stolen session
 * cannot silently move the account to an attacker's address.
 */
export function ChangeEmailForm({ currentEmail }: ChangeEmailFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const form = useForm<ChangeEmailValues>({
    resolver: zodResolver(changeEmailSchema),
    defaultValues: { email: "" },
    mode: "onSubmit",
  });

  const { isSubmitting } = form.formState;

  async function onSubmit(values: ChangeEmailValues) {
    setServerError(null);
    const email = normalizeEmail(values.email);

    const { error } = await authClient.changeEmail({
      newEmail: email,
      callbackURL: "/app/account",
    });

    if (error) {
      if (error.status === 429) {
        setServerError(
          "Too many change requests. Wait a few minutes and try again.",
        );
        return;
      }
      setServerError(
        userFacingErrorMessage(
          error,
          "Could not start the email change. Please try again.",
        ),
      );
      return;
    }

    setSentTo(email);
  }

  if (sentTo) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            We sent a confirmation to <span className="font-medium">{currentEmail}</span>.
            Open that link first, then the second link we send to{" "}
            <span className="font-medium">{sentTo}</span>. The address changes only
            after both are confirmed.
          </AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSentTo(null);
            form.reset();
          }}
        >
          Use a different address
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
              <FormLabel>New email address</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="new@company.com"
                  disabled={isSubmitting}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" variant="outline" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Send confirmation links"}
        </Button>
      </form>
    </Form>
  );
}
