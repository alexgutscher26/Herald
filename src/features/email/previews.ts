import {
  renderAwayReplyEmail,
  renderConversationCsatEmail,
  renderConversationNotificationEmail,
  renderConversationReplyEmail,
  renderConversationTranscriptEmail,
  renderCustomerMagicLinkEmail,
  renderEmailChangeConfirmationEmail,
  renderEmailVerificationEmail,
  renderFeedbackReplyEmail,
  renderFeedbackStatusEmail,
  renderOnboardingFirstBoardEmail,
  renderOnboardingFirstReleaseEmail,
  renderOnboardingWelcomeEmail,
  renderOnboardingWidgetEmail,
  renderOutboundMessageEmail,
  renderPasswordChangedEmail,
  renderPasswordResetEmail,
  renderPaymentFailedEmail,
  renderReleasePublishedEmail,
  renderSenderVerificationEmail,
  renderTestEmail,
  renderTrialEndingEmail,
  renderWeeklyDigestEmail,
  renderWinbackCampaignEmail,
  renderWinbackCampaignTestEmail,
  renderWorkspaceInviteEmail,
  type RenderedEmail,
} from "./templates";

/**
 * Sample data for the settings gallery. Every template is rendered through the
 * real renderer so the preview cannot drift from what a recipient receives.
 * Values are fictional and never touch a subscriber, customer or delivery row.
 */

export type EmailPreview = RenderedEmail & {
  id: string;
  label: string;
  category: "Account" | "Billing" | "Customer" | "Support" | "Onboarding";
};

const SAMPLE_TOKEN = "sample-preview-token-not-a-real-credential";

