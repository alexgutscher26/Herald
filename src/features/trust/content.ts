/**
 * Published trust-pack content.
 *
 * This module is the single source for the public security page, DPA,
 * sub-processor list and data-residency statement. It is intentionally plain
 * data plus copy: no database access, so it can be unit-tested and rendered
 * without a request context.
 *
 * Accuracy rules:
 *  - Never claim a certification Herald does not hold. SOC 2 is not claimed.
 *  - Sub-processors are the providers this codebase and its documented
 *    deployment use. An operator running Herald elsewhere must update this
 *    list before publishing; the page says so.
 *  - Residency describes what the deployment actually controls: the database
 *    region. Optional integrations can process outside it.
 */

export const TRUST_LAST_UPDATED = "2026-11-22";

export const SECURITY_CONTACT = "security@herald.app";
export const PRIVACY_CONTACT = "privacy@herald.app";
export const ACCESSIBILITY_CONTACT = "accessibility@herald.app";
export const ACCESSIBILITY_LAST_UPDATED = "2026-11-21";

export type Subprocessor = {
  name: string;
  purpose: string;
  dataCategories: string;
  location: string;
  /** Optional integrations only process data when the workspace enables them. */
  optional: boolean;
  url: string;
};

export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    name: "Vercel Inc.",
    purpose: "Application hosting, edge delivery and request logs",
    dataCategories:
      "Account identifiers, request metadata (IP address, user agent) and customer content in transit",
    location: "United States and Vercel's global edge network",
    optional: false,
    url: "https://vercel.com/legal/privacy-policy",
  },
  {
    name: "Neon Inc.",
    purpose: "Managed PostgreSQL database and backups",
    dataCategories:
      "Workspace, member, customer, feedback, support, billing-reference and audit data",
    location: "United States; the region is selected when the database is created",
    optional: false,
    url: "https://neon.tech/privacy-policy",
  },
  {
    name: "Resend, Inc.",
    purpose: "Transactional email and notification delivery",
    dataCategories: "Recipient address, message content and delivery metadata",
    location: "United States",
    optional: false,
    url: "https://resend.com/legal/privacy-policy",
  },
  {
    name: "Stripe, Inc.",
    purpose: "Subscriptions, invoices and payment processing",
    dataCategories:
      "Billing contact, subscription and invoice metadata; card data is handled by Stripe, not Herald",
    location: "United States",
    optional: false,
    url: "https://stripe.com/privacy",
  },
  {
    name: "PostHog, Inc.",
    purpose:
      "Optional product analytics for public-view and sign-up events, when the deployment configures a PostHog project",
    dataCategories:
      "Pseudonymous event keys (one-way SHA-256 of a day-scoped visitor hash, funnel subject hash or product id), event names and page slugs; no email address, raw account id, visitor IP address or user agent",
    location:
      "United States on PostHog Cloud US; the EU region when the deployment is configured for PostHog Cloud EU",
    optional: true,
    url: "https://posthog.com/privacy",
  },
  {
    name: "Slack Technologies, LLC",
    purpose: "Optional Slack notifications and support mirroring",
    dataCategories:
      "Messages a workspace routes to Herald, Slack user and channel identifiers",
    location: "United States",
    optional: true,
    url: "https://slack.com/trust/privacy/privacy-policy",
  },
  {
    name: "The AI provider configured by the operator",
    purpose: "Optional changelog drafting, Mira answers and feedback suggestions",
    dataCategories:
      "Prompts, selected feedback text and knowledge excerpts sent only when AI features are configured and used",
    location: "Depends on the provider and endpoint the operator configures",
    optional: true,
    url: "",
  },
];

export type SecurityPractice = {
  title: string;
  body: string;
};

