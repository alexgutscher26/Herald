"use client";

import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Check,
  Copy,
  CreditCard,
  Download,
  Globe2,
  History,
  KeyRound,
  Languages,
  LockKeyhole,
  MailCheck,
  Minus,
  ReceiptText,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SettingsSectionHeader } from "@/components/shared/settings-section";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { BillingView, PlanChangePreview } from "@/features/billing/service";
import {
  UsageMeters,
  type UsageMetersView,
} from "@/features/billing/usage-meters";
import { billingSettingsPath } from "@/features/billing/links";
import { toastActionFailure } from "@/features/billing/action-toast";
import {
  PLANS,
  PLAN_ORDER,
  planDisplayAmount,
  usageStatus,
  type PlanFeature,
  type PlanLimit,
} from "@/features/entitlements/plans";
import type { InvitationView, WorkspaceMemberView } from "./invitations";
import {
  changeMemberRoleAction,
  createApiTokenAction,
  inviteMemberAction,
  removeDomainClaimAction,
  removeMemberAction,
  resendInvitationAction,
  revokeApiTokenAction,
  revokeInvitationAction,
  rotateApiTokenAction,
  saveDomainClaimAction,
  setContentTranslationAction,
  setDoubleOptInAction,
  setIdentityMaskingAction,
  setPlannedForVisibilityAction,
  updateWorkspaceNameAction,
  verifyDomainClaimAction,
} from "./actions";
import type { DomainClaimView } from "./domain-claims";
import {
  changePlanAction,
  extendTrialAction,
  openBillingPortalAction,
  previewPlanChangeAction,
  recordBillingFeedbackAction,
  startCheckoutAction,
  startLifetimeCheckoutAction,
} from "@/features/billing/actions";
import {
  cancelWorkspaceDeletionAction,
  eraseCustomerDataAction,
  requestWorkspaceDeletionAction,
  transferOwnershipAction,
} from "@/features/data-controls/actions";
import { auditDetail } from "@/features/data-controls/audit-detail";
import { auditFilterQuery, type AuditFilters } from "@/features/data-controls/audit-filters";
import { CreateProductForm } from "@/features/products/create-product-form";
import { hasPermission } from "@/lib/permissions";
import { formatCurrency, formatNumber, now } from "@/lib/format";

export type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  revokedAt: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIpPrefix: string | null;
  lastUsedUserAgent: string | null;
};

type TokenScope = "read" | "write" | "feedback:read" | "support:read" | "admin";

const TOKEN_SCOPE_OPTIONS: Array<{
  scope: TokenScope;
  label: string;
  description: string;
}> = [
  { scope: "read", label: "Read everything", description: "Every GET endpoint." },
  { scope: "write", label: "Write", description: "Create and update resources." },
  {
    scope: "feedback:read",
    label: "Feedback read",
    description: "Boards, requests, tags and changelog reads only.",
  },
  {
    scope: "support:read",
    label: "Support read",
    description: "Companies and conversation reads only.",
  },
  {
    scope: "admin",
    label: "Admin",
    description: "Every current and future scope, including writes.",
  },
];

export type AuditRow = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  createdAt: string;
  metadata: Record<string, string | number | boolean | null> | null;
};

/** Paid seats and free viewers, as the plan counts them. */
export type SeatSummary = {
  paidUsed: number;
  paidLimit: number | null;
  viewers: number;
};

export type WorkspaceSettingsViewProps = {
  workspaceSlug: string;
  workspaceName: string;
  role: "owner" | "admin" | "editor" | "viewer";
  members: WorkspaceMemberView[];
  invitations: InvitationView[];
  tokens: TokenRow[];
  billing: BillingView;
  usageMeters: UsageMetersView;
  privacy: { maskCustomerIdentity: boolean; allowed: boolean };
  contentTranslationEnabled: boolean;
  doubleOptIn: boolean;
  /** Whether public request pages may show a planned quarter/date. */
  publicPlannedFor: boolean;
  plan: "free" | "starter" | "pro" | "lifetime";
  products: Array<{ slug: string; name: string }>;
  currentUserId: string;
  deletion: { purgeAfter: string; cancelledAt: string | null } | null;
  seats: SeatSummary;
  domainClaim: DomainClaimView | null;
  /** Owner-only administrative history; empty for admins and editors. */
  audit: AuditRow[];
  /** Active filters, echoed back into the table's form. */
  auditFilters: AuditFilters;
  /** The real pruning window, so the copy cannot drift from the job. */
  auditRetentionDays: number;
};

const SECTION_LINK =
  "inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

const AUDIT_ACTION_LABELS: Record<string, string> = {
  "workspace.name_updated": "Renamed the workspace",
  "member.invited": "Invited a teammate",
  "member.invitation_resent": "Resent an invitation",
  "member.invitation_revoked": "Revoked an invitation",
  "member.role_changed": "Changed a member role",
  "member.removed": "Removed a member",
  "api_token.created": "Created an API token",
  "api_token.rotated": "Rotated an API token",
  "api_token.revoked": "Revoked an API token",
  "privacy.identity_masking_changed": "Changed identity masking",
  "content.translation_changed": "Changed content translation",
  "workspace.planned_for_visibility_changed": "Changed planned-for visibility",
  "domain.saved": "Saved a custom domain",
  "domain.removed": "Removed a custom domain",
  "workspace.deletion_requested": "Requested workspace deletion",
  "workspace.deletion_cancelled": "Cancelled workspace deletion",
  "workspace.ownership_transferred": "Transferred ownership",
  "customer.data_erased": "Erased customer data",
  "workspace.purged": "Purged the workspace",
  "workspace.domain_claim_saved": "Claimed an email domain",
  "workspace.domain_claim_verified": "Verified an email domain",
  "workspace.domain_claim_removed": "Removed an email domain claim",
  "product.created": "Created a product",
  "billing.trial_extended": "Extended the trial",
  "billing.plan_change_requested": "Requested a plan change",
  "billing.feedback_recorded": "Recorded billing feedback",
};

const AUDIT_TARGET_LABELS: Record<string, string> = {
  workspace: "Workspace",
  member: "Member",
  invitation: "Invitation",
  api_token: "API token",
  customer: "Customer",
  domain_claim: "Email domain",
  product: "Product",
};

/** "in 3 days" for a pending invitation; urgent in its last two days. */
function invitationExpiry(expiresAt: string): { label: string; urgent: boolean } {
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return { label: "expired", urgent: true };
  if (days === 1) return { label: "expires in 1 day", urgent: true };
  return { label: `expires in ${days} days`, urgent: days <= 2 };
}

/** "in 3 days" for a retiring token; urgent in its final day. */
function tokenState(token: TokenRow): {
  label: string;
  tone: "neutral" | "warning" | "success";
  warning: string | null;
} {
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return {
      label: "Expired",
      tone: "neutral",
      warning: "This OAuth session expired — reconnect the client to issue a new token.",
    };
  }
  if (!token.revokedAt) return { label: "Active", tone: "success", warning: null };
  const at = new Date(token.revokedAt).getTime();
  if (at > Date.now()) {
    const hours = Math.max(1, Math.ceil((at - Date.now()) / 3_600_000));
    return {
      label: "Retiring",
      tone: "warning",
      warning: `Stops working in ${hours} hour${hours === 1 ? "" : "s"} — update the integration now.`,
    };
  }
  return { label: "Revoked", tone: "neutral", warning: null };
}

