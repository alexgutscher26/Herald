/**
 * Email templates.
 *
 * Templates are pure functions returning both HTML and text. Every
 * interpolated value is escaped, subjects are stripped of newlines (header
 * injection) and links are supplied by the caller from a configured origin.
 */

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function subjectLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 180);
}

function layout(input: {
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string } | undefined;
  footer: string;
  footerLink?: { label: string; url: string } | undefined;
}): string {
  const body = input.paragraphs
    .map(
      (paragraph) =>
        `<p class="email-text" style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6">${escapeHtml(
          paragraph,
        )}</p>`,
    )
    .join("");

  const action = input.action
    ? `<p class="email-action-wrap" style="margin:24px 0"><a class="email-action" href="${escapeHtml(
        input.action.url,
      )}" style="background:#0f172a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;font-size:14px">${escapeHtml(
        input.action.label,
      )}</a></p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${escapeHtml(input.heading)}</title>
    <style>
      /* Inline styles cover clients without a <style> block. These queries
         override them only where the client supports them. */
      @media (prefers-color-scheme: dark) {
        .email-body, .email-shell { background: #0b1120 !important; }
        .email-card { background: #111827 !important; border-color: #334155 !important; }
        .email-eyebrow, .email-footer, .email-link { color: #94a3b8 !important; }
        .email-heading { color: #f8fafc !important; }
        .email-text { color: #cbd5e1 !important; }
        .email-rule { border-top-color: #334155 !important; }
        .email-action { background: #f8fafc !important; color: #0f172a !important; }
      }
      @media only screen and (max-width: 600px) {
        .email-body { padding: 0 !important; }
        .email-card { padding: 20px !important; border-radius: 0 !important; border-left: 0 !important; border-right: 0 !important; }
        .email-heading { font-size: 20px !important; }
        .email-action { display: block !important; text-align: center !important; }
      }
    </style>
    <!--[if mso]>
    <style>
      .email-body, .email-text, .email-footer, .email-heading { font-family: Arial, sans-serif !important; }
      .email-card { width: 560px !important; }
    </style>
    <![endif]-->
  </head>
  <body class="email-body" style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <table class="email-shell" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#f8fafc">
      <tr>
        <td align="center" style="padding:0">
          <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
          <div class="email-card" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
            <p class="email-eyebrow" style="margin:0 0 20px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b">Herald</p>
            <h1 class="email-heading" style="margin:0 0 16px;color:#0f172a;font-size:22px;line-height:1.3">${escapeHtml(
              input.heading,
            )}</h1>
            ${body}
            ${action}
            <hr class="email-rule" style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 16px" />
            <p class="email-footer" style="margin:0;color:#64748b;font-size:12px;line-height:1.6">${escapeHtml(
              input.footer,
            )}</p>
            ${
              input.footerLink
                ? `<p class="email-footer" style="margin:8px 0 0;font-size:12px;line-height:1.6"><a class="email-link" href="${escapeHtml(
                    input.footerLink.url,
                  )}" style="color:#64748b">${escapeHtml(
                    input.footerLink.label,
                  )}</a></p>`
                : ""
            }
          </div>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function lines(
  paragraphs: string[],
  action?: { label: string; url: string } | undefined,
  footer?: string | undefined,
  footerLink?: { label: string; url: string } | undefined,
): string {
  const body = paragraphs.join("\n\n");
  const actionText = action ? `\n\n${action.label}: ${action.url}` : "";
  const footerText = footer ? `\n\n—\n${footer}` : "";
  const linkText = footerLink ? `\n${footerLink.label}: ${footerLink.url}` : "";
  return `${body}${actionText}${footerText}${linkText}`;
}

export function renderEmailVerificationEmail(input: {
  name: string;
  url: string;
  expiresMinutes: number;
}): RenderedEmail {
  const greeting = input.name.trim() === "" ? "Confirm this email address" : `${input.name.trim()}, confirm this email address`;
  const paragraphs = [
    `${greeting} for your Herald account.`,
    `The link works once and expires in ${input.expiresMinutes} minutes.`,
    "If you requested an email change, the new address only takes effect after you confirm it here. If you did not ask for this, ignore the email — nothing changes until the link is opened.",
  ];
  return {
    subject: subjectLine("Confirm your email address"),
    html: layout({
      heading: "Confirm your email",
      paragraphs,
      action: { label: "Confirm email", url: input.url },
      footer: "Herald — customer feedback and changelogs.",
    }),
    text: lines(
      paragraphs,
      { label: "Confirm email", url: input.url },
      "Herald — customer feedback and changelogs.",
    ),
  };
}

export function renderEmailChangeConfirmationEmail(input: {
  name: string;
  currentEmail: string;
  newEmail: string;
  url: string;
  expiresMinutes: number;
}): RenderedEmail {
  const paragraphs = [
    `A change from ${input.currentEmail} to ${input.newEmail} was requested for your Herald account.`,
    `Confirm it from this inbox first; we then send a second link to ${input.newEmail}. The address changes only after that second link is opened.`,
    `The link works once and expires in ${input.expiresMinutes} minutes. If you did not request this, ignore the email and your address stays as it is.`,
  ];
  return {
    subject: subjectLine("Confirm the email change on your Herald account"),
    html: layout({
      heading: "Confirm your email change",
      paragraphs,
      action: { label: "Confirm the change", url: input.url },
      footer: "Both the old and the new address have to be confirmed before anything changes.",
    }),
    text: lines(
      paragraphs,
      { label: "Confirm the change", url: input.url },
      "Both the old and the new address have to be confirmed before anything changes.",
    ),
  };
}

export function renderPasswordResetEmail(input: {
  name: string;
  url: string;
  expiresMinutes: number;
}): RenderedEmail {
  const paragraphs = [
    input.name.trim() === ""
      ? "A password reset was requested for your Herald account."
      : `${input.name.trim()}, a password reset was requested for your Herald account.`,
    `The link works once and expires in ${input.expiresMinutes} minutes. Choosing a new password signs out every other session.`,
    "If you did not request this, ignore this email — your password is unchanged and the link expires on its own.",
  ];
  return {
    subject: subjectLine("Reset your Herald password"),
    html: layout({
      heading: "Reset your password",
      paragraphs,
      action: { label: "Choose a new password", url: input.url },
      footer: "For your security this link is single use.",
    }),
    text: lines(
      paragraphs,
      { label: "Choose a new password", url: input.url },
      "For your security this link is single use.",
    ),
  };
}

export function renderPasswordChangedEmail(input: {
  name: string;
  email: string;
  signInUrl: string;
}): RenderedEmail {
  const paragraphs = [
    `The password for ${input.email} was just changed.`,
    "Every other session was signed out. If you made this change, you can sign in with the new password now.",
    "If this was not you, reset the password again immediately and contact your workspace owner.",
  ];
  return {
    subject: subjectLine("Your Herald password was changed"),
    html: layout({
      heading: "Your password was changed",
      paragraphs,
      action: { label: "Sign in", url: input.signInUrl },
      footer: "You are receiving this because the password on this account changed.",
    }),
    text: lines(
      paragraphs,
      { label: "Sign in", url: input.signInUrl },
      "You are receiving this because the password on this account changed.",
    ),
  };
}

export function renderSenderVerificationEmail(input: {
  workspaceName: string;
  address: string;
  purpose: "from" | "reply_to";
  url: string;
  expiresMinutes: number;
}): RenderedEmail {
  const label = input.purpose === "from" ? "From address" : "Reply-to address";
  const paragraphs = [
    `Verify ${input.address} as the ${label.toLowerCase()} for ${input.workspaceName}.`,
    `This link works once and expires in ${input.expiresMinutes} minutes.`,
    "If you did not make this change, ignore this email. Campaign sending stays blocked until the address is verified.",
  ];
  return {
    subject: subjectLine(`Verify ${input.address} for ${input.workspaceName}`),
    html: layout({
      heading: "Verify a sender address",
      paragraphs,
      action: { label: "Verify address", url: input.url },
      footer: "Herald — sender identity verification.",
    }),
    text: lines(
      paragraphs,
      { label: "Verify address", url: input.url },
      "Herald — sender identity verification.",
    ),
  };
}

export function renderTestEmail(input: { workspaceName: string }): RenderedEmail {
  const paragraphs = [
    `This is a test email from ${input.workspaceName}.`,
    "If you can read this, outbound email is configured correctly. No customer data was included.",
  ];
  return {
    subject: subjectLine(`Test email from ${input.workspaceName}`),
    html: layout({
      heading: "Email is working",
      paragraphs,
      footer: "This is a one-off test. You will not be added to any list.",
    }),
    text: lines(paragraphs, undefined, "This is a one-off test. You will not be added to any list."),
  };
}

export function renderSubscriberConfirmationEmail(input: {
  workspaceName: string;
  productName: string;
  email: string;
  confirmUrl: string;
}): RenderedEmail {
  const paragraphs = [
    `Someone asked to receive product updates from ${input.productName} (${input.workspaceName}) at ${input.email}.`,
    "Open the link below to confirm. Until then this address is not subscribed to product updates.",
    "If this was not you, ignore this email. No updates will be sent to this address.",
  ];
  return {
    subject: subjectLine(`Confirm your subscription to ${input.productName}`),
    html: layout({
      heading: "Confirm your subscription",
      paragraphs,
      action: { label: "Confirm subscription", url: input.confirmUrl },
      footer: "This confirmation link can be used once.",
    }),
    text: lines(
      paragraphs,
      { label: "Confirm subscription", url: input.confirmUrl },
      "This confirmation link can be used once.",
    ),
  };
}

export function renderTrialEndingEmail(input: {
  workspaceName: string;
  planName: string;
  trialEndsAt: string | null;
  billingUrl: string;
}): RenderedEmail {
  const date = input.trialEndsAt
    ? new Date(input.trialEndsAt).toLocaleDateString("en", { dateStyle: "long" })
    : "soon";
  const paragraphs = [
    `The ${input.planName} trial for ${input.workspaceName} ends on ${date}.`,
    "Add a payment method before then to keep your paid plan, public surfaces and workspace limits without interruption.",
    "You can review the plan and invoices in Herald at any time.",
  ];
  return {
    subject: subjectLine(`Your ${input.workspaceName} trial ends soon`),
    html: layout({
      heading: "Your trial is ending soon",
      paragraphs,
      action: { label: "Review billing", url: input.billingUrl },
      footer: "This billing notice was sent to the workspace owner.",
    }),
    text: lines(
      paragraphs,
      { label: "Review billing", url: input.billingUrl },
      "This billing notice was sent to the workspace owner.",
    ),
  };
}

export function renderPaymentFailedEmail(input: {
  workspaceName: string;
  planName: string;
  amount: string;
  invoiceUrl: string;
  nextAttemptAt: string | null;
}): RenderedEmail {
  const retry = input.nextAttemptAt
    ? `Stripe will try again on ${new Date(input.nextAttemptAt).toLocaleDateString("en", {
        dateStyle: "long",
      })}.`
    : "Update the payment method to avoid losing paid features.";
  const paragraphs = [
    `A payment of ${input.amount} for the ${input.planName} plan on ${input.workspaceName} did not go through.`,
    retry,
    "Paid features remain tied to the subscription status until the payment succeeds.",
  ];
  return {
    subject: subjectLine(`Payment failed for ${input.workspaceName}`),
    html: layout({
      heading: "We could not process the payment",
      paragraphs,
      action: { label: "Update payment method", url: input.invoiceUrl },
      footer: "This billing notice was sent to the workspace owner.",
    }),
    text: lines(
      paragraphs,
      { label: "Update payment method", url: input.invoiceUrl },
      "This billing notice was sent to the workspace owner.",
    ),
  };
}

export function renderDunningEmail(input: {
  workspaceName: string;
  planName: string;
  stage: 1 | 2 | 3;
  amount: string;
  invoiceUrl: string;
  nextAttemptAt: string | null;
  graceEndsAt: string | null;
}): RenderedEmail {
  const retry = input.nextAttemptAt
    ? `Stripe will try again on ${new Date(input.nextAttemptAt).toLocaleDateString("en", {
        dateStyle: "long",
      })}.`
    : "Update the payment method so Stripe can try again.";
  const grace = input.graceEndsAt
    ? new Date(input.graceEndsAt).toLocaleDateString("en", { dateStyle: "long" })
    : null;
  const heading =
    input.stage === 1
      ? "Your payment did not go through"
      : input.stage === 2
        ? "Your payment is still waiting"
        : "Final reminder before your plan changes";
  const paragraphs = [
    `We could not charge ${input.amount} for the ${input.planName} plan on ${input.workspaceName}.`,
    retry,
    "Your data is safe. Nothing has been deleted, and your requests, customers, boards and history stay in place.",
    grace
      ? `Paid limits remain available until ${grace}. After that the workspace moves to Free limits until a payment succeeds; your data stays safe and can be exported or reactivated at any time.`
      : "Paid limits remain available for the grace period. After that the workspace moves to Free limits until a payment succeeds.",
  ];
  return {
    subject: subjectLine(
      input.stage === 3
        ? `Final reminder: payment for ${input.workspaceName}`
        : `Payment failed for ${input.workspaceName}`,
    ),
    html: layout({
      heading,
      paragraphs,
      action: { label: "Update payment method", url: input.invoiceUrl },
      footer: "This billing notice was sent to the workspace owner.",
    }),
    text: lines(
      paragraphs,
      { label: "Update payment method", url: input.invoiceUrl },
      "This billing notice was sent to the workspace owner.",
    ),
  };
}

export function renderBillingWinbackEmail(input: {
  workspaceName: string;
  planName: string;
  reason: string;
  billingUrl: string;
}): RenderedEmail {
  const paragraphs = [
    `You told us you were leaving ${input.workspaceName} because: ${input.reason}.`,
    "We read every note. If there is something we can fix, reply to this email and a person will answer.",
    `If you would like to come back, your workspace and its data are still here. You can restart the ${input.planName} plan whenever you are ready.`,
  ];
  return {
    subject: subjectLine(`Before you go, ${input.workspaceName}`),
    html: layout({
      heading: "We would like to win you back",
      paragraphs,
      action: { label: "Review your workspace", url: input.billingUrl },
      footer: "You received this because you asked us to follow up about your cancellation.",
    }),
    text: lines(
      paragraphs,
      { label: "Review your workspace", url: input.billingUrl },
      "You received this because you asked us to follow up about your cancellation.",
    ),
  };
}

export function renderWorkspaceInviteEmail(input: {
  workspaceName: string;
  inviterName: string;
  url: string;
  expiresDays: number;
}): RenderedEmail {
  const paragraphs = [
    `${input.inviterName} invited you to join ${input.workspaceName} on Herald.`,
    `This invitation expires in ${input.expiresDays} days and can only be used by ${input.workspaceName} teammates.`,
    "If you were not expecting this invitation, you can ignore this email.",
  ];
  return {
    subject: subjectLine(`Join ${input.workspaceName} on Herald`),
    html: layout({
      heading: `Join ${input.workspaceName}`,
      paragraphs,
      action: { label: "Accept invitation", url: input.url },
      footer: "Herald — customer feedback and changelogs.",
    }),
    text: lines(
      paragraphs,
      { label: "Accept invitation", url: input.url },
      "Herald — customer feedback and changelogs.",
    ),
  };
}

export function renderCustomerMagicLinkEmail(input: {
  workspaceName: string;
  productName: string;
  url: string;
  expiresMinutes: number;
}): RenderedEmail {
  const paragraphs = [
    `Use the button below to sign in to ${input.productName} feedback on ${input.workspaceName}.`,
    `This link expires in ${input.expiresMinutes} minutes and can only be used once.`,
    "If you did not request it, you can ignore this email — no one is signed in until the link is opened.",
  ];
  return {
    subject: subjectLine(`Sign in to ${input.workspaceName}`),
    html: layout({
      heading: "Your sign-in link",
      paragraphs,
      action: { label: "Sign in", url: input.url },
      footer: "For your security, this link works once and then stops working.",
    }),
    text: lines(
      paragraphs,
      { label: "Sign in", url: input.url },
      "For your security, this link works once and then stops working.",
    ),
  };
}

export function renderReleasePublishedEmail(input: {
  productName: string;
  releaseTitle: string;
  summary: string;
  url: string;
  preferencesUrl?: string | undefined;
  sample?: boolean | undefined;
}): RenderedEmail {
  const footerLink = input.preferencesUrl
    ? { label: "Unsubscribe or change email preferences", url: input.preferencesUrl }
    : undefined;
  const paragraphs = [
    `${input.productName} published a new update.`,
    input.summary,
  ];
  return {
    subject: subjectLine(
      `${input.sample ? "[Sample] " : ""}${input.productName}: ${input.releaseTitle}`,
    ),
    html: layout({
      heading: input.releaseTitle,
      paragraphs,
      action: { label: "Read the update", url: input.url },
      footer: input.sample
        ? `This is a sample customer email from ${input.productName}. No subscription was created.`
        : `You are receiving this because you subscribed to updates from ${input.productName}.`,
      footerLink,
    }),
    text: lines(
      paragraphs,
      { label: "Read the update", url: input.url },
      input.sample
        ? `This is a sample customer email from ${input.productName}. No subscription was created.`
        : `You are receiving this because you subscribed to updates from ${input.productName}.`,
      footerLink,
    ),
  };
}

export function renderFeedbackStatusEmail(input: {
  productName: string;
  requestTitle: string;
  status: string;
  url: string;
  preferencesUrl?: string | undefined;
}): RenderedEmail {
  const footerLink = input.preferencesUrl
    ? { label: "Change which emails you receive", url: input.preferencesUrl }
    : undefined;
  const paragraphs = [
    `The status of “${input.requestTitle}” changed to ${input.status}.`,
    `You are receiving this because you voted on, commented on or followed this request from ${input.productName}.`,
  ];
  return {
    subject: subjectLine(`Status update: ${input.requestTitle}`),
    html: layout({
      heading: `${input.requestTitle} is now ${input.status}`,
      paragraphs,
      action: { label: "View the request", url: input.url },
      footer: "Status updates are separate from product-update email.",
      footerLink,
    }),
    text: lines(
      paragraphs,
      { label: "View the request", url: input.url },
      "Status updates are separate from product-update email.",
      footerLink,
    ),
  };
}

export function renderFeedbackReplyEmail(input: {
  productName: string;
  requestTitle: string;
  authorName: string;
  body: string;
  url: string;
  preferencesUrl?: string | undefined;
}): RenderedEmail {
  const footerLink = input.preferencesUrl
    ? { label: "Change which emails you receive", url: input.preferencesUrl }
    : undefined;
  const paragraphs = [
    `${input.authorName} replied on “${input.requestTitle}”.`,
    input.body,
    `You are receiving this because you follow this request from ${input.productName}.`,
  ];
  return {
    subject: subjectLine(`New reply on ${input.requestTitle}`),
    html: layout({
      heading: `New reply on ${input.requestTitle}`,
      paragraphs,
      action: { label: "Read and reply", url: input.url },
      footer: "Reply notifications are separate from product-update email.",
      footerLink,
    }),
    text: lines(
      paragraphs,
      { label: "Read and reply", url: input.url },
      "Reply notifications are separate from product-update email.",
      footerLink,
    ),
  };
}

export function renderConversationReplyEmail(input: {
  productName: string;
  subject: string;
  body: string;
  replyTo: string;
}): RenderedEmail {
  const paragraphs = [input.body, "Reply to this email to continue the conversation."];
  return {
    subject: subjectLine(`Re: ${input.subject}`),
    html: layout({
      heading: input.subject,
      paragraphs,
      footer: `You are receiving this because you wrote to ${input.productName}. Replies go straight back to the team.`,
    }),
    text: lines(
      paragraphs,
      undefined,
      `You are receiving this because you wrote to ${input.productName}. Reply to ${input.replyTo} to continue.`,
    ),
  };
}

export function renderConversationTranscriptEmail(input: {
  productName: string;
  subject: string;
  messages: { author: string; body: string; createdAt: string }[];
}): RenderedEmail {
  const paragraphs = [
    `Here is the transcript of your conversation with ${input.productName}.`,
    ...input.messages.slice(0, 50).map((message) => {
      const date = new Date(message.createdAt).toLocaleString("en", {
        dateStyle: "medium",
        timeStyle: "short",
      });
      return `${message.author} · ${date}\n${message.body}`;
    }),
  ];
  return {
    subject: subjectLine(`Transcript: ${input.subject}`),
    html: layout({
      heading: `Transcript: ${input.subject}`,
      paragraphs,
      footer: `This transcript was sent from ${input.productName}. Reply to the conversation to continue.`,
    }),
    text: lines(
      paragraphs,
      undefined,
      `This transcript was sent from ${input.productName}. Reply to the conversation to continue.`,
    ),
  };
}

export function renderConversationCsatEmail(input: {
  productName: string;
  subject: string;
  url: string;
}): RenderedEmail {
  const paragraphs = [
    `Thanks for talking to ${input.productName} about “${input.subject}”.`,
    "How did we do? Open the short rating page and choose a score from 1 to 5. If the issue came back and the thread was reopened, you can update your rating once.",
  ];
  return {
    subject: subjectLine(`How did we do? ${input.subject}`),
    html: layout({
      heading: "How did we do?",
      paragraphs,
      action: { label: "Rate the conversation", url: input.url },
      footer: `You are receiving this because you contacted ${input.productName} by email.`,
    }),
    text: lines(
      paragraphs,
      { label: "Rate the conversation", url: input.url },
      `You are receiving this because you contacted ${input.productName} by email.`,
    ),
  };
}

export function renderConversationNotificationEmail(input: {
  productName: string;
  customerName: string;
  subject: string;
  preview: string;
  url: string;
}): RenderedEmail {
  const paragraphs = [
    `${input.customerName} wrote in about “${input.subject}”.`,
    input.preview,
  ];
  return {
    subject: subjectLine(`New message from ${input.customerName}`),
    html: layout({
      heading: input.subject,
      paragraphs,
      action: { label: "Open the conversation", url: input.url },
      footer: `You are receiving this because you operate ${input.productName}. Change conversation notifications in Settings.`,
    }),
    text: lines(
      paragraphs,
      { label: "Open the conversation", url: input.url },
      `You are receiving this because you operate ${input.productName}. Change conversation notifications in Settings.`,
    ),
  };
}

export function renderAwayReplyEmail(input: {
  productName: string;
  subject: string;
  body: string;
  replyTo: string;
}): RenderedEmail {
  const paragraphs = [input.body, "You can reply to this email and your message will join the same conversation."];
  return {
    subject: subjectLine(`Re: ${input.subject}`),
    html: layout({
      heading: "We received your message",
      paragraphs,
      footer: `This is an automated reply from ${input.productName}. The team will follow up.`,
    }),
    text: lines(
      paragraphs,
      undefined,
      `This is an automated reply from ${input.productName}. Reply to ${input.replyTo} to continue.`,
    ),
  };
}

export function renderWeeklyDigestEmail(input: {
  productName: string;
  items: { title: string; summary: string }[];
  url: string;
  preferencesUrl?: string | undefined;
  cadence?: "daily" | "weekly" | undefined;
}): RenderedEmail {
  const daily = input.cadence === "daily";
  const cadenceLabel = daily ? "daily" : "weekly";
  const footerLink = input.preferencesUrl
    ? { label: `Turn off the ${cadenceLabel} digest`, url: input.preferencesUrl }
    : undefined;
  const paragraphs = [
    daily
      ? `Here is what ${input.productName} shipped today.`
      : `Here is what ${input.productName} shipped this week.`,
    ...input.items.map((item) =>
      item.summary.trim() === ""
        ? `• ${item.title}`
        : `• ${item.title} — ${item.summary}`,
    ),
  ];
  const footer = `You chose the ${cadenceLabel} digest in your email preferences.`;
  return {
    subject: subjectLine(
      daily
        ? `${input.productName}: today's updates`
        : `${input.productName}: this week's updates`,
    ),
    html: layout({
      heading: daily ? "Today in product" : "This week in product",
      paragraphs,
      action: { label: "Read the changelog", url: input.url },
      footer,
      footerLink,
    }),
    text: lines(
      paragraphs,
      { label: "Read the changelog", url: input.url },
      footer,
      footerLink,
    ),
  };
}

