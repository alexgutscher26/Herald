"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { errorMessage, sendJson } from "./client";
import { usePublicI18n } from "./i18n/provider";

/**
 * Attach an email to the current visitor.
 *
 * Used where the board does not accept guest participation. Two calls: start a
 * guest session for the workspace (idempotent), then identify it. The server
 * rotates the session token on identify, so the guest token does not survive.
 */
export function IdentifyForm({
  workspaceSlug,
  context = "participate",
}: {
  workspaceSlug: string;
  context?: "participate" | "submit";
}) {
  const router = useRouter();
  const { t } = usePublicI18n();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError("");

    const session = await sendJson("/api/public/session", "POST", {
      workspaceSlug,
    });

    if (!session.ok) {
      setError(errorMessage(session, t("identify.startError")));
      setPending(false);
      return;
    }

    const identified = await sendJson("/api/public/session/identify", "POST", {
      email,
      ...(name.trim() === "" ? {} : { name: name.trim() }),
    });

    if (!identified.ok) {
      setError(errorMessage(identified, t("identify.saveError")));
    } else {
      setEmail("");
      setName("");
      router.refresh();
    }

    setPending(false);
  }

  return (
    <form onSubmit={submit} className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">
        {context === "submit" ? t("identify.submitTitle") : t("identify.joinTitle")}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("identify.description")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="identify-email">{t("common.email")}</Label>
          <Input
            id="identify-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "identify-error" : undefined}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="identify-name">{t("common.nameOptional")}</Label>
          <Input
            id="identify-name"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("common.saving") : t("common.continue")}
        </Button>
        {error ? (
          <p id="identify-error" role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