const PLAN_LIMIT_ROWS: Array<{ limit: PlanLimit; label: string }> = [
  { limit: "products", label: "Products" },
  { limit: "boardsPerProduct", label: "Boards per product" },
  { limit: "members", label: "Team members" },
  { limit: "monthlyEmails", label: "Emails per month" },
  { limit: "integrations", label: "Integrations" },
];

const PLAN_FEATURE_ROWS: Array<{ feature: PlanFeature; label: string }> = [
  { feature: "publicFeedback", label: "Public feedback boards" },
  { feature: "widget", label: "What’s New widget" },
  { feature: "api", label: "REST API and tokens" },
  { feature: "ai", label: "Juno AI replies" },
  { feature: "winback", label: "Win-back campaigns" },
  { feature: "guestPosting", label: "Guest posting" },
  { feature: "privateBoards", label: "Private boards" },
  { feature: "customBranding", label: "Custom branding" },
  { feature: "customDomains", label: "Custom domains" },
  { feature: "advancedSearch", label: "Advanced search" },
  { feature: "sso", label: "Single sign-on" },
  { feature: "identityMasking", label: "Identity masking" },
  { feature: "hideAttribution", label: "Hide “Powered by Herald”" },
];

function formatLimit(value: number | null): string {
  return value === null ? "Unlimited" : formatNumber(value);
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("en", { dateStyle: "medium" }) : "—";
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    // Clipboard access can be denied outside a secure context. Fall back to a
    // temporary selection so copying still works on a self-hosted HTTP origin.
  }

  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("The clipboard is unavailable.");
}

function TokenBadge({ token }: { token: TokenRow }) {
  const state = tokenState(token);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
      {state.warning ? <span className="text-xs text-warning">{state.warning}</span> : null}
    </span>
  );
}

