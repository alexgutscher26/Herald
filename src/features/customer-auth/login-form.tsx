"use client";

import { Mail } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage, sendJson } from "@/features/public/client";
import { usePublicI18n } from "@/features/public/i18n/provider";

/**
 * Magic-link request form.
 *
 * The success state is intentionally identical for known and unknown
 * addresses. If the deployment has no outbound email, the form says so instead
 * of appearing to send a message.
 */
export function LoginForm({
  workspaceSlug,
  productSlug,
  nextPath,
  emailConfigured,
}: {
  workspaceSlug: string;
  productSlug: string;
  nextPath: string;
  emailConfigured: boolean;
}) {
  const { t } = usePublicI18n();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError("");

    const result = await sendJson("/api/public/auth/magic-link", "POST", {
      workspaceSlug,
      productSlug,
      email,
      nextPath,
    });

    if (result.ok) {
      setSent(true);
    } else {
      setError(errorMessage(result, t("login.error")));
    }
    setPending(false);
  }

  if (!emailConfigured) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning-muted px-4 py-3 text-sm text-warning">
        <p className="font-medium">{t("login.notConfiguredTitle")}</p>
        <p className="mt-1 text-warning/90">{t("login.notConfiguredBody")}</p>
      </div>
    );
  }

  if (sent) {
    return (
      <div
        role="status"
        className="rounded-lg border border-success/30 bg-success-muted px-4 py-4 text-sm text-success"
      >
        <p className="font-medium">{t("login.checkInbox")}</p>
        <p className="mt-1">
          {t("login.sentBody", { email })}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => {
            setSent(false);
            setEmail("");
          }}
        >
          {t("login.differentAddress")}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="login-email">{t("common.email")}</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "login-error" : undefined}
        />
      </div>

      {error ? (
        <p id="login-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        <Mail aria-hidden="true" />
        {pending ? t("login.sending") : t("login.emailMe")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("login.noPassword")}</p>
    </form>
  );
}