export const SECURITY_PRACTICES: readonly SecurityPractice[] = [
  {
    title: "Encryption in transit and at rest",
    body: "Public and authenticated traffic is served over HTTPS. The managed PostgreSQL provider encrypts storage and backups at rest. Session cookies are HttpOnly and SameSite-protected by the auth layer.",
  },
  {
    title: "Secrets and credentials",
    body: "Passwords are stored only as hashes. API tokens and invitation links are stored as SHA-256 hashes, never in plaintext. Customer SSO signing secrets are encrypted with AES-256-GCM under a key derived from the deployment secret.",
  },
  {
    title: "Tenant isolation",
    body: "Every privileged read and write resolves the workspace from the authenticated user's membership before touching data. Workspace and product identifiers supplied by a client are never trusted on their own; cross-tenant joins are rejected in the query layer.",
  },
  {
    title: "Deny-by-default authorization",
    body: "A single permission matrix maps roles to permissions. Server actions, route handlers and background jobs check the permission they need; hiding a button is never treated as authorization. Viewer seats are read/comment-only and cannot author content.",
  },
  {
    title: "Administrative audit trail",
    body: "Workspace administration records actor, action, target and time for membership changes, token creation and revocation, domain changes, privacy changes and deletion requests. Audit history is owner-readable.",
  },
  {
    title: "Data controls",
    body: "Workspaces can export their data, erase a customer's linked data and request workspace deletion. Deletion runs after a 30-day grace period and removes rows through foreign-key cascades; backups age out on the database provider's retention schedule.",
  },
  {
    title: "Incident response",
    body: "Security reports are triaged by the maintainers. Confirmed incidents affecting customer data are communicated to affected workspace owners without undue delay, with the known scope and remediation. There is no 24/7 security operations centre.",
  },
  {
    title: "Vulnerability disclosure",
    body: `Report a suspected vulnerability to ${SECURITY_CONTACT}. Include reproduction steps and the affected URL or version. Please do not access, modify or retain other customers' data while testing.`,
  },
];

export const COMPLIANCE_STATEMENT = {
  soc2:
    "Herald does not currently hold a SOC 2 report and does not claim SOC 2 certification. We commission an independent report only when a signed deal requires one; ask your account contact for the current status before relying on it in procurement.",
  penTest:
    "No third-party penetration-test report is published today. The application is exercised by automated authorization, tenancy and integration tests on every change.",
  gdpr:
    "Herald acts as a processor for customer content and as a controller for its own account and billing records. The DPA below covers processing on a customer's behalf; data-subject requests are handled through the workspace's export and erase controls.",
} as const;

export type LegalSection = {
  title: string;
  paragraphs: readonly string[];
  /** Optional fragment target, used by the privacy policy's cookie link. */
  id?: string | undefined;
};

