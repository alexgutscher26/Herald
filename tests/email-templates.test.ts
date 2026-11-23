import { describe, expect, test } from "bun:test";

import {
  escapeHtml,
  renderAwayReplyEmail,
  renderConversationCsatEmail,
  renderConversationNotificationEmail,
  renderConversationReplyEmail,
  renderOnboardingFirstBoardEmail,
  renderOnboardingFirstReleaseEmail,
  renderOnboardingWelcomeEmail,
  renderOnboardingWidgetEmail,
  renderReleasePublishedEmail,
  renderTestEmail,
  renderWinbackCampaignEmail,
  renderWinbackCampaignTestEmail,
} from "@/features/email/templates";

describe("escapeHtml", () => {
  test("escapes every HTML metacharacter", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});

describe("renderTestEmail", () => {
  test("includes the workspace name in subject and body", () => {
    const email = renderTestEmail({ workspaceName: "Acme <Team>" });
    expect(email.subject).toContain("Acme <Team>");
    expect(email.html).toContain("Acme &lt;Team&gt;");
    expect(email.text).toContain("Acme <Team>");
  });
});

describe("onboarding emails", () => {
  test("the welcome links to setup and the account preference", () => {
    const email = renderOnboardingWelcomeEmail({
      name: "Ada",
      setupUrl: "https://app.example.com/app/onboarding",
      preferencesUrl: "https://app.example.com/app/account#email-preferences",
    });

    expect(email.subject).toContain("Welcome to Herald");
    expect(email.html).toContain("Set up your workspace");
    expect(email.html).toContain("Turn off onboarding emails");
    expect(email.text).toContain("https://app.example.com/app/onboarding");
  });

  test("the first-board email escapes product copy and links the real board", () => {
    const email = renderOnboardingFirstBoardEmail({
      name: "Ada",
      productName: "Widgets <beta>",
      boardUrl: "https://app.example.com/p/acme/widgets/feedback",
      dashboardUrl: "https://app.example.com/app/acme/widgets",
      preferencesUrl: "https://app.example.com/app/account#email-preferences",
    });

    expect(email.subject).toContain("Widgets <beta>");
    expect(email.html).toContain("Widgets &lt;beta&gt;");
    expect(email.html).toContain("https://app.example.com/p/acme/widgets/feedback");
    expect(email.text).toContain("Open the dashboard");
  });

  test("the first-release email carries the release title and URL", () => {
    const email = renderOnboardingFirstReleaseEmail({
      name: "Ada",
      productName: "Acme",
      releaseTitle: "Faster search",
      releaseUrl: "https://app.example.com/p/acme/widgets/updates/search",
      preferencesUrl: "https://app.example.com/app/account#email-preferences",
    });

    expect(email.subject).toContain("first Acme release");
    expect(email.html).toContain("Faster search");
    expect(email.html).toContain("https://app.example.com/p/acme/widgets/updates/search");
  });

  test("the widget email links settings and makes no install guarantee", () => {
    const email = renderOnboardingWidgetEmail({
      name: "Ada",
      productName: "Acme",
      settingsUrl: "https://app.example.com/app/acme/widgets/widget",
      preferencesUrl: "https://app.example.com/app/account#email-preferences",
    });

    expect(email.subject).toContain("widget is live");
    expect(email.html).toContain("recorded an install");
    expect(email.html).toContain("https://app.example.com/app/acme/widgets/widget");
    expect(email.html).toContain("Turn off onboarding emails");
  });
});

describe("renderReleasePublishedEmail", () => {
  test("escapes HTML and strips newlines from the subject", () => {
    const email = renderReleasePublishedEmail({
      productName: "Acme",
      releaseTitle: "<script>\nalert(1)</script>",
      summary: `A "quoted" & <b>bold</b> summary`,
      url: "https://app.example.com/p/acme/widgets/updates/v1",
    });

    expect(email.subject).not.toContain("\n");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&quot;quoted&quot; &amp;");
    expect(email.text).toContain("https://app.example.com/p/acme/widgets/updates/v1");
  });

  test("includes the subscription reason in the footer", () => {
    const email = renderReleasePublishedEmail({
      productName: "Acme",
      releaseTitle: "Version 1",
      summary: "It is here.",
      url: "https://app.example.com/update",
    });
    expect(email.html).toContain("subscribed to updates from Acme");
    expect(email.text).toContain("subscribed to updates from Acme");
  });
});

describe("renderConversationNotificationEmail", () => {
  test("escapes the customer text and links to the dashboard thread", () => {
    const email = renderConversationNotificationEmail({
      productName: "Acme",
      customerName: "Ada <script>",
      subject: "Checkout\nbreaks",
      preview: "The <b>pay</b> button fails.",
      url: "https://app.example.com/app/acme/widgets/conversations/1",
    });

    expect(email.subject).not.toContain("\n");
    expect(email.html).toContain("Ada &lt;script&gt;");
    expect(email.html).toContain("The &lt;b&gt;pay&lt;/b&gt; button fails.");
    expect(email.html).toContain(
      "https://app.example.com/app/acme/widgets/conversations/1",
    );
    expect(email.text).toContain("Ada <script>");
  });
});

describe("renderAwayReplyEmail", () => {
  test("carries the configured body and how to continue by email", () => {
    const email = renderAwayReplyEmail({
      productName: "Acme",
      subject: "Checkout breaks",
      body: "We are away until Monday.",
      replyTo: "reply+abc@support.example.com",
    });

    expect(email.subject).toBe("Re: Checkout breaks");
    expect(email.html).toContain("We are away until Monday.");
    expect(email.text).toContain("reply+abc@support.example.com");
    expect(email.html).toContain("automated reply from Acme");
  });
});

describe("renderConversationReplyEmail", () => {
  test("keeps the thread subject and the reply address in the text part", () => {
    const email = renderConversationReplyEmail({
      productName: "Acme",
      subject: "Checkout breaks",
      body: "A fix is on the way.",
      replyTo: "reply+abc@support.example.com",
    });

    expect(email.subject).toBe("Re: Checkout breaks");
    expect(email.text).toContain("reply+abc@support.example.com");
    expect(email.html).toContain("A fix is on the way.");
  });
});

describe("renderConversationCsatEmail", () => {
  test("links the tokenized rating page and explains the one-time update", () => {
    const email = renderConversationCsatEmail({
      productName: "Acme",
      subject: "Checkout breaks",
      url: "https://app.example.com/p/acme/widgets/csat/1?token=abc12345",
    });

    expect(email.subject).toContain("Checkout breaks");
    expect(email.html).toContain("https://app.example.com/p/acme/widgets/csat/1?token=abc12345");
    expect(email.text).toContain("https://app.example.com/p/acme/widgets/csat/1?token=abc12345");
    expect(email.text).toContain("once");
  });
});

describe("renderWinbackCampaignTestEmail", () => {
  test("marks the message as a test and carries no customer unsubscribe claim", () => {
    const email = renderWinbackCampaignTestEmail({
      productName: "Acme",
      campaignName: "Reporting is fixed",
      description: "The reporting problem you reported is fixed.",
      releaseTitle: "The reporting fix is live",
      postalAddress: "Acme Inc., 123 Main Street, Springfield, IL 62701",
      url: "https://app.example.com/p/acme/widgets/updates/reporting",
    });

    expect(email.subject).toContain("[Test]");
    expect(email.subject).toContain("Reporting is fixed");
    expect(email.html).toContain("No customer received it");
    expect(email.html).toContain("The reporting fix is live");
    expect(email.html).toContain("123 Main Street");
    expect(email.text).toContain("https://app.example.com/p/acme/widgets/updates/reporting");
  });
});

describe("renderWinbackCampaignEmail", () => {
  test("carries the release, postal address and preference opt-out", () => {
    const email = renderWinbackCampaignEmail({
      productName: "Acme",
      campaignName: "Reporting is fixed",
      description: "The reporting problem you reported is fixed.",
      releaseTitle: "The reporting fix is live",
      postalAddress: "Acme Inc., 123 Main Street, Springfield, IL 62701",
      url: "https://app.example.com/p/acme/widgets/updates/reporting",
      preferencesUrl: "https://app.example.com/p/acme/widgets/preferences/token",
    });

    expect(email.subject).toContain("Reporting is fixed");
    expect(email.html).toContain("The reporting fix is live");
    expect(email.html).toContain("123 Main Street");
    expect(email.html).toContain("Unsubscribe from win-back emails");
    expect(email.text).toContain("123 Main Street");
    expect(email.text).toContain("https://app.example.com/p/acme/widgets/preferences/token");
  });
});