export function renderWinbackCampaignTestEmail(input: {
  productName: string;
  campaignName: string;
  description: string;
  url?: string | undefined;
  postalAddress: string;
  releaseTitle?: string | undefined;
}): RenderedEmail {
  const paragraphs = [
    `This is a test of “${input.campaignName}” for ${input.productName}. No customer received it.`,
    input.releaseTitle
      ? `${input.releaseTitle} — ${input.description}`
      : input.description,
  ];
  const footer = [
    "Real recipients receive an unsubscribe link in this footer.",
    input.postalAddress.trim(),
  ]
    .filter(Boolean)
    .join("\n");
  return {
    subject: subjectLine(`[Test] ${input.campaignName} — ${input.productName}`),
    html: layout({
      heading: `Test: ${input.campaignName}`,
      paragraphs,
      action: input.url ? { label: "See what's new", url: input.url } : undefined,
      footer,
    }),
    text: lines(
      paragraphs,
      input.url ? { label: "See what's new", url: input.url } : undefined,
      footer,
    ),
  };
}

export function renderWinbackCampaignEmail(input: {
  productName: string;
  campaignName: string;
  description: string;
  url?: string | undefined;
  preferencesUrl?: string | undefined;
  postalAddress: string;
  releaseTitle?: string | undefined;
}): RenderedEmail {
  const footer = [
    `You are receiving this because of your previous relationship with ${input.productName}.`,
    input.postalAddress.trim(),
  ]
    .filter(Boolean)
    .join("\n");
  const footerLink = input.preferencesUrl
    ? { label: "Unsubscribe from win-back emails", url: input.preferencesUrl }
    : undefined;
  const paragraphs = [
    `${input.productName} has an update for you.`,
    input.releaseTitle
      ? `${input.releaseTitle} — ${input.description}`
      : input.description,
  ];
  return {
    subject: subjectLine(`${input.campaignName} — ${input.productName}`),
    html: layout({
      heading: input.campaignName,
      paragraphs,
      action: input.url ? { label: "See what's new", url: input.url } : undefined,
      footer,
      footerLink,
    }),
    text: lines(
      paragraphs,
      input.url ? { label: "See what's new", url: input.url } : undefined,
      footer,
      footerLink,
    ),
  };
}

