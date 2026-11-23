"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CUSTOM_ROLE_PERMISSIONS, type Permission } from "@/lib/permissions";

import {
  assignCustomRoleAction,
  createCustomRoleAction,
  createScimTokenAction,
  deleteCustomRoleAction,
  revokeScimTokenAction,
  saveSamlSettingsAction,
  setSsoEnforcementAction,
} from "./actions";
import type { EnterpriseIdentityView } from "./identity";

type Member = { userId: string; name: string; email: string; role: string };

export function EnterpriseSettings({
  workspaceSlug,
  identity,
  members,
  isOwner,
  ssoAllowed,
}: {
  workspaceSlug: string;
  identity: EnterpriseIdentityView;
  members: Member[];
  isOwner: boolean;
  ssoAllowed: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [issuer, setIssuer] = useState(identity.issuer ?? "");
  const [domain, setDomain] = useState(identity.domain ?? "");
  const [entryPoint, setEntryPoint] = useState("");
  const [certificate, setCertificate] = useState("");
  const [enabled, setEnabled] = useState(identity.samlEnabled);
  const [scimName, setScimName] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [rolePermissions, setRolePermissions] = useState<Permission[]>([]);
  const [assignMember, setAssignMember] = useState(members[0]?.userId ?? "");
  const [assignRole, setAssignRole] = useState("");

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setMessage({ ok: false, text: result.error ?? "Something went wrong." });
        return;
      }
      setMessage({ ok: true, text: success });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {message ? (
        <Alert variant={message.ok ? "default" : "destructive"}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}

      <Card id="enterprise">
        <CardHeader>
          <CardTitle>Enterprise sign-in (SAML)</CardTitle>
          <CardDescription>
            Members sign in through your identity provider. Password sign-in keeps working until
            enforcement is switched on, and enforcement can be turned off at any time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!ssoAllowed ? (
            <p className="text-sm text-muted-foreground">
              Enterprise sign-in is available on the Professional plan.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="saml-issuer">Issuer / entity ID</Label>
                  <Input
                    id="saml-issuer"
                    value={issuer}
                    onChange={(event) => setIssuer(event.target.value)}
                    placeholder="https://idp.example.com/metadata"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="saml-domain">Verified email domain</Label>
                  <Input
                    id="saml-domain"
                    value={domain}
                    onChange={(event) => setDomain(event.target.value)}
                    placeholder="company.com"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="saml-entry">Identity provider SSO URL</Label>
                  <Input
                    id="saml-entry"
                    value={entryPoint}
                    onChange={(event) => setEntryPoint(event.target.value)}
                    placeholder="https://idp.example.com/sso/saml"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="saml-cert">Signing certificate (PEM)</Label>
                  <textarea
                    id="saml-cert"
                    value={certificate}
                    onChange={(event) => setCertificate(event.target.value)}
                    rows={4}
                    className="w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs"
                    placeholder="-----BEGIN CERTIFICATE-----"
                  />
                </div>
              </div>
              <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <div>
                  <dt>ACS URL (give this to your IdP)</dt>
                  <dd className="break-all font-mono">{identity.acsUrl}</dd>
                </div>
                <div>
                  <dt>SP metadata</dt>
                  <dd className="break-all font-mono">{identity.metadataUrl}</dd>
                </div>
              </dl>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                Enable SAML sign-in for this workspace
              </label>
              <Button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () =>
                      saveSamlSettingsAction({
                        workspaceSlug,
                        issuer,
                        domain,
                        entryPoint,
                        certificate,
                        enabled,
                      }),
                    "SAML provider saved. Password sign-in still works until you enforce SSO.",
                  )
                }
              >
                Save SAML provider
              </Button>

              <div className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Enforce SSO</p>
                    <p className="text-xs text-muted-foreground">
                      Members without a linked identity-provider account are sent to sign-in.
                  </p>
                  </div>
                  <Button
                    type="button"
                    variant={identity.enforced ? "outline" : "default"}
                    disabled={pending || !isOwner || (!identity.samlEnabled && !identity.enforced)}
                    onClick={() =>
                      run(
                        () =>
                          setSsoEnforcementAction({
                            workspaceSlug,
                            enforced: !identity.enforced,
                          }),
                        identity.enforced
                          ? "Enforcement is off. Password sign-in works again."
                          : "SSO is enforced for this workspace.",
                      )
                    }
                  >
                    {identity.enforced ? "Turn enforcement off" : "Enforce SSO"}
                  </Button>
                </div>
                {!isOwner ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Only an owner can change enforcement.
                  </p>
                ) : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SCIM provisioning</CardTitle>
          <CardDescription>
            Give your directory a bearer token scoped to this workspace. Base URL:{" "}
            <code>/api/scim/v2/{workspaceSlug}</code>. Tokens are shown once and stored hashed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="scim-name">Token name</Label>
              <Input
                id="scim-name"
                value={scimName}
                onChange={(event) => setScimName(event.target.value)}
                placeholder="Okta production"
              />
            </div>
            <Button
              type="button"
              disabled={pending || scimName.trim().length === 0}
              onClick={() =>
                startTransition(async () => {
                  setMessage(null);
                  const result = await createScimTokenAction({ workspaceSlug, name: scimName });
                  if (!result.ok) {
                    setMessage({ ok: false, text: result.error });
                    return;
                  }
                  setIssuedToken(result.data.token);
                  setScimName("");
                  setMessage({ ok: true, text: "SCIM token created. Copy it now." });
                  router.refresh();
                })
              }
            >
              Create token
            </Button>
          </div>
          {issuedToken ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs">
              <p className="mb-1 font-medium">Copy this token now — it is not shown again.</p>
              <code className="break-all">{issuedToken}</code>
            </div>
          ) : null}
          {identity.scimTokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active SCIM tokens.</p>
          ) : (
            <ul className="divide-y text-sm">
              {identity.scimTokens.map((token) => (
                <li key={token.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    {token.name} · <code>{token.prefix}…</code>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => revokeScimTokenAction({ workspaceSlug, tokenId: token.id }),
                        "SCIM token revoked.",
                      )
                    }
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Custom admin roles</CardTitle>
          <CardDescription>
            A custom role adds permissions on top of a member’s base role. Ownership, workspace
            deletion and membership management stay owner-only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Role name</Label>
              <Input
                id="role-name"
                value={roleName}
                onChange={(event) => setRoleName(event.target.value)}
                placeholder="Support lead"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-description">Description</Label>
              <Input
                id="role-description"
                value={roleDescription}
                onChange={(event) => setRoleDescription(event.target.value)}
              />
            </div>
          </div>
          <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
            {CUSTOM_ROLE_PERMISSIONS.map((permission) => (
              <label key={permission} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={rolePermissions.includes(permission)}
                  onChange={(event) =>
                    setRolePermissions((current) =>
                      event.target.checked
                        ? [...current, permission]
                        : current.filter((item) => item !== permission),
                    )
                  }
                />
                {permission}
              </label>
            ))}
          </div>
          <Button
            type="button"
            disabled={pending || roleName.trim().length === 0 || rolePermissions.length === 0}
            onClick={() =>
              run(
                () =>
                  createCustomRoleAction({
                    workspaceSlug,
                    name: roleName,
                    description: roleDescription,
                    permissions: rolePermissions,
                  }),
                "Custom role created.",
              )
            }
          >
            Create custom role
          </Button>

          {identity.customRoles.length > 0 ? (
            <ul className="divide-y text-sm">
              {identity.customRoles.map((role) => (
                <li key={role.id} className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium">{role.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {role.permissions.join(", ")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => deleteCustomRoleAction({ workspaceSlug, roleId: role.id }),
                        "Custom role deleted.",
                      )
                    }
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          {identity.customRoles.length > 0 && members.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2 border-t pt-3">
              <div className="min-w-48 flex-1 space-y-1.5">
                <Label htmlFor="assign-member">Member</Label>
                <select
                  id="assign-member"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  value={assignMember}
                  onChange={(event) => setAssignMember(event.target.value)}
                >
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.name} ({member.role})
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-48 flex-1 space-y-1.5">
                <Label htmlFor="assign-role">Custom role</Label>
                <select
                  id="assign-role"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  value={assignRole}
                  onChange={(event) => setAssignRole(event.target.value)}
                >
                  <option value="">No custom role</option>
                  {identity.customRoles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(
                    () =>
                      assignCustomRoleAction({
                        workspaceSlug,
                        userId: assignMember,
                        customRoleId: assignRole || null,
                      }),
                    "Custom role assignment saved.",
                  )
                }
              >
                Assign
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