export function WorkspaceSettingsView(props: WorkspaceSettingsViewProps) {
  const {
    workspaceSlug,
    workspaceName,
    role,
    members,
    invitations: initialInvitations,
    tokens: initialTokens,
    billing,
    usageMeters,
    privacy,
    contentTranslationEnabled,
    doubleOptIn: initialDoubleOptIn,
    publicPlannedFor,
    plan,
    products,
    currentUserId,
    deletion: initialDeletion,
    seats,
    domainClaim: initialDomainClaim,
    audit,
    auditFilters,
    auditRetentionDays,
  } = props;
  const isOwner = role === "owner";
  const productLimit = PLANS[plan].limits.products;
  const canCreateProduct = hasPermission(role, "product:create");
  const [name, setName] = useState(workspaceName);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [invitations, setInvitations] = useState(initialInvitations);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [tokens, setTokens] = useState(initialTokens);
  const [tokenName, setTokenName] = useState("");
  const [tokenScopes, setTokenScopes] = useState<TokenScope[]>(["read", "write"]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [maskIdentity, setMaskIdentity] = useState(privacy.maskCustomerIdentity);
  const [contentTranslation, setContentTranslation] = useState(contentTranslationEnabled);
  const [doubleOptIn, setDoubleOptIn] = useState(initialDoubleOptIn);
  const [plannedForVisible, setPlannedForVisible] = useState(publicPlannedFor);
  const [savingName, startSaveName] = useTransition();
  const [inviting, startInvite] = useTransition();
  const [tokenBusy, startToken] = useTransition();
  const [billingBusy, startBilling] = useTransition();
  const [previewBusy, startPreview] = useTransition();
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual">(
    billing.billingInterval,
  );
  const [planPreview, setPlanPreview] = useState<{
    plan: "starter" | "pro";
    preview: PlanChangePreview;
  } | null>(null);
  const [trialEndsAt, setTrialEndsAt] = useState(billing.trialEndsAt);
  const [churnReason, setChurnReason] = useState("too_expensive");
  const [churnKind, setChurnKind] = useState<"cancellation" | "refund">("cancellation");
  const [churnDetails, setChurnDetails] = useState("");
  const [churnConsent, setChurnConsent] = useState(true);
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const [privacyBusy, startPrivacy] = useTransition();
  const [dataBusy, startData] = useTransition();
  const [deletion, setDeletion] = useState(initialDeletion);
  const [deletionReason, setDeletionReason] = useState("");
  const [eraseEmail, setEraseEmail] = useState("");
  const [transferMemberId, setTransferMemberId] = useState("");
  const [transferConfirm, setTransferConfirm] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [claim, setClaim] = useState<DomainClaimView | null>(initialDomainClaim);
  const [claimDomain, setClaimDomain] = useState(initialDomainClaim?.domain ?? "");
  const [claimRole, setClaimRole] = useState<"editor" | "viewer">(
    initialDomainClaim?.role ?? "editor",
  );
  const [claimBusy, startClaim] = useTransition();

  function saveName() {
    startSaveName(async () => {
      const result = await updateWorkspaceNameAction({ workspaceSlug, name });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setName(result.data.name);
    });
  }

  function invite() {
    startInvite(async () => {
      const result = await inviteMemberAction({
        workspaceSlug,
        email: inviteEmail,
        role: inviteRole,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setInvitations((current) => [
        ...current.filter((item) => item.email !== result.data.invitation.email),
        result.data.invitation,
      ]);
      setInviteUrl(result.data.url);
      setInviteEmail("");
      toast.success(
        result.data.emailSent
          ? "Invitation sent."
          : "Invitation created. Copy the link and send it manually.",
      );
    });
  }

  function startLifetime() {
    startBilling(async () => {
      const result = await startLifetimeCheckoutAction({ workspaceSlug });
      if (!result.ok) toastActionFailure(result);
      else window.location.assign(result.data.url);
    });
  }

  function startPlan(selected: (typeof PLAN_ORDER)[number]) {
    if (selected !== "starter" && selected !== "pro") return;
    startBilling(async () => {
      const result = await startCheckoutAction({
        workspaceSlug,
        plan: selected,
        interval: billingInterval,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      window.location.assign(result.data.url);
    });
  }

  function previewPlan(selected: (typeof PLAN_ORDER)[number]) {
    if (selected !== "starter" && selected !== "pro") return;
    startPreview(async () => {
      const result = await previewPlanChangeAction({
        workspaceSlug,
        plan: selected,
        interval: billingInterval,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setPlanPreview({ plan: selected, preview: result.data.preview });
    });
  }

  function confirmPlanChange() {
    if (!planPreview) return;
    startPreview(async () => {
      const result = await changePlanAction({
        workspaceSlug,
        plan: planPreview.plan,
        interval: planPreview.preview.interval,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setPlanPreview(null);
      toast.success("Stripe is applying the plan change.");
    });
  }

  function extendTrial() {
    startBilling(async () => {
      const result = await extendTrialAction({ workspaceSlug, days: 7 });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setTrialEndsAt(result.data.trialEndsAt);
    });
  }

  function saveBillingFeedback() {
    startBilling(async () => {
      const result = await recordBillingFeedbackAction({
        workspaceSlug,
        kind: churnKind,
        reason: churnReason,
        details: churnDetails,
        contactConsent: churnConsent,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setFeedbackSaved(true);
    });
  }

  function openPortal() {
    startBilling(async () => {
      const result = await openBillingPortalAction({ workspaceSlug });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      window.location.assign(result.data.url);
    });
  }

  function toggleTokenScope(scope: TokenScope) {
    setTokenScopes((current) => {
      if (scope === "admin") {
        return current.includes("admin") ? ["read", "write"] : ["admin"];
      }
      const withoutAdmin = current.filter((item) => item !== "admin");
      return withoutAdmin.includes(scope)
        ? withoutAdmin.filter((item) => item !== scope)
        : [...withoutAdmin, scope];
    });
  }

  function copyToken(value: string) {
    void copyText(value)
      .then(() => toast.success("Token copied."))
      .catch(() => toast.error("Could not copy the token. Select it and copy manually."));
  }

  function createToken() {
    startToken(async () => {
      const result = await createApiTokenAction({
        workspaceSlug,
        name: tokenName,
        scopes: tokenScopes,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setTokens((current) => [result.data.apiToken, ...current]);
      setNewToken(result.data.token);
      setTokenName("");
      toast.success("Token created. Copy it now.");
    });
  }

  function rotateToken(token: TokenRow) {
    startToken(async () => {
      const result = await rotateApiTokenAction({
        workspaceSlug,
        tokenId: token.id,
        graceHours: 24,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setTokens((current) => [
        result.data.apiToken,
        ...current.map((item) =>
          item.id === token.id
            ? { ...item, revokedAt: result.data.previousRetiresAt }
            : item,
        ),
      ]);
      setNewToken(result.data.token);
      toast.success("Token rotated. Copy the replacement now; the old one works for 24 hours.");
    });
  }

  function savePrivacy(enabled: boolean) {
    startPrivacy(async () => {
      const result = await setIdentityMaskingAction({ workspaceSlug, enabled });
      if (!result.ok) {
        toastActionFailure(result);
        setMaskIdentity(!enabled);
        return;
      }
      setMaskIdentity(result.data.enabled);
    });
  }

  function saveContentTranslation(enabled: boolean) {
    startPrivacy(async () => {
      const result = await setContentTranslationAction({ workspaceSlug, enabled });
      if (!result.ok) {
        toastActionFailure(result);
        setContentTranslation(!enabled);
        return;
      }
      setContentTranslation(result.data.enabled);
    });
  }

  function saveDoubleOptIn(enabled: boolean) {
    startPrivacy(async () => {
      const result = await setDoubleOptInAction({ workspaceSlug, doubleOptIn: enabled });
      if (!result.ok) {
        toastActionFailure(result);
        setDoubleOptIn(!enabled);
        return;
      }
      setDoubleOptIn(result.data.doubleOptIn);
    });
  }

  function savePlannedForVisibility(enabled: boolean) {
    startPrivacy(async () => {
      const result = await setPlannedForVisibilityAction({
        workspaceSlug,
        publicPlannedFor: enabled,
      });
      if (!result.ok) {
        toastActionFailure(result);
        setPlannedForVisible(!enabled);
        return;
      }
      setPlannedForVisible(result.data.publicPlannedFor);
    });
  }

  function requestDeletion() {
    if (deleteConfirm.trim() !== workspaceName) {
      toast.error(`Type "${workspaceName}" to confirm the deletion.`);
      return;
    }
    startData(async () => {
      const result = await requestWorkspaceDeletionAction({
        workspaceSlug,
        reason: deletionReason,
        confirmName: deleteConfirm,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setDeletion({ purgeAfter: result.data.purgeAfter, cancelledAt: null });
      setDeletionReason("");
      setDeleteConfirm("");
    });
  }

  function cancelDeletion() {
    startData(async () => {
      const result = await cancelWorkspaceDeletionAction({ workspaceSlug });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setDeletion((current) =>
        current ? { ...current, cancelledAt: now().toISOString() } : current,
      );
    });
  }

  function eraseCustomer() {
    startData(async () => {
      const result = await eraseCustomerDataAction({
        workspaceSlug,
        email: eraseEmail,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setEraseEmail("");
      toast.success("Customer data erased.");
    });
  }

  function transferOwnership() {
    if (transferConfirm.trim() !== workspaceName) {
      toast.error(`Type "${workspaceName}" to confirm the transfer.`);
      return;
    }
    startData(async () => {
      const result = await transferOwnershipAction({
        workspaceSlug,
        memberId: transferMemberId,
        confirmName: transferConfirm,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setTransferConfirm("");
    });
  }

  function resend(invitation: InvitationView) {
    setResendingId(invitation.id);
    startInvite(async () => {
      const result = await resendInvitationAction({
        workspaceSlug,
        invitationId: invitation.id,
      });
      setResendingId(null);
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setInvitations((current) =>
        current.map((item) =>
          item.id === result.data.invitation.id ? result.data.invitation : item,
        ),
      );
      setInviteUrl(result.data.url);
      toast.success(
        result.data.emailSent
          ? "Invitation resent with a new link. The previous link no longer works."
          : "A new link was created. Copy it and send it manually.",
      );
    });
  }

  function saveClaim() {
    startClaim(async () => {
      const result = await saveDomainClaimAction({
        workspaceSlug,
        domain: claimDomain,
        role: claimRole,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setClaim(result.data.claim);
    });
  }

  function verifyClaim() {
    startClaim(async () => {
      const result = await verifyDomainClaimAction({ workspaceSlug });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setClaim(result.data.claim);
    });
  }

  function removeClaim() {
    startClaim(async () => {
      const result = await removeDomainClaimAction({ workspaceSlug });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setClaim(null);
      setClaimDomain("");
    });
  }

  const product = products[0];
  const paymentFailed = billing.status === "past_due" || billing.status === "unpaid";
  const hasPaidSubscription = ["active", "trialing", "past_due", "unpaid"].includes(
    billing.status,
  );
  const trialEndingSoon =
    billing.status === "trialing" &&
    billing.trialDaysLeft !== null &&
    billing.trialDaysLeft <= 3;
  const usageWarning = [
    { label: "Boards", meter: usageMeters.boards },
    { label: "Paid seats", meter: usageMeters.members },
    { label: "Integrations", meter: usageMeters.integrations },
    { label: "Emails", meter: usageMeters.emails },
    { label: "Survey impressions", meter: usageMeters.surveyImpressions },
  ].find((row) => usageStatus(row.meter.used, row.meter.limit).level !== "ok");

  return (
    <div className="space-y-6">
      <Card id="general" className="scroll-mt-24">
        <CardContent className="space-y-5 p-5">
          <SettingsSectionHeader
            icon={Settings2}
            title="General"
            description="The workspace name appears in the switcher and public emails. Only owners can change it."
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="w-full space-y-1.5">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input
                id="workspace-name"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                disabled={!isOwner || savingName}
              />
            </div>
            <Button type="button" onClick={saveName} disabled={!isOwner || savingName}>
              {savingName ? "Saving…" : "Save"}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-muted/20 p-3.5">
            <div className="flex items-start gap-2">
              <Languages className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">Serve translated content</p>
                <p className="text-xs text-muted-foreground">
                  Show the Spanish help articles and outbound messages operators have
                  entered. Customer-written text is never translated.
                </p>
              </div>
            </div>
            <Switch
              checked={contentTranslation}
              onCheckedChange={(enabled) => {
                setContentTranslation(enabled);
                saveContentTranslation(enabled);
              }}
              disabled={privacyBusy}
              aria-label="Serve translated help and outbound content"
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-muted/20 p-3.5">
            <div className="flex items-start gap-2">
              <MailCheck className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">Double opt-in</p>
                <p className="text-xs text-muted-foreground">
                  A subscriber added by the team stays pending until they open a
                  confirmation email. Imported addresses and explicit preference changes
                  keep their stated status.
                </p>
              </div>
            </div>
            <Switch
              checked={doubleOptIn}
              onCheckedChange={(enabled) => {
                setDoubleOptIn(enabled);
                saveDoubleOptIn(enabled);
              }}
              disabled={privacyBusy}
              aria-label="Require double opt-in for new subscribers"
            />
          </div>
        </CardContent>
      </Card>

      <Card id="team" className="scroll-mt-24">
        <CardContent className="space-y-5 p-5">
          <SettingsSectionHeader
            icon={Users}
            title="Team"
            description="Invite admins, editors and free view-only stakeholders by email. Invitations expire after seven days; resending issues a new link and retires the old one."
            badge={
              <StatusBadge
                tone={
                  seats.paidLimit !== null && seats.paidUsed >= seats.paidLimit
                    ? "warning"
                    : "neutral"
                }
              >
                {seats.paidUsed} of {seats.paidLimit ?? "unlimited"} paid seats ·{" "}
                {seats.viewers} free {seats.viewers === 1 ? "viewer" : "viewers"}
              </StatusBadge>
            }
          />

          <p className="-mt-2 text-xs text-muted-foreground">
            Owners, admins and editors take a paid seat on the {plan} plan. Viewers are
            free and never count against the limit.
          </p>

          <Link className={SECTION_LINK} href={`/app/${workspaceSlug}/settings/access`}>
            Who can do what
          </Link>

          <div className="overflow-x-auto rounded-lg border border-border/80">
            <table className="w-full min-w-[520px] text-sm [&_td]:px-3 [&_th]:px-3">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Member</th>
                  <th className="py-2 font-medium">Role</th>
                  <th className="py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className="border-b last:border-0">
                    <td className="py-3">
                      <p className="font-medium text-foreground">{member.name}</p>
                      <p className="text-xs text-muted-foreground">{member.email}</p>
                    </td>
                    <td className="py-3">
                      {isOwner && member.userId !== currentUserId ? (
                        <form
                          action={async (formData) => {
                            const result = await changeMemberRoleAction({
                              workspaceSlug,
                              memberId: member.id,
                              role: String(formData.get("role") ?? member.role),
                            });
                            if (!result.ok) toastActionFailure(result);
                          }}
                          className="flex items-center gap-2"
                        >
                          <select
                            name="role"
                            defaultValue={member.role}
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                          >
                            <option value="admin">Admin</option>
                            <option value="editor">Editor</option>
                            <option value="viewer">Viewer (free)</option>
                          </select>
                          <Button type="submit" size="sm" variant="outline">Save</Button>
                        </form>
                      ) : (
                        <span className="capitalize">{member.role}</span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      {isOwner && member.userId !== currentUserId ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            startInvite(async () => {
                              const result = await removeMemberAction({
                                workspaceSlug,
                                memberId: member.id,
                              });
                              if (!result.ok) toastActionFailure(result);
                            });
                          }}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isOwner ? (
            <div className="space-y-3 border-t pt-4">
              <p className="text-sm font-medium text-foreground">Invite a teammate</p>
              <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto] sm:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="teammate@company.com"
                    disabled={inviting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-role">Role</Label>
                  <select
                    id="invite-role"
                    value={inviteRole}
                    onChange={(event) =>
                      setInviteRole(event.target.value as "admin" | "editor" | "viewer")
                    }
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    disabled={inviting}
                  >
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer (free)</option>
                  </select>
                </div>
                <Button type="button" onClick={invite} disabled={inviting}>
                  {inviting ? "Inviting…" : "Send invite"}
                </Button>
              </div>
              {inviteUrl ? (
                <div className="rounded-md border border-warning/40 bg-warning-muted p-3 text-xs text-warning">
                  <p className="font-medium">Invitation link (copy now)</p>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">{inviteUrl}</pre>
                </div>
              ) : null}
              {invitations.length > 0 ? (
                <ul className="space-y-2">
                  {invitations.map((invitation) => {
                    const expiry = invitationExpiry(invitation.expiresAt);
                    return (
                      <li
                        key={invitation.id}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span>
                          {invitation.email}{" "}
                          <span className="text-xs text-muted-foreground">
                            · {invitation.role} ·{" "}
                            <span className={expiry.urgent ? "text-warning" : undefined}>
                              {expiry.label}
                            </span>{" "}
                            ({formatDate(invitation.expiresAt)})
                          </span>
                        </span>
                        <span className="flex shrink-0 gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => resend(invitation)}
                            disabled={inviting && resendingId === invitation.id}
                          >
                            {resendingId === invitation.id ? "Sending…" : "Resend"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              startInvite(async () => {
                                const result = await revokeInvitationAction({
                                  workspaceSlug,
                                  invitationId: invitation.id,
                                });
                                if (!result.ok) toastActionFailure(result);
                                else setInvitations((current) =>
                                  current.filter((item) => item.id !== invitation.id),
                                );
                              });
                            }}
                          >
                            Revoke
                          </Button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isOwner ? (
        <Card id="email-capture" className="scroll-mt-24">
          <CardContent className="space-y-5 p-5">
            <SettingsSectionHeader
              icon={Globe2}
              title="Domain capture"
              description="Claim a company domain so new accounts with that address join this workspace automatically. Only a verified claim joins anyone."
            />

            {claim ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-muted/20 p-3">
                  <div>
                    <p className="text-sm font-medium">@{claim.domain}</p>
                    <p className="text-xs text-muted-foreground">
                      New sign-ups join as{" "}
                      {claim.role === "viewer" ? "viewer (free)" : "editor"}
                      {claim.verifiedAt
                        ? ` · verified ${formatDate(claim.verifiedAt)}`
                        : " · not verified yet"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={claim.status === "verified" ? "success" : "warning"}>
                      {claim.status === "verified" ? "Verified" : "Pending"}
                    </StatusBadge>
                    {claim.status !== "verified" ? (
                      <Button type="button" size="sm" onClick={verifyClaim} disabled={claimBusy}>
                        {claimBusy ? "Checking…" : "Verify"}
                      </Button>
                    ) : null}
                    <ConfirmDialog
                      trigger={
                        <Button type="button" size="sm" variant="ghost" disabled={claimBusy}>
                          Remove
                        </Button>
                      }
                      title="Stop the automatic domain claim?"
                      description="New accounts from this domain will no longer join the workspace automatically. Existing members are unaffected."
                      confirmLabel="Remove claim"
                      onConfirm={removeClaim}
                    />
                  </div>
                </div>
                {claim.status !== "verified" ? (
                  <div className="rounded-md border border-warning/40 bg-warning-muted p-3 text-xs text-warning">
                    <p className="font-medium">Add this DNS TXT record, then verify</p>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">
                      {claim.txtRecordName} IN TXT &quot;{claim.verificationToken}&quot;
                    </pre>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    A new account with an @{claim.domain} address joins this workspace as{" "}
                    {claim.role === "viewer" ? "a free viewer" : "an editor"}. Existing
                    accounts are not moved, and a capture never grants ownership.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_170px_auto] sm:items-end">
                  <div className="space-y-1.5">
                    <Label htmlFor="claim-domain">Company domain</Label>
                    <Input
                      id="claim-domain"
                      value={claimDomain}
                      onChange={(event) => setClaimDomain(event.target.value)}
                      placeholder="acme.com"
                      disabled={claimBusy}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="claim-role">Join as</Label>
                    <select
                      id="claim-role"
                      value={claimRole}
                      onChange={(event) =>
                        setClaimRole(event.target.value as "editor" | "viewer")
                      }
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      disabled={claimBusy}
                    >
                      <option value="editor">Editor (paid seat)</option>
                      <option value="viewer">Viewer (free)</option>
                    </select>
                  </div>
                  <Button
                    type="button"
                    onClick={saveClaim}
                    disabled={claimBusy || claimDomain.trim().length < 3}
                  >
                    {claimBusy ? "Saving…" : "Claim domain"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  You get a DNS TXT challenge to prove you control the domain. Public
                  mailbox providers such as gmail.com cannot be claimed, and a capture
                  never grants ownership.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card id="billing" className="scroll-mt-24">
        <CardContent className="space-y-5 p-5">
          <SettingsSectionHeader
            icon={CreditCard}
            title="Billing"
            description={
              plan === "lifetime"
                ? "Founding Lifetime is paid once and does not renew. Limits apply immediately after Stripe confirms the payment."
                : "Plans change limits immediately after Stripe confirms the subscription."
            }
            badge={
              <StatusBadge tone={plan === "free" ? "neutral" : "success"}>
                {PLANS[plan].name}
              </StatusBadge>
            }
          />

          <div className="rounded-lg border border-border/80 bg-muted/20 px-3.5 py-3 text-sm">
            <span className="font-medium">Current: {PLANS[plan].name}</span>
            <span className="text-muted-foreground">
              {" "}· {billing.status}
              {trialEndsAt ? ` · trial ends ${formatDate(trialEndsAt)}` : ""}
              {billing.currentPeriodEnd ? ` · renews ${formatDate(billing.currentPeriodEnd)}` : ""}
              {plan === "lifetime" ? " · paid once, no renewal" : ""}
            </span>
          </div>

          <UsageMeters meters={usageMeters} billingUrl={billingSettingsPath(workspaceSlug)} />

          {usageWarning ? (
            <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-xs text-warning">
              {usageWarning.label} are close to the {plan === "free" ? "Free" : PLANS[plan].name}{" "}
              limit. Limits are checked before the next write; nothing is deleted when a cap is reached.
            </p>
          ) : null}

          {plan === "lifetime" ? (
            <div className="grid gap-3 rounded-lg border border-success/40 bg-success-muted/30 p-3.5 text-sm sm:grid-cols-2">
              <div>
                <p className="font-medium">Founding seat</p>
                <p className="text-muted-foreground">
                  {billing.lifetime
                    ? `Seat ${billing.lifetime.seatNumber} of 100 · bought ${formatDate(billing.lifetime.purchasedAt)}`
                    : "Active lifetime access"}
                </p>
              </div>
              <div>
                <p className="font-medium">Terms and receipt</p>
                <p className="text-muted-foreground">
                  {billing.lifetime
                    ? `${formatCurrency(billing.lifetime.amountCents, "usd")} once · no renewal`
                    : "No renewal"}
                  {" · "}
                  <a className="text-primary hover:underline" href="/legal/lifetime">
                    Lifetime terms
                  </a>
                  {billing.lifetime?.receiptUrl ? (
                    <>
                      {" · "}
                      <a
                        className="text-primary hover:underline"
                        href={billing.lifetime.receiptUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Receipt
                      </a>
                    </>
                  ) : null}
                </p>
              </div>
            </div>
          ) : null}

          {paymentFailed && plan !== "lifetime" ? (
            <div className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-2">
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-medium text-destructive">
                    The last payment did not go through.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Your data is safe — nothing has been deleted. Paid limits stay on during the
                    grace period{billing.graceEndsAt ? ` until ${formatDate(billing.graceEndsAt)}` : ""}.
                    After that the workspace moves to Free limits until Stripe confirms a payment.
                    Stripe retries automatically, and you can update the card now.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={openPortal}
                disabled={!isOwner || billingBusy}
              >
                Update payment method
              </Button>
            </div>
          ) : null}

          {trialEndingSoon && plan !== "lifetime" ? (
            <div className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
              <p className="font-medium">
                Your trial ends{" "}
                {billing.trialDaysLeft === 0
                  ? "today"
                  : `in ${billing.trialDaysLeft} day${billing.trialDaysLeft === 1 ? "" : "s"}`}
                .
              </p>
              <p className="mt-1 text-xs">
                Add a payment method to keep paid limits without interruption. The workspace owner
                also gets an email reminder. An owner can extend the trial below if you need more time.
              </p>
              {isOwner ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={extendTrial}
                  disabled={billingBusy}
                >
                  Extend trial by 7 days
                </Button>
              ) : null}
            </div>
          ) : null}

          {!billing.configured ? (
            <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
              Stripe is not configured on this deployment. Set the Stripe keys and prices to enable checkout.
            </p>
          ) : null}

          {planPreview ? (
            <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    Change to {PLANS[planPreview.plan].name}{" "}
                    {planPreview.preview.interval === "annual" ? "(annual)" : "(monthly)"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {planPreview.preview.total < 0
                      ? `Stripe will apply a ${formatCurrency(Math.abs(planPreview.preview.total), planPreview.preview.currency)} credit to the next invoice.`
                      : `Stripe will add ${formatCurrency(planPreview.preview.total, planPreview.preview.currency)} to the next invoice.`}{" "}
                    {planPreview.preview.nextPaymentAt
                      ? `Next charge ${formatDate(planPreview.preview.nextPaymentAt)}.`
                      : "The change takes effect immediately and is prorated."}
                  </p>
                </div>
                <StatusBadge tone="info">Preview only</StatusBadge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={confirmPlanChange} disabled={previewBusy}>
                  {previewBusy ? "Applying…" : "Confirm change"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPlanPreview(null)}
                  disabled={previewBusy}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {plan !== "lifetime" ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 bg-muted/20 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Billing period</p>
              <p className="text-xs text-muted-foreground">
                Annual prices are billed once a year; limits are identical.
              </p>
            </div>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant={billingInterval === "monthly" ? "default" : "outline"}
                onClick={() => setBillingInterval("monthly")}
                disabled={billingBusy || previewBusy}
              >
                Monthly
              </Button>
              <Button
                type="button"
                size="sm"
                variant={billingInterval === "annual" ? "default" : "outline"}
                onClick={() => setBillingInterval("annual")}
                disabled={!billing.annualConfigured || billingBusy || previewBusy}
              >
                {billing.annualConfigured ? "Annual" : "Annual not configured"}
              </Button>
            </div>
            {hasPaidSubscription &&
            (plan === "starter" || plan === "pro") &&
            billingInterval !== billing.billingInterval ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => previewPlan(plan)}
                disabled={!isOwner || billingBusy || previewBusy}
              >
                Preview {billingInterval} billing
              </Button>
            ) : null}
          </div>
          ) : null}

          {plan !== "lifetime" ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Plan comparison</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 font-medium">Feature</th>
                  {PLAN_ORDER.map((id) => (
                    <th key={id} scope="col" className="px-2 py-2 text-center font-medium">
                      <span className="block text-sm text-foreground">{PLANS[id].name}</span>
                      <span className="block font-normal tabular-nums text-muted-foreground">
                        {formatCurrency(
                          planDisplayAmount(
                            id,
                            billingInterval === "annual" ? "yearly" : "monthly",
                          ) * 100,
                          "usd",
                        )}
                        {id === "free" ? "" : billingInterval === "annual" ? " /mo billed yearly" : " /mo"}
                      </span>
                      {plan === id ? (
                        <span className="block font-normal text-primary">Current plan</span>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PLAN_LIMIT_ROWS.map((row) => (
                  <tr key={row.limit} className="border-b">
                    <th scope="row" className="py-2 text-left font-normal text-muted-foreground">
                      {row.label}
                    </th>
                    {PLAN_ORDER.map((id) => (
                      <td key={id} className="px-2 py-2 text-center tabular-nums">
                        {formatLimit(PLANS[id].limits[row.limit])}
                      </td>
                    ))}
                  </tr>
                ))}
                {PLAN_FEATURE_ROWS.map((row) => (
                  <tr key={row.feature} className="border-b">
                    <th scope="row" className="py-2 text-left font-normal text-muted-foreground">
                      {row.label}
                    </th>
                    {PLAN_ORDER.map((id) => (
                      <td key={id} className="px-2 py-2 text-center">
                        {PLANS[id].features[row.feature] ? (
                          <>
                            <Check className="mx-auto size-4 text-success" aria-hidden="true" />
                            <span className="sr-only">Included</span>
                          </>
                        ) : (
                          <>
                            <Minus
                              className="mx-auto size-4 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <span className="sr-only">Not included</span>
                          </>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="py-3 text-left font-normal text-muted-foreground">
                    Billing
                  </th>
                  {PLAN_ORDER.map((id) => (
                    <td key={id} className="px-2 py-3 text-center">
                      {id === plan ? (
                        id === "free" ? (
                          <span className="text-xs text-muted-foreground">Current plan</span>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={openPortal}
                            disabled={!isOwner || billingBusy}
                          >
                            Manage
                          </Button>
                        )
                      ) : id === "free" ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : hasPaidSubscription ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => previewPlan(id)}
                          disabled={
                            !isOwner ||
                            !billing.configured ||
                            billingBusy ||
                            previewBusy ||
                            (billingInterval === "annual" && !billing.annualConfigured)
                          }
                        >
                          {previewBusy ? "Checking…" : "Change"}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => startPlan(id)}
                          disabled={!isOwner || !billing.configured || billingBusy}
                        >
                          Start trial
                        </Button>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          ) : null}

          {plan !== "lifetime" ? (
            <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Founding Lifetime — $499 once</p>
                <p className="text-xs text-muted-foreground">
                  100 seats in total. Unlimited products, boards and integrations, 15 members,
                  5,000 emails and 150 Juno replies a month, with no renewal. One seat per account.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={startLifetime}
                disabled={
                  !isOwner ||
                  !billing.configured ||
                  !billing.lifetimeConfigured ||
                  billingBusy
                }
              >
                {billingBusy
                  ? "Opening Stripe…"
                  : billing.lifetimeConfigured
                    ? "Claim a founding seat"
                    : "Lifetime price not configured"}
              </Button>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            {plan === "lifetime"
              ? "Founding Lifetime is a one-time payment. It does not renew and is not transferable to another workspace. The 30-day refund terms are in the lifetime terms."
              : "New paid subscriptions start with a 14-day trial, or 30 days if all five setup steps were finished first. Plan changes show Stripe's prorated invoice first; cancellation and payment-method changes happen in the Stripe Customer Portal. VAT and sales tax are calculated from the billing address and tax ID collected at checkout."}
          </p>

          {isOwner && plan !== "lifetime" ? (
            <div className="space-y-2 rounded-lg border border-border/80 bg-muted/20 p-3.5">
              <div>
                <p className="text-sm font-medium">Cancellation or refund?</p>
                <p className="text-xs text-muted-foreground">
                  Tell us why. If you agree, we will follow up once by email; your workspace data
                  stays safe either way.
                </p>
              </div>
              {feedbackSaved || billing.cancellationFeedback ? (
                <p className="text-xs text-muted-foreground">
                  Saved{billing.cancellationFeedback ? `: ${billing.cancellationFeedback.reason}` : "."}
                  {billing.cancellationFeedback?.recoveredAt ? " · welcome back" : ""}
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-[130px_180px_minmax(0,1fr)_auto] sm:items-end">
                  <select
                    value={churnKind}
                    onChange={(event) =>
                      setChurnKind(event.target.value === "refund" ? "refund" : "cancellation")
                    }
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    aria-label="Feedback type"
                  >
                    <option value="cancellation">Cancellation</option>
                    <option value="refund">Refund</option>
                  </select>
                  <select
                    value={churnReason}
                    onChange={(event) => setChurnReason(event.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    aria-label="Cancellation reason"
                  >
                    <option value="too_expensive">Too expensive</option>
                    <option value="missing_feature">Missing feature</option>
                    <option value="not_using">Not using it enough</option>
                    <option value="switching">Switching tools</option>
                    <option value="other">Other</option>
                  </select>
                  <Input
                    value={churnDetails}
                    onChange={(event) => setChurnDetails(event.target.value)}
                    placeholder="What would have kept you? (optional)"
                    maxLength={2_000}
                    aria-label="Cancellation feedback details"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={saveBillingFeedback} disabled={billingBusy}>
                    Send feedback
                  </Button>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-4">
                    <input
                      type="checkbox"
                      checked={churnConsent}
                      onChange={(event) => setChurnConsent(event.target.checked)}
                    />
                    You may email me once about this feedback.
                  </label>
                </div>
              )}
            </div>
          ) : null}

          <div className="space-y-2 border-t pt-4">
            <div className="flex items-center gap-2">
              <ReceiptText className="size-4 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-sm font-semibold">Invoices</h3>
            </div>
            {billing.invoiceError ? (
              <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-xs text-warning">
                {billing.invoiceError}
              </p>
            ) : null}
            {billing.invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {billing.hasCustomer
                  ? "No invoices have been issued yet."
                  : "Invoices appear after the workspace starts a paid subscription."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="border-b text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 font-medium">Date</th>
                      <th className="py-2 font-medium">Invoice</th>
                      <th className="py-2 font-medium">Amount</th>
                      <th className="py-2 font-medium">Status</th>
                      <th className="py-2 text-right font-medium">Download</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.invoices.map((invoice) => (
                      <tr key={invoice.id} className="border-b last:border-0">
                        <td className="py-2 text-xs">{formatDate(invoice.createdAt)}</td>
                        <td className="py-2 font-mono text-xs">{invoice.number ?? invoice.id}</td>
                        <td className="py-2 tabular-nums">
                          {formatCurrency(invoice.total, invoice.currency)}
                        </td>
                        <td className="py-2 capitalize">{invoice.status ?? "unknown"}</td>
                        <td className="py-2 text-right">
                          <div className="flex justify-end gap-3 text-xs">
                            {invoice.invoiceUrl ? (
                              <a
                                className="text-primary hover:underline"
                                href={invoice.invoiceUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View
                              </a>
                            ) : null}
                            {invoice.pdfUrl ? (
                              <a
                                className="text-primary hover:underline"
                                href={invoice.pdfUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                PDF
                              </a>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card id="tokens" className="scroll-mt-24">
        <CardContent className="space-y-5 p-5">
          <SettingsSectionHeader
            icon={KeyRound}
            title="API tokens"
            description="Bearer tokens for the workspace REST API. The raw value is shown once."
            badge={
              <StatusBadge tone="neutral">
                {tokens.filter((token) => tokenState(token).label === "Active").length} active
              </StatusBadge>
            }
          />

          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="token-name">Token name</Label>
                <Input
                  id="token-name"
                  value={tokenName}
                  onChange={(event) => setTokenName(event.target.value)}
                  placeholder="CI deploy"
                  disabled={tokenBusy}
                />
              </div>
              <Button
                type="button"
                onClick={createToken}
                disabled={tokenBusy || tokenScopes.length === 0}
              >
                {tokenBusy ? "Creating…" : "Create token"}
              </Button>
            </div>

            <div className="rounded-lg border border-border/80 bg-muted/10 p-3">
              <p className="text-xs font-medium">Scopes</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {TOKEN_SCOPE_OPTIONS.map((option) => (
                  <label
                    key={option.scope}
                    className="flex items-start gap-2 rounded-md border border-border/60 bg-card p-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={tokenScopes.includes(option.scope)}
                      onChange={() => toggleTokenScope(option.scope)}
                      disabled={tokenBusy}
                    />
                    <span>
                      <span className="font-medium">{option.label}</span>
                      <span className="block text-muted-foreground">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                “Read everything” covers all GET endpoints. The narrower read scopes unlock only
                their resource, and “Admin” implies every current and future scope.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                This workspace’s plan allows {formatNumber(PLANS[plan].apiRequestsPerMinute)} API
                requests per minute per token. MCP OAuth sessions appear here with an expiry date.
              </p>
            </div>
          </div>

          {newToken ? (
            <div className="rounded-md border border-warning/40 bg-warning-muted p-3 text-xs text-warning">
              <p className="font-medium">Copy this token now — it will not be shown again.</p>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">{newToken}</pre>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => copyToken(newToken)}>
                  <Copy className="size-3.5" aria-hidden />
                  Copy token
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setNewToken(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            {tokens.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tokens yet.</p>
            ) : (
              tokens.map((token) => (
                <div key={token.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-muted/10 px-3.5 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{token.name}</p>
                      <TokenBadge token={token} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {token.prefix}… · {token.scopes.join(" + ")} · created {formatDate(token.createdAt)}
                      {token.expiresAt ? ` · expires ${formatDate(token.expiresAt)}` : ""}
                      {token.revokedAt ? ` · revoked ${formatDate(token.revokedAt)}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {token.lastUsedAt
                        ? `last used ${formatDateTime(token.lastUsedAt)}`
                        : "never used"}
                      {token.lastUsedIpPrefix ? ` · from ${token.lastUsedIpPrefix}` : ""}
                      {token.lastUsedUserAgent ? ` · ${token.lastUsedUserAgent}` : ""}
                    </p>
                  </div>
                  {["Active", "Retiring"].includes(tokenState(token).label) ? (
                    <div className="flex flex-wrap items-center gap-1">
                      {!token.expiresAt && tokenState(token).label === "Active" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={tokenBusy}
                          onClick={() => rotateToken(token)}
                        >
                          <RefreshCw className="size-3.5" aria-hidden />
                          Rotate
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          startToken(async () => {
                            const result = await revokeApiTokenAction({
                              workspaceSlug,
                              tokenId: token.id,
                            });
                            if (!result.ok) toastActionFailure(result);
                            else {
                              setTokens((current) =>
                                current.map((item) =>
                                  item.id === token.id
                                    ? { ...item, revokedAt: now().toISOString() }
                                    : item,
                                ),
                              );
                            }
                          });
                        }}
                      >
                        Revoke
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card id="privacy" className="scroll-mt-24">
        <CardContent className="space-y-5 p-5">
          <SettingsSectionHeader
            icon={LockKeyhole}
            title="Privacy"
            description="Choose whether public request pages show customer names or only a neutral label."
          />
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-muted/20 p-3.5">
            <div>
              <p className="text-sm font-medium">Mask customer identity</p>
              <p className="text-xs text-muted-foreground">
                Replace customer names with “A customer” on public boards and requests.
                {privacy.allowed ? "" : " Professional plan required."}
              </p>
            </div>
            <Switch
              checked={maskIdentity}
              onCheckedChange={(enabled) => {
                setMaskIdentity(enabled);
                savePrivacy(enabled);
              }}
              disabled={!privacy.allowed || privacyBusy}
              aria-label="Mask customer identity"
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-muted/20 p-3.5">
            <div>
              <p className="text-sm font-medium">Show “Planned for” publicly</p>
              <p className="text-xs text-muted-foreground">
                When on, a request page may show the quarter or date the team set.
                When off, the target stays internal but is not deleted.
              </p>
            </div>
            <Switch
              checked={plannedForVisible}
              onCheckedChange={(enabled) => {
                setPlannedForVisible(enabled);
                savePlannedForVisibility(enabled);
              }}
              disabled={privacyBusy}
              aria-label="Show planned-for publicly"
            />
          </div>
        </CardContent>
      </Card>

      <Card id="danger" className="scroll-mt-24">
          <CardContent className="space-y-5 p-5">
            <SettingsSectionHeader
              icon={ShieldAlert}
              title="Danger zone"
              description="Everything that moves or removes workspace data, in one place. Export never changes anything; transfer and deletion require typing the workspace name."
            />

            <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 text-xs text-muted-foreground">
              <p className="text-sm font-medium text-foreground">Export workspace</p>
              <p className="mt-1">
                A portable JSON file with products, boards, requests, comments,
                votes, customers, conversations and messages, releases, subscribers
                and members. It never includes passwords, sessions, API token hashes
                or webhook secrets, so it is safe to archive. Exporting changes nothing.
              </p>
              <p className="mt-1">
                Ownership transfer makes the chosen teammate the owner, gives them
                billing and deletion control, and makes you an admin. Workspace data is
                not copied or moved.
              </p>
              <p className="mt-1">
                Deletion removes the workspace, its products and all nested data after
                the 30-day grace period. Until it is purged it can be cancelled, and the
                audit row survives the purge.
              </p>
            </div>

          <div className="flex flex-wrap gap-3 border-t pt-4 text-sm">
            <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`/api/app/${workspaceSlug}/export`}>
              <Download className="size-4" aria-hidden="true" /> Export workspace JSON
            </a>
            <a className="inline-flex items-center gap-1 text-primary hover:underline" href={product ? `/app/${workspaceSlug}/${product.slug}/import` : "#product"}>
              <Download className="size-4" aria-hidden="true" /> Data &amp; import
            </a>
            {product ? (
              <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`/api/app/${workspaceSlug}/${product.slug}/export?format=json`}>
                Export JSON <ArrowRight className="size-3" aria-hidden="true" />
              </a>
            ) : null}
          </div>

          {isOwner ? (
            <div className="space-y-4 border-t pt-4">
              <div className="flex items-start gap-3">
                <UserCog className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm font-medium">Transfer ownership</p>
                  <p className="text-xs text-muted-foreground">
                    The new owner gets full billing and deletion control. You become an admin.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select
                      value={transferMemberId}
                      onChange={(event) => setTransferMemberId(event.target.value)}
                      className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                      aria-label="New workspace owner"
                    >
                      <option value="">Choose a teammate</option>
                      {members
                        .filter((member) => member.userId !== currentUserId)
                        .map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name} ({member.email})
                          </option>
                        ))}
                    </select>
                    <Input
                      value={transferConfirm}
                      onChange={(event) => setTransferConfirm(event.target.value)}
                      placeholder={`Type ${workspaceName} to confirm`}
                      aria-label="Type the workspace name to confirm the transfer"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={transferOwnership}
                      disabled={
                        !transferMemberId ||
                        transferConfirm.trim() !== workspaceName ||
                        dataBusy
                      }
                    >
                      Transfer
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm font-medium">Erase a customer</p>
                  <p className="text-xs text-muted-foreground">
                    Permanently removes the customer, their sessions, votes and notifications. This cannot be undone.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      type="email"
                      value={eraseEmail}
                      onChange={(event) => setEraseEmail(event.target.value)}
                      placeholder="customer@example.com"
                      aria-label="Customer email to erase"
                    />
                    <ConfirmDialog
                      trigger={
                        <Button type="button" variant="destructive" disabled={!eraseEmail || dataBusy}>
                          Erase
                        </Button>
                      }
                      title="Erase this customer's data?"
                      description={`Permanently removes ${eraseEmail || "this customer"} and their linked data. This cannot be undone.`}
                      confirmLabel="Erase data"
                      onConfirm={eraseCustomer}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <Trash2 className="mt-0.5 size-4 text-destructive" aria-hidden="true" />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm font-medium text-destructive">Delete this workspace</p>
                  {deletion && !deletion.cancelledAt ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Scheduled for permanent deletion on {formatDate(deletion.purgeAfter)}. All products, feedback, conversations and customer data will be removed.
                      </p>
                      <Button type="button" size="sm" variant="outline" onClick={cancelDeletion} disabled={dataBusy}>
                        Cancel deletion
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Schedules deletion after a 30-day grace period. You can cancel any time before then.
                      </p>
                      <Input
                        value={deletionReason}
                        onChange={(event) => setDeletionReason(event.target.value)}
                        placeholder="Reason (optional)"
                        maxLength={500}
                        aria-label="Deletion reason"
                      />
                      <Input
                        value={deleteConfirm}
                        onChange={(event) => setDeleteConfirm(event.target.value)}
                        placeholder={`Type ${workspaceName} to confirm`}
                        aria-label="Type the workspace name to confirm deletion"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={requestDeletion}
                        disabled={deleteConfirm.trim() !== workspaceName || dataBusy}
                      >
                        Request deletion
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isOwner ? (
        <Card id="audit" className="scroll-mt-24">
          <CardContent className="space-y-5 p-5">
            <SettingsSectionHeader
              icon={History}
              title="Audit log"
              description={`Owner-only history of administrative and destructive actions, including who changed whose role. Entries older than ${auditRetentionDays} days are pruned nightly.`}
              badge={
                <StatusBadge tone="neutral">
                  {audit.length} {audit.length === 1 ? "entry" : "entries"}
                </StatusBadge>
              }
            />

            <form
              method="get"
              action={`/app/${workspaceSlug}/settings#audit`}
              className="grid gap-2 rounded-lg border border-border/80 bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                Actor
                <Input
                  name="actor"
                  defaultValue={auditFilters.actor}
                  placeholder="name or email"
                  className="h-8"
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                Action
                <select
                  name="action"
                  defaultValue={auditFilters.action}
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="">All actions</option>
                  {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                Target
                <select
                  name="targetType"
                  defaultValue={auditFilters.targetType}
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="">All targets</option>
                  {Object.entries(AUDIT_TARGET_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                From
                <Input name="from" type="date" defaultValue={auditFilters.from} className="h-8" />
              </label>
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                To
                <Input name="to" type="date" defaultValue={auditFilters.to} className="h-8" />
              </label>
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                Search
                <Input
                  name="search"
                  defaultValue={auditFilters.search}
                  placeholder="action, target or detail"
                  className="h-8"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
                <Button type="submit" size="sm" variant="outline">
                  Apply filters
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/app/${workspaceSlug}/settings#audit`}>Clear</Link>
                </Button>
                <a
                  className="ml-auto text-xs text-primary hover:underline"
                  href={`/api/app/${workspaceSlug}/audit/export${auditFilterQuery(auditFilters)}`}
                >
                  Export CSV
                </a>
              </div>
            </form>

            {audit.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {Object.values(auditFilters).some(Boolean)
                  ? "No entries match these filters."
                  : "No administrative actions recorded yet."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="border-b text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 font-medium">When</th>
                      <th className="py-2 font-medium">Action</th>
                      <th className="py-2 font-medium">Detail</th>
                      <th className="py-2 font-medium">Target</th>
                      <th className="py-2 font-medium">Actor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((entry) => (
                      <tr key={entry.id} className="border-b last:border-0">
                        <td className="py-2 text-xs text-muted-foreground">
                          {formatDate(entry.createdAt)}
                        </td>
                        <td className="py-2">
                          {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {auditDetail(entry)}
                        </td>
                        <td className="py-2 text-xs">
                          {entry.targetType
                            ? (AUDIT_TARGET_LABELS[entry.targetType] ?? entry.targetType)
                            : "—"}
                        </td>
                        <td className="py-2 text-xs">{entry.actorName ?? "System"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card id="product" className="scroll-mt-24">
        <CardContent className="space-y-4 p-5">
          <SettingsSectionHeader
            icon={Boxes}
            title="Products"
            description="Every product has its own feedback boards, roadmap, changelog and conversations. One workspace can hold several."
            badge={
              <StatusBadge tone="neutral">
                {productLimit === null
                  ? `${products.length} product${products.length === 1 ? "" : "s"}`
                  : `${products.length} of ${productLimit}`}
              </StatusBadge>
            }
          />

          {products.length > 0 ? (
            <ul className="divide-y divide-border rounded-lg border">
              {products.map((item) => (
                <li key={item.slug}>
                  <Link
                    href={`/app/${workspaceSlug}/${item.slug}`}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/50"
                  >
                    <span className="truncate font-medium">{item.name}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      /{item.slug}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No products yet. Create one to configure feedback, conversations and branding.
            </p>
          )}

          {product ? (
            <div className="flex flex-wrap gap-2">
              <Link className={SECTION_LINK} href={`/app/${workspaceSlug}/${product.slug}/settings`}>
                Product settings
              </Link>
              <Link className={SECTION_LINK} href={`/app/${workspaceSlug}/${product.slug}/boards`}>
                Feedback boards
              </Link>
              <Link className={SECTION_LINK} href={`/app/${workspaceSlug}/${product.slug}/conversations`}>
                Conversations
              </Link>
              <Link className={SECTION_LINK} href={`/app/${workspaceSlug}/${product.slug}/settings#juno`}>
                Juno
              </Link>
              <Link className={SECTION_LINK} href={`/app/${workspaceSlug}/${product.slug}/settings#identity`}>
                SSO
              </Link>
              <Link className={SECTION_LINK} href={`/app/${workspaceSlug}/settings#branding`}>
                Branding &amp; domain
              </Link>
              <Link className={SECTION_LINK} href={`/app/${workspaceSlug}/${product.slug}/import`}>
                Data &amp; import
              </Link>
            </div>
          ) : null}

          {canCreateProduct ? (
            productLimit !== null && products.length >= productLimit ? (
              <p className="rounded-lg border border-border/80 bg-muted/30 p-3 text-xs text-muted-foreground">
                The {PLANS[plan].name} plan includes {formatLimit(productLimit)} product
                {productLimit === 1 ? "" : "s"}.{" "}
                <Link href="#billing" className="font-medium text-primary hover:underline">
                  Upgrade your plan
                </Link>{" "}
                to add another.
              </p>
            ) : (
              <CreateProductForm workspaceSlug={workspaceSlug} />
            )
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