export const DPA_SECTIONS: readonly LegalSection[] = [
  {
    title: "1. Parties and scope",
    paragraphs: [
      "This Data Processing Agreement (the “DPA”) applies when a customer (“Controller”) uses the Herald hosted service (“Processor”) to process personal data. It forms part of the agreement between the parties and covers all customer content processed to provide the service.",
      "The Controller decides what data is submitted. Herald processes it only to provide, secure and support the service, and does not sell it or use it for advertising.",
    ],
  },
  {
    title: "2. Processing instructions",
    paragraphs: [
      "Herald processes personal data on the Controller's documented instructions: the configuration of the workspace and the features the Controller enables. Herald will not process data for another purpose unless required by law, in which case it will inform the Controller unless the law prohibits that.",
      "The Controller is responsible for having a lawful basis, providing notices to data subjects and ensuring that submitted content is appropriate for the service.",
    ],
  },
  {
    title: "3. Confidentiality and personnel",
    paragraphs: [
      "Access to customer content is limited to personnel who need it to operate, secure or support the service. Those people are bound by confidentiality obligations and access is removed when it is no longer needed.",
      "Support access is initiated in response to a customer request. Herald does not routinely read customer content.",
    ],
  },
  {
    title: "4. Security measures",
    paragraphs: [
      "Herald maintains the technical and organizational measures described on the security page: encrypted transport, provider-managed encryption at rest, hashed credentials, tenant-scoped authorization, least-privilege roles, audit logging and tested data export and erasure controls.",
      "The measures are reviewed as the product changes. A Controller may request the current description before signing.",
    ],
  },
  {
    title: "5. Sub-processors",
    paragraphs: [
      "The Controller authorizes the sub-processors listed on the sub-processor page. The current list names each provider, its purpose, the data categories involved and where it processes data.",
      "Herald will give reasonable advance notice of a new sub-processor that processes customer content and will maintain a mechanism for the Controller to object. A sub-processor is bound by obligations no less protective than this DPA.",
    ],
  },
  {
    title: "6. Data-subject requests",
    paragraphs: [
      "Herald provides workspace export, customer erasure and workspace deletion controls. Where a data subject contacts Herald directly, Herald will refer the request to the Controller unless the law requires otherwise.",
      "Each party assists the other, to a reasonable extent, in responding to access, rectification, erasure, restriction, portability and objection requests.",
    ],
  },
  {
    title: "7. Security incidents",
    paragraphs: [
      "Herald will notify the Controller without undue delay after confirming a personal-data breach, describing the known nature, categories and approximate volume of data, the likely consequences and the measures taken or proposed.",
      "Notification is made to the workspace owner's account address or another contact the Controller nominates. The Controller is responsible for its own regulatory notifications.",
    ],
  },
  {
    title: "8. International transfers",
    paragraphs: [
      "The primary database is created in the region selected at deployment; the hosted default is the United States. Optional email, billing, messaging and AI integrations may process data outside that region, as shown on the sub-processor page.",
      "Where a transfer needs a legal mechanism, the parties will confirm the applicable mechanism in the signed order form. Contact us before relying on a specific transfer mechanism for a regulated workload.",
    ],
  },
  {
    title: "9. Return and deletion",
    paragraphs: [
      "On termination, the Controller may export workspace data through the export control. After the agreed retention period, Herald deletes customer content through the workspace deletion process, except records it must keep for legal, tax, security or billing purposes.",
      "Backups are deleted or overwritten on the database provider's retention schedule. A backup is not used to restore individual customer data on request.",
    ],
  },
  {
    title: "10. Audits and liability",
    paragraphs: [
      "Herald will answer reasonable security questionnaires and provide the published security materials. An on-site audit requires a signed order form, reasonable notice, confidentiality obligations and a scope that does not expose other customers' data.",
      "Liability under this DPA is subject to the limitations in the main agreement. If a provision of this DPA conflicts with the main agreement on data protection, this DPA controls.",
    ],
  },
];