type OnboardingEmailBase = {
  name: string;
  preferencesUrl: string;
};

function onboardingFooterLink(preferencesUrl: string) {
  return { label: "Turn off onboarding emails", url: preferencesUrl };
}

function onboardingGreeting(name: string): string {
  return name.trim() === "" ? "Welcome" : `Welcome, ${name.trim()}`;
}

function onboardingReason(): string {
  return "You are receiving this because you created a Herald account. These are setup tips, not product updates or marketing.";
}

export function renderOnboardingWelcomeEmail(
  input: OnboardingEmailBase & { setupUrl: string },
): RenderedEmail {
  const paragraphs = [
    `${onboardingGreeting(input.name)}. Your Herald account is ready.`,
    "Confirm your email address if you have not already, then create a workspace and its first product. A workspace holds your team and billing; products hold feedback, the roadmap and the changelog.",
    "The free plan includes one product, two boards and the full public loop. No credit card is needed.",
  ];
  const footer = onboardingReason();
  const footerLink = onboardingFooterLink(input.preferencesUrl);
  return {
    subject: subjectLine("Welcome to Herald"),
    html: layout({
      heading: "Welcome to Herald",
      paragraphs,
      action: { label: "Set up your workspace", url: input.setupUrl },
      footer,
      footerLink,
    }),
    text: lines(
      paragraphs,
      { label: "Set up your workspace", url: input.setupUrl },
      footer,
      footerLink,
    ),
  };
}

