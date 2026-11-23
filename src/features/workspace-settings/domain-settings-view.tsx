"use client";

import { Globe2, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { toastActionFailure } from "@/components/shared/action-toast";

import { SettingsSectionHeader } from "@/components/shared/settings-section";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { DomainView } from "./domains";
import {
  checkDomainHealthAction,
  removeDomainAction,
  saveDomainAction,
  verifyDomainAction,
} from "./actions";

export function DomainSettingsView({
  workspaceSlug,
  productSlug,
  domain,
  canManage,
  allowed,
}: {
  workspaceSlug: string;
  productSlug: string | null;
  domain: DomainView | null;
  canManage: boolean;
  allowed: boolean;
}) {
  const [value, setValue] = useState(domain?.domain ?? "");
  const [current, setCurrent] = useState(domain);
  const [saving, startSave] = useTransition();
  const [verifying, startVerify] = useTransition();
  const [checking, startCheck] = useTransition();

  function save() {
    if (!productSlug) {
      toast.error("Create a product before adding a domain.");
      return;
    }
    startSave(async () => {
      const result = await saveDomainAction({ workspaceSlug, productSlug, domain: value });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setCurrent(result.data.domain);
    });
  }

  function verify() {
    startVerify(async () => {
      const result = await verifyDomainAction({ workspaceSlug });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setCurrent(result.data.domain);
    });
  }

  function checkHealth() {
    startCheck(async () => {
      const result = await checkDomainHealthAction({ workspaceSlug });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setCurrent(result.data.domain);
    });
  }

  return (
    <Card id="domain" className="scroll-mt-24">
      <CardContent className="space-y-5 p-5">
        <SettingsSectionHeader
          icon={Globe2}
          title="Custom domain"
          description="Point a hostname at this deployment and verify ownership with a DNS TXT record. The health check calls the public readiness endpoint over HTTPS."
          badge={
            current ? (
              current.status === "verified" ? (
                <StatusBadge tone="success">Verified</StatusBadge>
              ) : (
                <StatusBadge tone="warning">Pending DNS</StatusBadge>
              )
            ) : (
              <StatusBadge tone="neutral">Not configured</StatusBadge>
            )
          }
        />

        {!allowed ? (
          <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
            Custom domains are available on Indie and Professional plans.
          </p>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="custom-domain">Hostname</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="custom-domain"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="feedback.example.com"
              disabled={!canManage || saving || !allowed}
            />
            <Button type="button" onClick={save} disabled={!canManage || saving || !allowed}>
              {saving ? "Saving…" : "Save domain"}
            </Button>
          </div>
        </div>

        {current ? (
          <div className="space-y-4 border-t pt-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-medium text-foreground">DNS verification</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add a TXT record at <code className="break-all">{current.txtRecordName}</code> with
                this value:
              </p>
              <pre className="mt-2 overflow-x-auto rounded border bg-background px-2 py-1.5 text-xs">
                {current.verificationToken}
              </pre>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Verification</p>
                <p className="font-medium">
                  {current.status === "verified" ? "Verified" : "Pending"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Health</p>
                <p className="font-medium capitalize">{current.healthStatus}</p>
                {current.healthMessage ? (
                  <p className="text-xs text-muted-foreground">{current.healthMessage}</p>
                ) : null}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Product</p>
                <p className="font-medium">{current.productName}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={verify}
                disabled={!canManage || verifying || !allowed}
              >
                <ShieldCheck aria-hidden="true" />
                {verifying ? "Verifying…" : "Verify DNS"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={checkHealth}
                disabled={!canManage || checking || !allowed || current.status !== "verified"}
              >
                {checking ? "Checking…" : "Check health"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  startSave(async () => {
                    const result = await removeDomainAction({ workspaceSlug });
                    if (!result.ok) {
                      toastActionFailure(result);
                      return;
                    }
                    setCurrent(null);
                    setValue("");
                  });
                }}
                disabled={!canManage || saving || !allowed}
              >
                Remove
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