export const PRIVACY_SECTIONS: readonly LegalSection[] = [
  {
    title: "1. Who is responsible",
    paragraphs: [
      "Herald is the controller for the account, billing and website records it creates when you sign up, and for its own support conversations. For the feedback, help content, customer records and messages a workspace stores, the workspace owner is the controller and Herald is the processor. The DPA and sub-processor pages describe that processing relationship.",
      "This policy covers the hosted Herald service and this marketing site. A self-hosted deployment is operated by whoever deploys it; that operator must publish its own privacy notice.",
    ],
  },
  {
    title: "2. Data we collect",
    paragraphs: [
      "Account data: name, email address, workspace and product names, role, authentication events and security settings. If a workspace uses single sign-on or SCIM, the identity provider supplies the profile fields the workspace chooses to share.",
      "Customer content: feedback requests, votes, comments, reactions, help articles, changelog entries, survey or message content, attachments and the customer traits a workspace chooses to store. Workspaces decide what to collect and are responsible for having a lawful basis for it.",
      "Billing data: plan, subscription status, invoices, tax identifiers and the last four digits of a payment method. Card details are entered directly with Stripe and are not stored by Herald.",
      "Usage and device data: pages viewed on the public surface, coarse request metadata and a day-scoped one-way visitor hash used to count unique views. Public view analytics never stores an IP address, user agent, email address or customer identifier. When the deployment configures a PostHog project, those same pseudonymous events are forwarded from our servers to PostHog, our analytics processor; no analytics script runs in your browser. Authenticated dashboard activity is recorded for security and audit purposes, not for advertising.",
      "Communications: support messages, security reports and email preferences. Transactional email is delivered through Resend; product-update and win-back messages are sent only under the preferences described on the preference page.",
    ],
  },
  {
    title: "3. Why we use it",
    paragraphs: [
      "We process account and billing data to perform the contract with the workspace, including providing the service, authenticating users, metering plan limits, invoicing and responding to support requests.",
      "We process security and audit records, and limited product analytics, for our legitimate interest in keeping the service reliable and preventing abuse. Optional public-view analytics, including the events forwarded to PostHog, is used only as permitted by the choice described below. We process data to meet legal, tax and accounting obligations where those apply.",
      "We do not sell personal data, use it for cross-site advertising, or use customer content to train a general-purpose model. Optional AI features send only the content selected for that feature to the provider the workspace configures.",
    ],
  },
  {
    id: "cookies",
    title: "4. Cookies and your choice",
    paragraphs: [
      "Essential cookies keep you signed in, protect forms against cross-site requests, remember a language choice and store this consent decision. They are required for the service to work and cannot be switched off from the banner.",
      "Optional analytics records public page views with the hashed, day-scoped key described above. Those events are stored in Herald and, when the deployment configures a PostHog project, forwarded from our servers to PostHog, our analytics processor, under a pseudonymous key; no PostHog script runs in your browser and no PostHog cookie or device identifier is created. In the EU/EEA, the UK, Switzerland and similar jurisdictions it is off until you choose “Accept all”. Elsewhere it may be on by default, and “Essential only” turns it off. Optional YouTube embeds always wait for an explicit action, because loading the player lets YouTube receive your IP address and set its own cookies. Herald does not include advertising or cross-site tracking cookies.",
      "The choice is stored in the first-party `herald_consent` cookie for 180 days. It contains only the analytics and embed permissions, a format version and the time of the decision. Use “Cookie settings” in the footer or public header to change it, or clear the cookie in your browser. Clearing it restores the jurisdiction default and the banner.",
    ],
  },
  {
    title: "5. Sharing and sub-processors",
    paragraphs: [
      "We share data with the infrastructure providers needed to run the service: hosting and edge delivery, the managed PostgreSQL database, transactional email, payment processing and, when the deployment configures it, product analytics. Optional Slack and AI providers receive data only when a workspace enables and uses those integrations. The analytics processor receives only the pseudonymous public-view and sign-up events described above.",
      "The sub-processor page names each provider, its purpose, the categories of data involved and where it processes data. A provider receives only what is needed for its function, and card data is handled by Stripe rather than Herald.",
      "We may disclose data when required by law, to protect the service or its users, or as part of a merger or acquisition. We will give notice where the law allows it, and a successor remains bound by this policy for data it receives.",
    ],
  },
  {
    title: "6. Retention",
    paragraphs: [
      "Account, workspace and customer content is kept while the workspace is active. A deleted workspace enters a 30-day grace period, after which rows are removed through foreign-key cascades. Backups age out on the database provider's retention schedule and are not used to restore individual customer data on request.",
      "Billing and tax records are kept for the period required by accounting law. Security and audit records are kept long enough to investigate incidents and demonstrate compliance. Optional analytics events retain only the day-scoped visitor hash and request context; they are not linked to a stored visitor identifier. Forwarded copies keep the same pseudonymous keys for the retention period configured on the analytics project.",
    ],
  },
  {
    title: "7. Security and international transfers",
    paragraphs: [
      "Traffic is served over HTTPS, database storage and backups are encrypted by the provider, credentials are hashed and tenant access is checked on every privileged read and write. The security page describes these measures and how to report a vulnerability.",
      "The primary database is created in the region selected at deployment; the hosted default is the United States. Email, billing, the analytics processor and optional integrations may process data outside that region, as listed on the sub-processor page. Where a transfer needs a legal mechanism, it is confirmed in the signed order form.",
    ],
  },
  {
    title: "8. Your rights and choices",
    paragraphs: [
      "Depending on where you live, you may request access to your personal data, correction, deletion, restriction, portability or objection to processing, and you may withdraw consent for optional cookies at any time. Withdrawing consent does not affect processing that happened before the withdrawal.",
      "Workspace owners can export workspace data, erase a linked customer's data and delete the workspace from the dashboard. If your data was submitted to a workspace, contact that workspace first; Herald will refer a request it receives to the controller unless the law requires otherwise. You can also contact privacy@herald.app.",
      "You may complain to your local data-protection authority. We will not discriminate against you for exercising a privacy right.",
    ],
  },
  {
    title: "9. Children and changes",
    paragraphs: [
      "The service is intended for businesses and is not directed to children under 16. A workspace should not submit a child's personal data unless it has a lawful basis and the appropriate safeguards.",
      "We may update this policy when the service or the law changes. The updated date appears on every trust page, and a material change will be announced to workspace owners before it takes effect. Continuing to use the service after that date means the updated policy applies.",
    ],
  },
];