export function renderOnboardingFirstBoardEmail(
  input: OnboardingEmailBase & {
    productName: string;
    boardUrl: string;
    dashboardUrl: string;
  },
): RenderedEmail {
  const paragraphs = [
    `${onboardingGreeting(input.name)} — the feedback board for ${input.productName} is live.`,
    `Its public address is ${input.boardUrl}. Share it with a customer, or add the first request yourself from the dashboard.`,
    "A request can collect votes and comments, move across the roadmap and point at the release that ships it.",
  ];
  const footer = onboardingReason();
  const footerLink = onboardingFooterLink(input.preferencesUrl);
  return {
    subject: subjectLine(`Your ${input.productName} feedback board is live`),
    html: layout({
      heading: "Your feedback board is ready",
      paragraphs,
      action: { label: "Open the dashboard", url: input.dashboardUrl },
      footer,
      footerLink,
    }),
    text: lines(
      paragraphs,
      { label: "Open the dashboard", url: input.dashboardUrl },
      footer,
      footerLink,
    ),
  };
}

export function renderOnboardingFirstReleaseEmail(
  input: OnboardingEmailBase & {
    productName: string;
    releaseTitle: string;
    releaseUrl: string;
  },
): RenderedEmail {
  const paragraphs = [
    `${onboardingGreeting(input.name)} — you published your first release for ${input.productName}.`,
    `“${input.releaseTitle}” is on the public changelog, and the widget can show it. Open the entry and link the requests it answers so the people who voted hear about it.`,
    "The next release can be scheduled in advance; publishing stays a separate, deliberate step.",
  ];
  const footer = onboardingReason();
  const footerLink = onboardingFooterLink(input.preferencesUrl);
  return {
    subject: subjectLine(`Your first ${input.productName} release is live`),
    html: layout({
      heading: `${input.releaseTitle} is live`,
      paragraphs,
      action: { label: "Read the release", url: input.releaseUrl },
      footer,
      footerLink,
    }),
    text: lines(
      paragraphs,
      { label: "Read the release", url: input.releaseUrl },
      footer,
      footerLink,
    ),
  };
}

