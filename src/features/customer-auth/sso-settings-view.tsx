"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { toastActionFailure } from "@/components/shared/action-toast";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SettingsSection } from "@/components/shared/settings-section";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import type { IdentitySettingsView } from "./identity-settings";
import {
  completeSsoSecretRotationAction,
  rotateSsoSecretAction,
  saveSsoSettingsAction,
} from "./settings-actions";

function formatDeadline(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Single sign-on configuration.
 *
 * A new secret is shown exactly once, after it is generated. Afterwards the
 * page only reports that one exists; losing it means rotating, which is the
 * safe failure mode for a signing key.
 */
export function SsoSettingsView({
  workspaceSlug,
  productSlug,
  settings,
  canManage,
  allowed,
}: {
  workspaceSlug: string;
  productSlug: string;
  settings: IdentitySettingsView;
  canManage: boolean;
  allowed: boolean;
}) {
  const router = useRouter();
  // A downgrade keeps the stored flag but drops the entitlement, so start from
  // the effective value and never send a paid feature back on save.
  const [enabled, setEnabled] = useState(allowed && settings.enabled);
  const [issuer, setIssuer] = useState(settings.issuer);
  const [audience, setAudience] = useState(settings.audience);
  const [requireSignedTokens, setRequireSignedTokens] = useState(
    settings.requireSignedTokens,
  );
  const [secret, setSecret] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [rotating, startRotate] = useTransition();
  const [finishing, startFinish] = useTransition();

  function save() {
    startSave(async () => {
      const result = await saveSsoSettingsAction({
        workspaceSlug,
        productSlug,
        enabled,
        issuer,
        audience,
        requireSignedTokens,
      });

      if (!result.ok) {
        toastActionFailure(result);
        return;
      }

      setEnabled(result.data.settings.enabled);
      setIssuer(result.data.settings.issuer);
      setAudience(result.data.settings.audience);
      setSecret(result.data.generatedSecret);
      if (result.data.generatedSecret) {
        toast.success("Single sign-on enabled. Copy the secret now.");
      }
      router.refresh();
    });
  }

  function rotate() {
    startRotate(async () => {
      const result = await rotateSsoSecretAction({ workspaceSlug, productSlug });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setSecret(result.data.secret);
      toast.success(
        "Signing secret rotated. The previous secret keeps working for 24 hours.",
      );
      router.refresh();
    });
  }

  function finishRotation() {
    startFinish(async () => {
      const result = await completeSsoSecretRotationAction({
        workspaceSlug,
        productSlug,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      toast.success("Rotation finished. The previous secret no longer verifies.");
      router.refresh();
    });
  }

  return (
    <SettingsSection
      id="identity"
      icon={ShieldCheck}
      title="Single sign-on for customers"
      description="Let your app sign a customer in on public pages and in the widget with a short-lived HS256 token. No password is created."
      badge={
        !allowed ? (
          <StatusBadge tone="warning">Professional plan</StatusBadge>
        ) : enabled ? (
          <StatusBadge tone="success">Enabled</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Off</StatusBadge>
        )
      }
    >
      <div className="space-y-5">
        {!allowed ? (
          <p className="rounded-lg border border-warning/40 bg-warning-muted px-3.5 py-3 text-sm leading-5 text-warning">
            Single sign-on is available on the{" "}
            <Link
              href={`/app/${workspaceSlug}/settings#billing`}
              className="font-medium underline underline-offset-2"
            >
              Professional plan
            </Link>
            .
          </p>
        ) : null}

        <div className="rounded-lg border border-border/80 bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Enable SSO</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Disabled means every signed identity token is refused.
              </p>
            </div>
            <Switch
              checked={allowed && enabled}
              onCheckedChange={setEnabled}
              disabled={!canManage || !allowed}
              aria-label="Enable single sign-on"
            />
          </div>

          <div className="mt-4 grid gap-4 border-t border-border/70 pt-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sso-issuer">Issuer (`iss`)</Label>
              <Input
                id="sso-issuer"
                value={issuer}
                onChange={(event) => setIssuer(event.target.value)}
                maxLength={120}
                disabled={!canManage || !allowed}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sso-audience">Audience (`aud`)</Label>
              <Input
                id="sso-audience"
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
                maxLength={120}
                disabled={!canManage || !allowed}
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-4 border-t border-border/70 pt-4">
            <div>
              <p className="text-sm font-medium text-foreground">
                Require signed tokens
              </p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                There is no unsigned identity path; this stays on.
              </p>
            </div>
            <Switch
              checked={requireSignedTokens}
              onCheckedChange={setRequireSignedTokens}
              disabled
              aria-label="Require signed tokens"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={save} disabled={!canManage || saving || !allowed}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
          <ConfirmDialog
            trigger={
              <Button
                type="button"
                variant="outline"
                disabled={!canManage || rotating || !allowed}
              >
                <KeyRound aria-hidden="true" />
                {rotating ? "Rotating…" : "Rotate signing secret"}
              </Button>
            }
            title="Rotate the signing secret?"
            description="New tokens must be signed with the new secret. The current secret keeps verifying for 24 hours, so an in-flight sign-in and your next deployment keep working; finish early to reject it immediately."
            confirmLabel="Rotate secret"
            onConfirm={rotate}
          />
          <span className="self-center text-xs text-muted-foreground">
            {settings.hasSecret
              ? "A signing secret is configured."
              : "No signing secret yet; enabling SSO generates one."}
          </span>
        </div>

        {settings.previousSecretExpiresAt ? (
          <div
            role="status"
            className="space-y-2 rounded-lg border border-warning/40 bg-warning-muted px-3.5 py-3"
          >
            <p className="text-sm font-medium text-warning">Rotation in progress</p>
            <p className="text-xs leading-5 text-warning">
              Tokens signed with the previous secret still verify until{" "}
              {formatDeadline(settings.previousSecretExpiresAt)}. Deploy the new secret now,
              or finish early to reject the old one immediately.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={finishRotation}
              disabled={!canManage || finishing || !allowed}
            >
              {finishing ? "Finishing…" : "Finish rotation now"}
            </Button>
          </div>
        ) : null}

        {secret ? (
          <div
            role="status"
            className="space-y-2 rounded-lg border border-warning/40 bg-warning-muted px-3.5 py-3"
          >
            <p className="text-sm font-medium text-warning">
              Copy this secret now — it will not be shown again.
            </p>
            <pre className="overflow-x-auto rounded-md border border-warning/30 bg-background px-3 py-2 text-xs text-foreground">
              {secret}
            </pre>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  .writeText(secret)
                  .then(() => toast.success("Secret copied."))
                  .catch(() => toast.error("Could not copy the secret."));
              }}
            >
              Copy secret
            </Button>
          </div>
        ) : null}

        <div className="space-y-2 rounded-lg border border-border/80 bg-muted/15 px-4 py-3.5 text-xs leading-5 text-muted-foreground">
          <p className="font-medium text-foreground">How your app signs in</p>
          <p>
            Sign an HS256 JWT with the secret above. Required claims: `sub` (stable customer
            id), `iss`, `aud`, `iat`, `exp`. The token may be at most one hour old, and a
            60-second clock skew is allowed. Optional claims: `email`, `name`, `picture`, and
            scalar `traits`.
          </p>
          <p>
            Send it from the widget to <code>POST /api/widget/identify</code> as JSON{" "}
            <code>{`{ "workspaceSlug": "${workspaceSlug}", "token": "…" }`}</code>. The
            response sets the customer session, so public pages on this origin are signed in
            automatically.
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}
