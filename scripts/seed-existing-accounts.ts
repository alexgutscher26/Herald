/**
 * Seed workspaces with idempotent demo data for all Herald surfaces.
 *
 * Surfaces seeded:
 * - Releases / Changelog (with markdown bodies, tags, categories, published history)
 * - Feedback boards & posts (triage, status lifecycle, upvotes, comments)
 * - Roadmap (Planned, In Progress, Shipped columns connected to feedback and releases)
 * - Support Inbox & Conversations (customer questions, team replies, internal notes)
 * - Customers & Subscribers (active subscribers with email notification preferences)
 * - Help Center (collections, published articles, Mira knowledge sources)
 * - Customer Engagement (NPS survey + responses, widget product tour + banner)
 * - API Documentation (OpenAPI 3.1 schema + published version for interactive playground)
 * - Analytics Daily rollups (14-day history for board views, votes, time-to-ship, etc.)
 *
 * Usage:
 *   bun run db:seed-demo
 *   bun run db:seed
 *   bun run db:seed-demo --workspace test12
 *   bun run db:seed-demo --workspace changelog
 *   bun run db:seed-demo --product changelog
 *   bun run db:seed-demo --all
 *   bun run db:seed-demo --all --dry-run
 *
 * Refuses NODE_ENV=production and a non-loopback DATABASE_URL without
 * --allow-remote. It is a demo-data writer, never a production operation.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";

import { closeDb, db } from "@/db";
import {
  analyticsDaily,
  apiDocs,
  boards,
  conversationMessages,
  conversations,
  customers,
  feedbackComments,
  feedbackPosts,
  helpCollections,
  knowledgeSources,
  products,
  releaseAuthors,
  releaseFeedbackLinks,
  releaseTagLinks,
  releaseTags,
  releases,
  subscribers,
  surveyResponses,
  surveys,
  widgetExperienceCompletions,
  widgetExperienceDismissals,
  widgetExperiences,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { ANALYTICS_METRICS } from "@/features/analytics/rollup";
import { importApiDocVersion, publishApiDocVersion } from "@/features/api-docs/service";
import { createExperience, createSurvey } from "@/features/engagement/service";
import {
  createHelpArticle,
  createHelpCollection,
  setHelpArticleStatus,
} from "@/features/help/service";
import { normalizeReleaseTags } from "@/features/releases/tags";
import { normalizeEmail } from "@/lib/email";

import { assertScriptEnvironment } from "./lib/guard";

assertScriptEnvironment("seed-existing-accounts");

const HELP_COLLECTION_SLUG = "herald-demo-getting-started";
const SURVEY_SLUG = "herald-demo-nps";
const API_DOC_SLUG = "herald-demo-api";
const TOUR_NAME = "Herald demo product tour";
const BANNER_NAME = "Herald demo banner";

const DEMO_HELP_ARTICLES = [
  {
    slug: "invite-teammates",
    title: "How do I invite a teammate?",
    body: "Open Settings → Members, choose Invite teammate, and enter their email address. They receive an invitation link that expires in seven days. Owners and admins can invite people; editors and viewers can use the workspace but cannot manage members.",
  },
  {
    slug: "export-workspace-data",
    title: "How do I export workspace data?",
    body: "Open Settings → Data controls and choose Export workspace. Herald prepares a JSON export of your workspace, products, releases and feedback records. The export is scoped to the signed-in workspace and never includes another tenant's data.",
  },
  {
    slug: "widget-installation-guide",
    title: "How do I install the in-app feedback widget?",
    body: "Navigate to Settings → Widget. Add your domain to the Allowed Origins list, copy the embed snippet, and paste it before the closing `</body>` tag on your website or web app. You can customize the launcher position, theme, and brand color directly from the settings panel.",
  },
];

const OPENAPI_DOCUMENT = {
  openapi: "3.1.0",
  info: {
    title: "Herald demo API",
    version: "1.0.0",
    description: "A small example API used to exercise the documentation playground.",
  },
  servers: [{ url: "https://app.example.com" }],
  paths: {
    "/api/v1/requests": {
      get: {
        operationId: "listRequests",
        summary: "List feedback requests",
        responses: { "200": { description: "A page of requests" } },
      },
      post: {
        operationId: "createRequest",
        summary: "Create a feedback request",
        responses: { "201": { description: "The created request" } },
      },
    },
    "/api/v1/releases": {
      get: {
        operationId: "listReleases",
        summary: "List published changelog releases",
        responses: { "200": { description: "A page of releases" } },
      },
    },
  },
};

const DEMO_CUSTOMERS = [
  { name: "Sarah Chen", email: "sarah.chen@demo.herald.test" },
  { name: "Marcus Vance", email: "marcus.vance@demo.herald.test" },
  { name: "Elena Rostova", email: "elena.rostova@demo.herald.test" },
  { name: "Liam O'Connor", email: "liam.oc@demo.herald.test" },
];

const DEMO_FEEDBACK = [
  {
    title: "Herald demo: Dark mode for customer portal and widget",
    body: "Please support a high-contrast dark theme for embedded feedback widgets and the public changelog portal so it matches dark-themed websites seamlessly.",
    category: "feature_request" as const,
    status: "in_progress" as const,
    votes: 34,
    customerIdx: 0,
  },
  {
    title: "Herald demo: Export analytics metrics to CSV / Excel",
    body: "We need an automated way to export 30-day analytics rollups (page views, votes, time-to-ship, feedback submitted) into spreadsheet format for executive reviews.",
    category: "improvement" as const,
    status: "planned" as const,
    votes: 26,
    customerIdx: 1,
  },
  {
    title: "Herald demo: Slack notifications when new feedback is submitted",
    body: "Post an instant Slack message to our #product-feedback channel whenever a user submits an idea, with buttons to triage, resolve, or assign directly.",
    category: "feature_request" as const,
    status: "shipped" as const,
    votes: 42,
    customerIdx: 2,
  },
  {
    title: "Herald demo: Keyboard navigation shortcuts on triage table",
    body: "Add j/k navigation and quick hotkeys (like / for search, s for status, a for assign) to quickly triage dozen of incoming requests every morning.",
    category: "improvement" as const,
    status: "shipped" as const,
    votes: 19,
    customerIdx: 3,
  },
  {
    title: "Herald demo: Custom CNAME domain for public feedback board",
    body: "Allow pointing feedback.ourcompany.com to our Herald portal with automatic SSL certificate provisioning and white-label branding.",
    category: "feature_request" as const,
    status: "under_review" as const,
    votes: 15,
    customerIdx: 0,
  },
  {
    title: "Herald demo: Discord webhook for community ideas",
    body: "Send new community posts to Discord channels via custom webhooks with embed formatting.",
    category: "feature_request" as const,
    status: "open" as const,
    votes: 9,
    customerIdx: 1,
  },
  {
    title: "Herald demo: Mobile viewport layout padding in roadmap view",
    body: "On smaller mobile screens, the column cards occasionally touch the edge of the viewport without the 16px safety padding.",
    category: "bug" as const,
    status: "open" as const,
    votes: 4,
    customerIdx: 2,
  },
];

const DEMO_RELEASES = [
  {
    title: "Herald demo: v2.4 — Unified Customer Portal & Global Search",
    slug: "herald-demo-v2-4",
    version: "2.4.0",
    category: "feature" as const,
    daysAgo: 3,
    summary: "Search across help articles, feedback boards, and changelog updates in one lightning-fast command palette.",
    bodyMarkdown: `### Unified Customer Portal

We are excited to introduce unified global search across your entire public product portal.

- **Instant search index**: Help documents, changelog releases, and public feedback requests are indexed in real-time.
- **Keyboard navigation**: Open global search anywhere using \`Cmd+K\` or \`Ctrl+K\`.
- **Deep links & filters**: Jump directly into resolved conversations, relevant help guides, or linked release notes.

### Other Improvements
- Faster initial widget render time with optimistic layout caching.
- Enhanced WCAG 2.2 focus rings across all interactive controls.`,
    coverPreset: "grid" as const,
    tagNames: ["Portal", "Search"],
    shippedFeedbackTitle: null,
  },
  {
    title: "Herald demo: v2.3 — Slack Notifications & Realtime Webhooks",
    slug: "herald-demo-v2-3",
    version: "2.3.0",
    category: "feature" as const,
    daysAgo: 14,
    summary: "Deliver instant notifications to your product channels and subscribe external services with HMAC-signed webhooks.",
    bodyMarkdown: `### Realtime Webhooks & Slack

Stay connected with your community without context-switching.

- **Slack channel alerts**: Pipe new feedback submissions, survey responses, and customer support threads into dedicated Slack channels.
- **HMAC signed webhooks**: Secure endpoints with timestamped SHA-256 signatures and exponential backoff retry policies.
- **Triage buttons**: Review and assign requests straight from Slack notifications.`,
    coverPreset: "orbit" as const,
    tagNames: ["Slack", "Integrations"],
    shippedFeedbackTitle: "Herald demo: Slack notifications when new feedback is submitted",
  },
  {
    title: "Herald demo: v2.2 — Keyboard Shortcuts & Dark Theme",
    slug: "herald-demo-v2-2",
    version: "2.2.0",
    category: "improvement" as const,
    daysAgo: 28,
    summary: "Speed up daily triage with single-key navigation and customize appearances with automatic theme detection.",
    bodyMarkdown: `### Power User Keyboard Navigation

Triage dozens of incoming feedback posts in minutes with dedicated single-key hotkeys.

- \`j\` / \`k\`: Move up and down through the request table.
- \`x\`: Select and toggle batch actions.
- \`/\`: Focus search filter.
- \`?\`: View keyboard shortcut cheat sheet.

### Dark Theme
Enjoy automatic dark mode matching your operating system preferences across the dashboard and widget.`,
    coverPreset: "waves" as const,
    tagNames: ["UX", "Productivity"],
    shippedFeedbackTitle: "Herald demo: Keyboard navigation shortcuts on triage table",
  },
  {
    title: "Herald demo: v2.1 — Custom CNAME Domains & Fast SSO",
    slug: "herald-demo-v2-1",
    version: "2.1.0",
    category: "fix" as const,
    daysAgo: 45,
    summary: "Enterprise-grade identity federation with SAML/OIDC and custom subdomain routing with zero SSL hassle.",
    bodyMarkdown: `### Custom Domains & Enterprise SSO

Bring your brand to every customer touchpoint.

- Host your portal at \`updates.yourdomain.com\` with automated Let's Encrypt SSL issuance.
- Enforce single sign-on using Okta, Azure AD, or Google Workspace via Better Auth SSO.
- SCIM directory synchronization for automated member deprovisioning.`,
    coverPreset: "plain" as const,
    tagNames: ["Enterprise", "Security"],
    shippedFeedbackTitle: null,
  },
];

type Account = {
  workspaceId: string;
  workspaceSlug: string;
  productId: string;
  productSlug: string;
  productName: string;
};

type SeedResult = {
  account: Account;
  releases: number;
  feedbackPosts: number;
  customers: number;
  subscribers: number;
  conversations: number;
  helpArticles: number;
  surveyResponses: number;
  tourCompletions: number;
  warnings: string[];
};

function reviewerId(
  members: { userId: string; role: "owner" | "admin" | "editor" | "viewer" }[],
): string | null {
  return (
    members.find((member) => member.role === "owner")?.userId ??
    members.find((member) => member.role === "admin")?.userId ??
    members[0]?.userId ??
    null
  );
}

async function cleanDemoRows(productId: string, workspaceId: string): Promise<void> {
  // 1. Help collections & knowledge sources
  const collections = await db
    .select({ id: helpCollections.id })
    .from(helpCollections)
    .where(
      and(
        eq(helpCollections.productId, productId),
        eq(helpCollections.slug, HELP_COLLECTION_SLUG),
      ),
    );

  if (collections.length > 0) {
    const collectionIds = collections.map((collection) => collection.id);
    await db
      .delete(knowledgeSources)
      .where(
        and(
          eq(knowledgeSources.productId, productId),
          eq(knowledgeSources.kind, "help_collection"),
          inArray(knowledgeSources.originId, collectionIds),
        ),
      );
    await db.delete(helpCollections).where(inArray(helpCollections.id, collectionIds));
  }

  // 2. Surveys
  await db
    .delete(surveys)
    .where(and(eq(surveys.productId, productId), eq(surveys.slug, SURVEY_SLUG)));

  // 3. Widget experiences
  await db
    .delete(widgetExperiences)
    .where(
      and(
        eq(widgetExperiences.productId, productId),
        inArray(widgetExperiences.name, [TOUR_NAME, BANNER_NAME]),
      ),
    );

  // 4. API docs
  await db
    .delete(apiDocs)
    .where(and(eq(apiDocs.productId, productId), eq(apiDocs.slug, API_DOC_SLUG)));

  // 5. Releases (cascade deletes authors, feedback links, tag links)
  await db
    .delete(releases)
    .where(
      and(
        eq(releases.productId, productId),
        ilike(releases.slug, "herald-demo-%"),
      ),
    );

  // 6. Conversations (cascade deletes messages)
  await db
    .delete(conversations)
    .where(
      and(
        eq(conversations.productId, productId),
        ilike(conversations.subject, "Herald demo:%"),
      ),
    );

  // 7. Feedback posts (cascade deletes votes, comments, history)
  await db
    .delete(feedbackPosts)
    .where(
      and(
        eq(feedbackPosts.productId, productId),
        ilike(feedbackPosts.title, "Herald demo:%"),
      ),
    );

  // 8. Demo subscribers and customers
  await db
    .delete(subscribers)
    .where(
      and(
        eq(subscribers.productId, productId),
        ilike(subscribers.emailNormalized, "%@demo.herald.test"),
      ),
    );

  await db
    .delete(customers)
    .where(
      and(
        eq(customers.workspaceId, workspaceId),
        ilike(customers.emailNormalized, "%@demo.herald.test"),
      ),
    );

  // 9. Analytics daily rollup demo rows
  await db
    .delete(analyticsDaily)
    .where(
      and(
        eq(analyticsDaily.productId, productId),
        inArray(analyticsDaily.metric, [...ANALYTICS_METRICS]),
      ),
    );
}

async function seedAccount(account: Account): Promise<SeedResult> {
  const warnings: string[] = [];
  await cleanDemoRows(account.productId, account.workspaceId);

  const members = await db
    .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, account.workspaceId));
  const userId = reviewerId(members);

  // 1. Ensure a default Board exists for feedback
  const existingBoards = await db
    .select({ id: boards.id })
    .from(boards)
    .where(eq(boards.productId, account.productId))
    .limit(1);

  let boardId = existingBoards[0]?.id;
  if (!boardId) {
    const [createdBoard] = await db
      .insert(boards)
      .values({
        productId: account.productId,
        name: "Feedback",
        slug: "feedback",
        visibility: "public",
        guestPosting: true,
      })
      .returning({ id: boards.id });
    if (createdBoard) boardId = createdBoard.id;
  }

  // 2. Seed Demo Customers
  const insertedCustomers = await db
    .insert(customers)
    .values(
      DEMO_CUSTOMERS.map((cust) => ({
        workspaceId: account.workspaceId,
        name: cust.name,
        email: cust.email,
        emailNormalized: normalizeEmail(cust.email),
        verifiedAt: new Date(),
      })),
    )
    .returning({ id: customers.id, name: customers.name, email: customers.email });

  // 3. Seed Demo Subscribers
  const insertedSubscribers = await db
    .insert(subscribers)
    .values(
      insertedCustomers.map((cust) => ({
        productId: account.productId,
        email: cust.email!,
        emailNormalized: normalizeEmail(cust.email!),
        name: cust.name,
        customerId: cust.id,
        status: "active" as const,
        source: "manual" as const,
        unsubscribeToken: randomUUID(),
        notifyStatusChanges: true,
        notifyReplies: true,
        weeklyDigest: false,
      })),
    )
    .returning({ id: subscribers.id });

  // 4. Seed Help Center
  let helpArticlesCount = 0;
  if (userId) {
    const collection = await createHelpCollection({
      workspaceId: account.workspaceId,
      productId: account.productId,
      userId,
      name: "Herald demo help",
      slug: HELP_COLLECTION_SLUG,
      description: "Demo articles for exercising the help center and Mira citations.",
      visibility: "public",
    });
    if (!collection.ok || !collection.id) {
      throw new Error(collection.ok ? "Help collection returned no id." : collection.error);
    }

    for (const article of DEMO_HELP_ARTICLES) {
      const created = await createHelpArticle({
        workspaceId: account.workspaceId,
        productId: account.productId,
        userId,
        collectionId: collection.id,
        title: article.title,
        slug: article.slug,
        body: article.body,
        visibility: "public",
      });
      if (!created.ok || !created.id) {
        throw new Error(created.ok ? "Help article returned no id." : created.error);
      }

      const published = await setHelpArticleStatus({
        workspaceId: account.workspaceId,
        productId: account.productId,
        articleId: created.id,
        published: true,
      });
      if (!published.ok) throw new Error(published.error);
      if (published.warning) warnings.push(published.warning);
      helpArticlesCount += 1;
    }
  } else {
    warnings.push("No workspace member found; skipped help center and API docs.");
  }

  // 5. Seed Feedback Posts
  const feedbackByTitle = new Map<string, string>();
  for (const item of DEMO_FEEDBACK) {
    const authorCust = insertedCustomers[item.customerIdx] ?? insertedCustomers[0];
    const [post] = await db
      .insert(feedbackPosts)
      .values({
        productId: account.productId,
        boardId: boardId ?? null,
        title: item.title,
        body: item.body,
        category: item.category,
        status: item.status,
        authorCustomerId: authorCust?.id ?? null,
        authorLabel: authorCust?.name ?? "Customer",
        authorEmail: authorCust?.email ?? null,
        importedVoteCount: item.votes,
        source: "in_app",
        privacy: "public",
      })
      .returning({ id: feedbackPosts.id, title: feedbackPosts.title });

    if (post) {
      feedbackByTitle.set(post.title, post.id);

      // Add a demo comment for engagement
      if (item.status === "shipped" && userId) {
        await db.insert(feedbackComments).values({
          productId: account.productId,
          feedbackPostId: post.id,
          authorId: userId,
          authorName: "Team",
          authorType: "team",
          body: "This feature has now been fully shipped! Check our latest changelog release for complete details.",
          internal: false,
          privacy: "public",
        });
      } else if (item.status === "in_progress" && authorCust) {
        await db.insert(feedbackComments).values({
          productId: account.productId,
          feedbackPostId: post.id,
          authorCustomerId: authorCust.id,
          authorName: authorCust.name ?? "Customer",
          authorType: "customer",
          body: "Excited to see this in development! Let us know if you need early beta testers.",
          internal: false,
          privacy: "public",
        });
      }
    }
  }

  // 6. Seed Releases (Changelog)
  let releasesCount = 0;
  for (const r of DEMO_RELEASES) {
    const publishedAt = new Date(Date.now() - r.daysAgo * 86_400_000);
    const [release] = await db
      .insert(releases)
      .values({
        productId: account.productId,
        title: r.title,
        slug: r.slug,
        version: r.version,
        category: r.category,
        summary: r.summary,
        bodyMarkdown: r.bodyMarkdown,
        status: "published",
        cover: { kind: "preset", preset: r.coverPreset },
        channelPublicChangelog: true,
        channelInAppWidget: true,
        channelSubscriberEmail: true,
        publishedAt,
        authorId: userId,
        createdAt: publishedAt,
        updatedAt: publishedAt,
      })
      .returning({ id: releases.id });

    if (release) {
      releasesCount += 1;

      // Link author
      if (userId) {
        await db
          .insert(releaseAuthors)
          .values({
            releaseId: release.id,
            productId: account.productId,
            userId,
            position: 0,
          })
          .onConflictDoNothing();
      }

      // Link tags
      const tags = normalizeReleaseTags(r.tagNames);
      if (tags.length > 0) {
        await db
          .insert(releaseTags)
          .values(tags.map((tag) => ({ productId: account.productId, name: tag.name, slug: tag.slug })))
          .onConflictDoNothing();

        const storedTags = await db
          .select({ id: releaseTags.id, slug: releaseTags.slug })
          .from(releaseTags)
          .where(eq(releaseTags.productId, account.productId));

        const idBySlug = new Map(storedTags.map((tag) => [tag.slug, tag.id]));
        await db
          .insert(releaseTagLinks)
          .values(
            tags.flatMap((tag) => {
              const tagId = idBySlug.get(tag.slug);
              return tagId ? [{ releaseId: release.id, tagId, productId: account.productId }] : [];
            }),
          )
          .onConflictDoNothing();
      }

      // Link shipped feedback post
      if (r.shippedFeedbackTitle) {
        const linkedPostId = feedbackByTitle.get(r.shippedFeedbackTitle);
        if (linkedPostId) {
          await db
            .insert(releaseFeedbackLinks)
            .values({
              productId: account.productId,
              releaseId: release.id,
              feedbackPostId: linkedPostId,
            })
            .onConflictDoNothing();
        }
      }
    }
  }

  // 7. Seed Customer Conversations (Support Inbox)
  type DemoMessage = {
    authorType: "customer" | "team";
    channel: "widget" | "email" | "team";
    kind?: "message" | "note";
    body: string;
  };

  const demoConversations: {
    subject: string;
    status: "queue" | "open" | "resolved";
    customerIdx: number;
    unreadForTeam: number;
    csatRating?: number;
    messages: DemoMessage[];
  }[] = [
    {
      subject: "Herald demo: Question about OpenAPI playground",
      status: "queue",
      customerIdx: 0,
      unreadForTeam: 1,
      messages: [
        {
          authorType: "customer",
          channel: "widget",
          body: "Hi team! We're exploring the API playground. Does the interactive documentation support bearer tokens with custom prefixes or test scopes?",
        },
      ],
    },
    {
      subject: "Herald demo: Feedback widget custom CSS styling",
      status: "open",
      customerIdx: 1,
      unreadForTeam: 0,
      messages: [
        {
          authorType: "customer",
          channel: "widget",
          body: "Hello! We love the new embed widget. Can we configure the primary accent color and border radius to match our company design tokens?",
        },
        {
          authorType: "team",
          channel: "team",
          body: "Hi Marcus! Absolutely. You can set your brand color in Settings → Branding, or override the CSS custom properties directly in your stylesheet.",
        },
        {
          authorType: "team",
          channel: "team",
          kind: "note",
          body: "Customer is exploring widget deployment; follow up if they need custom CSS injection assistance.",
        },
      ],
    },
    {
      subject: "Herald demo: Webhook retry schedule and timeout",
      status: "resolved",
      customerIdx: 2,
      unreadForTeam: 0,
      csatRating: 5,
      messages: [
        {
          authorType: "customer",
          channel: "email",
          body: "Could you clarify what the retry schedule is when our webhook receiving endpoint returns 503?",
        },
        {
          authorType: "team",
          channel: "team",
          body: "Hi Elena! Webhooks use exponential backoff: 1s, 5s, 30s, 5m, and 1h with up to 5 attempts. A delivery is marked successful on any 2xx response.",
        },
      ],
    },
  ];

  let conversationsCount = 0;
  for (const convDef of demoConversations) {
    const cust = insertedCustomers[convDef.customerIdx] ?? insertedCustomers[0];
    if (!cust) continue;

    const resolvedTime = convDef.status === "resolved" ? new Date(Date.now() - 86_400_000) : null;
    const [conv] = await db
      .insert(conversations)
      .values({
        workspaceId: account.workspaceId,
        productId: account.productId,
        customerId: cust.id,
        assigneeId: userId,
        status: convDef.status,
        subject: convDef.subject,
        replyToken: randomUUID().replace(/-/g, "").slice(0, 24),
        unreadForTeam: convDef.unreadForTeam,
        unreadForCustomer: 0,
        lastMessagePreview: convDef.messages[convDef.messages.length - 1]?.body.slice(0, 160) ?? "",
        lastMessageAt: new Date(),
        lastCustomerMessageAt: new Date(),
        csatRequestedAt: resolvedTime,
        csatRating: convDef.csatRating ?? null,
        csatRatedAt: resolvedTime,
        resolvedAt: resolvedTime,
      })
      .returning({ id: conversations.id });

    if (conv) {
      conversationsCount += 1;
      for (const msg of convDef.messages) {
        await db.insert(conversationMessages).values({
          conversationId: conv.id,
          productId: account.productId,
          authorType: msg.authorType,
          authorUserId: msg.authorType === "team" ? userId : null,
          authorCustomerId: msg.authorType === "customer" ? cust.id : null,
          kind: msg.kind ?? "message",
          channel: msg.channel ?? "team",
          body: msg.body,
        });
      }
    }
  }

  // 8. Seed NPS Survey & Responses
  const survey = await createSurvey({
    workspaceId: account.workspaceId,
    productId: account.productId,
    name: "Herald demo NPS",
    slug: SURVEY_SLUG,
    kind: "nps",
    questions: [
      {
        id: "score",
        type: "rating",
        prompt: "How likely are you to recommend us?",
        required: true,
      },
      {
        id: "reason",
        type: "text",
        prompt: "What is the main reason for your score?",
        required: false,
      },
    ],
    audience: [],
    suppressDays: 30,
    status: "active",
    createdBy: userId,
  });
  if (!survey.ok) throw new Error(survey.error);

  const insertedResponses = await db
    .insert(surveyResponses)
    .values(
      insertedCustomers.slice(0, 3).map((cust, index) => ({
        surveyId: survey.surveyId,
        workspaceId: account.workspaceId,
        productId: account.productId,
        customerId: cust.id,
        visitorKey: `herald-demo-${cust.id}`,
        score: [9, 8, 10][index] ?? 9,
        answers: {
          score: String([9, 8, 10][index] ?? 9),
          reason: ["Very clean UI and fast changelog publishing", "The export and search features are fantastic", "Great support and quick replies"][index] ?? "Useful",
        },
        optedIn: false,
      })),
    )
    .returning({ id: surveyResponses.id });

  // 9. Seed Widget Experiences
  const tour = await createExperience({
    workspaceId: account.workspaceId,
    productId: account.productId,
    name: TOUR_NAME,
    kind: "tour",
    content: {
      en: {
        title: "Welcome to the demo",
        body: "A short tour for testing placement and completion reporting.",
        steps: [
          {
            selector: "#welcome",
            title: "Start here",
            body: "This step introduces the product.",
          },
          {
            selector: "#feedback",
            title: "Share feedback",
            body: "This step points at the feedback board.",
          },
        ],
      },
    },
    audience: [],
    defaultLocale: "en",
    dismissDays: 30,
    status: "active",
    createdBy: userId,
  });
  if (!tour.ok) throw new Error(tour.error);

  const banner = await createExperience({
    workspaceId: account.workspaceId,
    productId: account.productId,
    name: BANNER_NAME,
    kind: "banner",
    content: {
      en: {
        title: "Try the customer portal",
        body: "Help, feedback and updates now share one search.",
      },
    },
    audience: [],
    defaultLocale: "en",
    dismissDays: 30,
    status: "active",
    createdBy: userId,
  });
  if (!banner.ok) throw new Error(banner.error);

  await db.insert(widgetExperienceDismissals).values({
    experienceId: tour.experienceId,
    workspaceId: account.workspaceId,
    customerId: insertedCustomers[0]?.id ?? null,
    visitorKey: `herald-demo-${insertedCustomers[0]?.id ?? "v1"}`,
  });

  await db.insert(widgetExperienceCompletions).values(
    insertedCustomers.map((cust) => ({
      experienceId: tour.experienceId,
      workspaceId: account.workspaceId,
      productId: account.productId,
      customerId: cust.id,
      visitorKey: `herald-demo-${cust.id}`,
    })),
  );

  await db.insert(widgetExperienceDismissals).values({
    experienceId: banner.experienceId,
    workspaceId: account.workspaceId,
    customerId: insertedCustomers[0]?.id ?? null,
    visitorKey: `herald-demo-${insertedCustomers[0]?.id ?? "v1"}`,
  });

  // 10. Seed API Documentation
  if (userId) {
    const imported = await importApiDocVersion({
      workspaceId: account.workspaceId,
      productId: account.productId,
      userId,
      docSlug: API_DOC_SLUG,
      name: "Herald demo API",
      description: "Demo OpenAPI document for the versioned docs and playground.",
      raw: JSON.stringify(OPENAPI_DOCUMENT),
      version: "1.0.0",
      source: "file",
    });
    if (!imported.ok) throw new Error(imported.error);

    const published = await publishApiDocVersion({
      productId: account.productId,
      versionId: imported.data.versionId,
      confirmBreaking: false,
    });
    if (!published.ok) throw new Error(published.error);
  }

  // 11. Seed Analytics Daily Rollup History (past 14 days)
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const dailyRows = [];
  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    const factor = 1 + Math.sin(i / 1.5) * 0.35;
    dailyRows.push(
      { workspaceId: account.workspaceId, productId: account.productId, day, metric: "board_views", value: Math.max(1, Math.round(28 * factor)) },
      { workspaceId: account.workspaceId, productId: account.productId, day, metric: "request_views", value: Math.max(1, Math.round(42 * factor)) },
      { workspaceId: account.workspaceId, productId: account.productId, day, metric: "submit_started", value: Math.max(1, Math.round(9 * factor)) },
      { workspaceId: account.workspaceId, productId: account.productId, day, metric: "submissions", value: Math.max(1, Math.round(4 * factor)) },
      { workspaceId: account.workspaceId, productId: account.productId, day, metric: "votes", value: Math.max(1, Math.round(16 * factor)) },
      { workspaceId: account.workspaceId, productId: account.productId, day, metric: "widget_opens", value: Math.max(1, Math.round(22 * factor)) },
      { workspaceId: account.workspaceId, productId: account.productId, day, metric: "widget_installs", value: 1 },
      { workspaceId: account.workspaceId, productId: account.productId, day, metric: "portal_page_views", value: Math.max(1, Math.round(65 * factor)) },
      { workspaceId: account.workspaceId, productId: account.productId, day, metric: "conversations_started", value: Math.max(1, Math.round(3 * factor)) },
      { workspaceId: account.workspaceId, productId: account.productId, day, metric: "conversations_resolved", value: Math.max(1, Math.round(2 * factor)) },
      { workspaceId: account.workspaceId, productId: account.productId, day, metric: "time_to_ship_minutes", value: Math.round(1800 * factor) },
      { workspaceId: account.workspaceId, productId: account.productId, day, metric: "time_to_ship_count", value: 1 },
    );
  }

  await db.insert(analyticsDaily).values(dailyRows).onConflictDoNothing();

  return {
    account,
    releases: releasesCount,
    feedbackPosts: DEMO_FEEDBACK.length,
    customers: insertedCustomers.length,
    subscribers: insertedSubscribers.length,
    conversations: conversationsCount,
    helpArticles: helpArticlesCount,
    surveyResponses: insertedResponses.length,
    tourCompletions: insertedCustomers.length,
    warnings,
  };
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

// Check for target parameter in flags or positionals
let target: string | null = null;
const workspaceIdx = args.indexOf("--workspace");
const productIdx = args.indexOf("--product");
const wShortIdx = args.indexOf("-w");
const pShortIdx = args.indexOf("-p");

if (workspaceIdx >= 0 && args[workspaceIdx + 1] && !args[workspaceIdx + 1]?.startsWith("-")) {
  target = args[workspaceIdx + 1]!;
} else if (productIdx >= 0 && args[productIdx + 1] && !args[productIdx + 1]?.startsWith("-")) {
  target = args[productIdx + 1]!;
} else if (wShortIdx >= 0 && args[wShortIdx + 1] && !args[wShortIdx + 1]?.startsWith("-")) {
  target = args[wShortIdx + 1]!;
} else if (pShortIdx >= 0 && args[pShortIdx + 1] && !args[pShortIdx + 1]?.startsWith("-")) {
  target = args[pShortIdx + 1]!;
} else {
  const positional = args.find((arg) => !arg.startsWith("-"));
  if (positional) {
    target = positional;
  }
}

try {
  let whereClause = undefined;
  if (target) {
    whereClause = or(
      ilike(workspaces.slug, target),
      ilike(workspaces.name, target),
      ilike(products.slug, target),
      ilike(products.name, target),
    );
  }

  const accounts = await db
    .select({
      workspaceId: workspaces.id,
      workspaceSlug: workspaces.slug,
      productId: products.id,
      productSlug: products.slug,
      productName: products.name,
    })
    .from(products)
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(whereClause)
    .orderBy(asc(workspaces.slug), asc(products.slug));

  if (accounts.length === 0) {
    console.error(`No products found${target ? ` matching "${target}"` : ""}.`);
    process.exitCode = 1;
  } else if (dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          accounts: accounts.map((account) => ({
            workspace: account.workspaceSlug,
            product: account.productSlug,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    const results: SeedResult[] = [];
    for (const account of accounts) {
      results.push(await seedAccount(account));
    }

    for (const result of results) {
      console.log(
        JSON.stringify({
          workspace: result.account.workspaceSlug,
          product: result.account.productSlug,
          releases: result.releases,
          feedbackPosts: result.feedbackPosts,
          customers: result.customers,
          subscribers: result.subscribers,
          conversations: result.conversations,
          helpArticles: result.helpArticles,
          surveyResponses: result.surveyResponses,
          tourCompletions: result.tourCompletions,
          warnings: result.warnings,
        }),
      );
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