export function buildEmailPreviews(origin: string): EmailPreview[] {
  const url = (path: string): string => new URL(path, origin).toString();
  const preferencesUrl = url(
    `/p/acme/feedback/email-preferences?token=${encodeURIComponent(SAMPLE_TOKEN)}`,
  );

  const previews: EmailPreview[] = [
    {
      id: "email_verification",
      label: "Email verification",
      category: "Account",
      ...renderEmailVerificationEmail({
        name: "Ada",
        url: url("/verify-email?token=sample"),
        expiresMinutes: 60,
      }),
    },
    {
      id: "email_change",
      label: "Email change confirmation",
      category: "Account",
      ...renderEmailChangeConfirmationEmail({
        name: "Ada",
        currentEmail: "ada@example.test",
        newEmail: "ada@new.example.test",
        url: url("/verify-email-change?token=sample"),
        expiresMinutes: 60,
      }),
    },
    {
      id: "password_reset",
      label: "Password reset",
      category: "Account",
      ...renderPasswordResetEmail({
        name: "Ada",
        url: url("/reset-password?token=sample"),
        expiresMinutes: 30,
      }),
    },
    {
      id: "password_changed",
      label: "Password changed",
      category: "Account",
      ...renderPasswordChangedEmail({
        name: "Ada",
        email: "ada@example.test",
        signInUrl: url("/sign-in"),
      }),
    },
    {
      id: "sender_verification",
      label: "Sender verification",
      category: "Account",
      ...renderSenderVerificationEmail({
        workspaceName: "Acme",
        address: "updates@acme.example",
        purpose: "from",
        url: url("/verify-sender?token=sample"),
        expiresMinutes: 60,
      }),
    },
    {
      id: "workspace_invite",
      label: "Workspace invitation",
      category: "Account",
      ...renderWorkspaceInviteEmail({
        workspaceName: "Acme",
        inviterName: "Grace",
        url: url("/invite?token=sample"),
        expiresDays: 7,
      }),
    },
    {
      id: "customer_magic_link",
      label: "Customer sign-in link",
      category: "Customer",
      ...renderCustomerMagicLinkEmail({
        workspaceName: "Acme",
        productName: "Acme Cloud",
        url: url("/p/acme/feedback/sign-in?token=sample"),
        expiresMinutes: 15,
      }),
    },
    {
      id: "trial_ending",
      label: "Trial ending",
      category: "Billing",
      ...renderTrialEndingEmail({
        workspaceName: "Acme",
        planName: "Scale",
        trialEndsAt: "2026-12-01T12:00:00.000Z",
        billingUrl: url("/app/acme/settings/billing"),
      }),
    },
    {
      id: "payment_failed",
      label: "Payment failed",
      category: "Billing",
      ...renderPaymentFailedEmail({
        workspaceName: "Acme",
        planName: "Scale",
        amount: "$49.00",
        invoiceUrl: url("/app/acme/settings/billing"),
        nextAttemptAt: "2026-11-25T12:00:00.000Z",
      }),
    },
    {
      id: "test_email",
      label: "Provider test",
      category: "Account",
      ...renderTestEmail({ workspaceName: "Acme" }),
    },
    {
      id: "release_published",
      label: "Release published",
      category: "Customer",
      ...renderReleasePublishedEmail({
        productName: "Acme Cloud",
        releaseTitle: "Faster search",
        summary: "Search now covers changelog entries and respects filters.",
        url: url("/p/acme/cloud/updates/faster-search"),
        preferencesUrl,
      }),
    },
    {
      id: "feedback_status",
      label: "Request status changed",
      category: "Customer",
      ...renderFeedbackStatusEmail({
        productName: "Acme Cloud",
        requestTitle: "Dark mode",
        status: "In progress",
        url: url("/p/acme/cloud/feedback/dark-mode"),
        preferencesUrl,
      }),
    },
    {
      id: "feedback_reply",
      label: "Request reply",
      category: "Customer",
      ...renderFeedbackReplyEmail({
        productName: "Acme Cloud",
        requestTitle: "Dark mode",
        authorName: "Grace",
        body: "The next release includes a dark palette for every public page.",
        url: url("/p/acme/cloud/feedback/dark-mode"),
        preferencesUrl,
      }),
    },
    {
      id: "weekly_digest",
      label: "Weekly digest",
      category: "Customer",
      ...renderWeeklyDigestEmail({
        productName: "Acme Cloud",
        items: [
          { title: "Faster search", summary: "Filters now apply across the whole changelog." },
          { title: "Dark mode", summary: "Every public surface follows the system theme." },
        ],
        url: url("/p/acme/cloud/updates"),
        preferencesUrl,
        cadence: "weekly",
      }),
    },
    {
      id: "daily_digest",
      label: "Daily digest",
      category: "Customer",
      ...renderWeeklyDigestEmail({
        productName: "Acme Cloud",
        items: [
          { title: "Export improvements", summary: "CSV exports preserve column order." },
        ],
        url: url("/p/acme/cloud/updates"),
        preferencesUrl,
        cadence: "daily",
      }),
    },
    {
      id: "winback_campaign",
      label: "Win-back campaign",
      category: "Customer",
      ...renderWinbackCampaignEmail({
        productName: "Acme Cloud",
        campaignName: "The export you asked for",
        description: "A reliable CSV export shipped this week.",
        releaseTitle: "Reliable exports",
        url: url("/p/acme/cloud/updates/reliable-exports"),
        preferencesUrl,
        postalAddress: "Acme Inc · 100 Main Street · Springfield",
      }),
    },
    {
      id: "winback_campaign_test",
      label: "Win-back test",
      category: "Customer",
      ...renderWinbackCampaignTestEmail({
        productName: "Acme Cloud",
        campaignName: "The export you asked for",
        description: "A reliable CSV export shipped this week.",
        releaseTitle: "Reliable exports",
        url: url("/p/acme/cloud/updates/reliable-exports"),
        postalAddress: "Acme Inc · 100 Main Street · Springfield",
      }),
    },
    {
      id: "outbound_message",
      label: "Outbound message",
      category: "Customer",
      ...renderOutboundMessageEmail({
        productName: "Acme Cloud",
        title: "A note from the team",
        body: "We are changing how imports report duplicate rows. Nothing you need to do today.",
        ctaLabel: "Read the details",
        ctaUrl: url("/p/acme/cloud/updates/import-reporting"),
        preferencesUrl,
      }),
    },
    {
      id: "conversation_reply",
      label: "Support reply",
      category: "Support",
      ...renderConversationReplyEmail({
        productName: "Acme Cloud",
        subject: "Checkout fails on mobile",
        body: "We found the cause and deployed a fix. Please try the checkout again.",
        replyTo: "reply+sample@inbound.herald.test",
      }),
    },
    {
      id: "conversation_transcript",
      label: "Conversation transcript",
      category: "Support",
      ...renderConversationTranscriptEmail({
        productName: "Acme Cloud",
        subject: "Checkout fails on mobile",
        messages: [
          {
            author: "Customer",
            body: "Checkout fails after I choose a card.",
            createdAt: "2026-11-20T10:00:00.000Z",
          },
          {
            author: "Support team",
            body: "Thanks for the details. We are checking the payment step.",
            createdAt: "2026-11-20T10:12:00.000Z",
          },
        ],
      }),
    },
    {
      id: "conversation_csat",
      label: "CSAT request",
      category: "Support",
      ...renderConversationCsatEmail({
        productName: "Acme Cloud",
        subject: "Checkout fails on mobile",
        url: url("/p/acme/cloud/feedback/csat?token=sample"),
      }),
    },
    {
      id: "conversation_notification",
      label: "Support alert",
      category: "Support",
      ...renderConversationNotificationEmail({
        productName: "Acme Cloud",
        customerName: "Ada",
        subject: "Checkout fails on mobile",
        preview: "Checkout fails after I choose a card.",
        url: url("/app/acme/cloud/conversations/sample"),
      }),
    },
    {
      id: "away_reply",
      label: "Away reply",
      category: "Support",
      ...renderAwayReplyEmail({
        productName: "Acme Cloud",
        subject: "Checkout fails on mobile",
        body: "Thanks for writing in. Our support hours are Monday to Friday, 09:00–17:00 UTC.",
        replyTo: "reply+sample@inbound.herald.test",
      }),
    },
    {
      id: "onboarding_welcome",
      label: "Onboarding welcome",
      category: "Onboarding",
      ...renderOnboardingWelcomeEmail({
        name: "Ada",
        preferencesUrl,
        setupUrl: url("/app/onboarding"),
      }),
    },
    {
      id: "onboarding_first_board",
      label: "First feedback board",
      category: "Onboarding",
      ...renderOnboardingFirstBoardEmail({
        name: "Ada",
        preferencesUrl,
        productName: "Acme Cloud",
        boardUrl: url("/p/acme/cloud/feedback"),
        dashboardUrl: url("/app/acme/cloud/feedback"),
      }),
    },
    {
      id: "onboarding_first_release",
      label: "First release",
      category: "Onboarding",
      ...renderOnboardingFirstReleaseEmail({
        name: "Ada",
        preferencesUrl,
        productName: "Acme Cloud",
        releaseTitle: "Faster search",
        releaseUrl: url("/p/acme/cloud/updates/faster-search"),
      }),
    },
    {
      id: "onboarding_widget",
      label: "Widget install",
      category: "Onboarding",
      ...renderOnboardingWidgetEmail({
        name: "Ada",
        preferencesUrl,
        productName: "Acme Cloud",
        settingsUrl: url("/app/acme/cloud/settings"),
      }),
    },
  ];

  return previews.sort((left, right) => left.label.localeCompare(right.label));
}