export function renderOnboardingWidgetEmail(
  input: OnboardingEmailBase & {
    productName: string;
    settingsUrl: string;
  },
): RenderedEmail {
  const paragraphs = [
    `${onboardingGreeting(input.name)} — Herald has recorded an install of the ${input.productName} widget.`,
    "The launcher can now show your changelog, feedback board and support entry point on the domains you allowed.",
    "If the launcher does not appear yet, check the allowed origins and rerun the installation check from the widget settings.",
  ];
  const footer = onboardingReason();
  const footerLink = onboardingFooterLink(input.preferencesUrl);
  return {
    subject: subjectLine(`Your ${input.productName} widget is live`),
    html: layout({
      heading: "The widget is reporting installs",
      paragraphs,
      action: { label: "Open widget settings", url: input.settingsUrl },
      footer,
      footerLink,
    }),
    text: lines(
      paragraphs,
      { label: "Open widget settings", url: input.settingsUrl },
      footer,
      footerLink,
    ),
  };
}

export function renderOutboundMessageEmail(input: {
  productName: string;
  title: string;
  body: string;
  ctaLabel?: string | undefined;
  ctaUrl?: string | undefined;
  preferencesUrl?: string | undefined;
}): RenderedEmail {
  const footer = `You are receiving this because of your relationship with ${input.productName}.`;
  const footerLink = input.preferencesUrl
    ? { label: "Manage email preferences", url: input.preferencesUrl }
    : undefined;
  const paragraphs = [input.body];
  const action =
    input.ctaUrl && input.ctaLabel
      ? { label: input.ctaLabel, url: input.ctaUrl }
      : undefined;
  return {
    subject: subjectLine(input.title),
    html: layout({
      heading: input.title,
      paragraphs,
      action,
      footer,
      footerLink,
    }),
    text: lines(paragraphs, action, footer, footerLink),
  };
}