export const TERMS_SECTIONS: readonly LegalSection[] = [
  {
    title: "1. The agreement",
    paragraphs: [
      "These terms govern the hosted Herald service and this website. By creating a workspace, buying a plan or using the service, you agree to them on behalf of yourself and the organization you represent. If you do not have authority to bind that organization, do not use the service.",
      "A signed order form, enterprise agreement or written amendment controls over these terms where they conflict. The DPA applies to personal data processed on a customer's behalf. This published text is a template for review, not legal advice.",
    ],
  },
  {
    title: "2. Accounts and workspace security",
    paragraphs: [
      "You must provide accurate account information, keep access credentials confidential and tell us promptly about suspected unauthorized access. A workspace owner controls membership, roles and integrations. Actions taken by a member under their own credentials are treated as actions of the workspace.",
      "You are responsible for the content your workspace publishes, the notices it gives to its customers and the permissions it obtains. Do not share an account in a way that defeats seat limits or audit records.",
    ],
  },
  {
    title: "3. Plans, billing and refunds",
    paragraphs: [
      "Plans, included limits and overage prices are shown at checkout and in the plan catalogue. Subscriptions renew until cancelled. You authorize recurring charges to the payment method on file, and you can cancel from the billing settings; cancellation stops the next renewal and does not by itself refund the current period.",
      "Fees are exclusive of taxes unless stated otherwise. Failed payments may lead to suspension after notice. The Founding Lifetime offer is governed by its own terms, including its one-time price, eligibility, allowances and 30-day refund window. Except where required by law or expressly stated, payments are non-refundable.",
    ],
  },
  {
    title: "4. Customer content and permissions",
    paragraphs: [
      "You retain ownership of the content your workspace and its customers submit. You grant Herald a limited licence to host, copy, transmit, display and process that content only to provide, secure and support the service, and to comply with law. This licence ends when the content is deleted, except for backups that age out on the provider's schedule.",
      "You confirm that you have the rights and notices needed to submit the content, including any customer personal data, and that publishing it on a public board is intended. Herald does not routinely read customer content; support access is initiated in response to a request.",
    ],
  },
  {
    title: "5. Acceptable use",
    paragraphs: [
      "Do not use the service to break the law, infringe intellectual property, distribute malware, send spam, harass people, evade access controls or interfere with another customer's use. Do not attempt to extract data you are not authorized to see, probe the service for vulnerabilities without following the disclosure policy, or resell the service unless an agreement permits it.",
      "Do not upload content that is illegal, exploitative or designed to cause harm. We may remove content or suspend a workspace that creates a security, legal or operational risk, and will explain the reason where it is safe to do so.",
    ],
  },
  {
    title: "6. Third-party services",
    paragraphs: [
      "Optional integrations such as Slack, single sign-on, custom domains, email delivery, payments and AI providers are governed by their own terms and privacy notices. Enabling an integration authorizes Herald to send the selected data to that provider. Disabling it stops new processing but does not recall data already delivered.",
      "We are not responsible for a third party's availability, security or acts, but we choose providers with appropriate safeguards and list the ones that can process customer data on the sub-processor page.",
    ],
  },
  {
    title: "7. Our intellectual property",
    paragraphs: [
      "Herald owns the service, its software, design, documentation and trademarks, excluding customer content and third-party materials. These terms grant a limited, non-exclusive, non-transferable right to use the service during the subscription. They do not grant a right to copy, modify, reverse engineer or create a competing service from Herald's code except as the licence for any open-source component permits.",
      "Feedback you send about the product may be used to improve it without obligation, but we will not publish your name or workspace without permission.",
    ],
  },
  {
    title: "8. Availability, changes and support",
    paragraphs: [
      "We work to keep the service available and publish current status at /status. Unless a signed order form includes a service-level commitment, the service is provided without a guaranteed uptime, and planned maintenance may interrupt it. Support is provided through the channels shown in the product; response times are not guaranteed unless agreed in writing.",
      "We may change features to improve security, reliability or the product. We will give reasonable notice of a change that materially reduces a paid feature, and you may cancel before the next renewal if the change is unacceptable.",
    ],
  },
  {
    title: "9. Suspension and termination",
    paragraphs: [
      "You may stop using the service at any time and may export workspace data before deletion. We may suspend or terminate access for material breach, non-payment, a legal requirement or a security risk. Where practicable, we will give notice and a chance to cure the breach.",
      "After termination, the workspace enters the deletion process described in the privacy policy. We may keep records required for legal, tax, security or billing purposes. Sections that by their nature should survive termination, including payment, intellectual property, disclaimers and liability, continue to apply.",
    ],
  },
  {
    title: "10. Disclaimers and liability",
    paragraphs: [
      "To the maximum extent permitted by law, the service is provided “as is” and Herald disclaims implied warranties of merchantability, fitness for a particular purpose and non-infringement. We do not warrant that the service will be uninterrupted, error-free or that every integration will remain available.",
      "To the maximum extent permitted by law, neither party is liable for indirect, incidental, special or consequential damages, lost profits or lost data. Herald's aggregate liability arising from the service is limited to the fees paid for the twelve months before the event giving rise to the claim. These limits do not apply to fraud, wilful misconduct, or liability that cannot be limited by law.",
    ],
  },
  {
    title: "11. Governing law and contact",
    paragraphs: [
      "The governing law, venue and any dispute-resolution process are stated in the signed order form. If no order form states them, the laws of the jurisdiction where the Herald entity contracting with you is established apply, without regard to conflict-of-law rules. Before filing a claim, contact us so we can try to resolve the issue.",
      "Questions about these terms: support@herald.app. Privacy questions: privacy@herald.app. Security reports: security@herald.app. We may update these terms and will post the updated date; a material change will be announced to workspace owners before it takes effect.",
    ],
  },
];

export const RESIDENCY_FACTS: readonly SecurityPractice[] = [
  {
    title: "Primary storage",
    body: "Workspace and customer content is stored in the PostgreSQL database configured for the deployment. The database region is selected when that database is created; changing it requires a migration to a new database in the target region.",
  },
  {
    title: "Backups",
    body: "Database backups are managed by the database provider and stay in the provider's configured region. Backup retention is an operator setting, not a per-workspace choice.",
  },
  {
    title: "Email and billing",
    body: "Transactional email is delivered through Resend and billing through Stripe. Both process recipient and billing metadata in the United States, outside the customer's database region.",
  },
  {
    title: "Optional integrations",
    body: "Slack and the AI provider are used only when a workspace enables them. Enabling them sends the selected content to that provider's region. Disabling the integration stops new processing but does not recall data already delivered.",
  },
  {
    title: "Regional commitments",
    body: "A dedicated region or an EU-only stack is not offered today. Residency requirements are reviewed case by case before a contract is signed; do not assume a regional guarantee that is not written into the order form.",
  },
  {
    title: "Sub-processor locations",
    body: "The sub-processor page lists the current providers and locations. It is updated when the deployment's providers change, and the update date is shown on every trust page.",
  },
];
