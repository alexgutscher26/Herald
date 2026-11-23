/**
 * Seed Herald's own workspace, product, board, roadmap and changelog.
 *
 * This is real product data, not a demo fixture: the marketing footer links
 * `/roadmap` to `/p/herald/herald/roadmap`, and every card below is work that
 * is actually tracked in `todo.md` (with the file or test that proves it) or
 * still open there. Running the script twice is safe — it updates the same
 * workspace, product, board and posts by slug/title.
 *
 * `--email <address>` makes that account the workspace owner (and is how the
 * Herald team's own login gets the workspace in its switcher). Without it the
 * workspace is seeded but left ownerless, which is what a fresh environment
 * needs before anyone has signed in.
 *
 * Usage:
 *   bun run db:seed-herald
 *   bun run db:seed-herald --email madajoe6969@gmail.com --allow-remote
 */
import { and, eq } from "drizzle-orm";

import { closeDb, db } from "@/db";
import {
  boards,
  feedbackComments,
  feedbackPosts,
  products,
  publicRoadmaps,
  releaseAuthors,
  releaseFeedbackLinks,
  releaseTagLinks,
  releaseTags,
  releases,
  roadmapBoards,
  workspaceBranding,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { user } from "@/db/schema/auth";
import { normalizeReleaseTags } from "@/features/releases/tags";

import { assertScriptEnvironment } from "./lib/guard";

assertScriptEnvironment("seed-herald-roadmap");

const WORKSPACE_SLUG = "herald";
const PRODUCT_SLUG = "herald";
const BOARD_SLUG = "feedback";
const ROADMAP_SLUG = "roadmap";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("-") ? value : undefined;
}

const OWNER_EMAIL = argValue("--email");

type RoadmapItem = {
  title: string;
  body: string;
  status: "planned" | "in_progress" | "shipped";
  category: "feature_request" | "improvement" | "bug";
  /** Days before today, so "recent" reads like a real history. */
  daysAgo: number;
  /** Team reply published with the request, when there is one. */
  teamReply?: string;
};

/**
 * Every entry is lifted from the working backlog. A shipped entry names the
 * evidence on the same line, which is the rule `todo.md` sets for itself.
 */
const ROADMAP_ITEMS: readonly RoadmapItem[] = [
  {
    title: "Request briefs a coding agent can start from",
    body: "Copy one request with its dated customer evidence, demand, status and open questions as stable Markdown, or fetch the same brief over the API and MCP.",
    status: "shipped",
    category: "feature_request",
    daysAgo: 26,
  },
  {
    title: "Several products under one flat account",
    body: "Each product keeps its own boards, roadmap and changelog. Indie includes five products and Professional is unlimited, with no per-seat pricing.",
    status: "shipped",
    category: "feature_request",
    daysAgo: 25,
  },
  {
    title: "Public roadmap for Herald, run on Herald",
    body: "This page is the product: a published roadmap whose cards are feedback requests, with public votes and the same status the team uses internally.",
    status: "shipped",
    category: "feature_request",
    daysAgo: 24,
  },
  {
    title: "Dated comparison pages with linked sources",
    body: "Canny, Featurebase and UserJot compared on published packaging and prices, with the date each page was checked and a link to the vendor's own pricing page.",
    status: "shipped",
    category: "improvement",
    daysAgo: 23,
  },
  {
    title: "Interactive demo workspace",
    body: "A public sandbox with a board, roadmap, changelog and request detail a visitor can explore without creating an account.",
    status: "shipped",
    category: "feature_request",
    daysAgo: 22,
  },
  {
    title: "Demo video",
    body: "A short walkthrough of the loop: a request arrives, moves across the roadmap, ships in a changelog entry and closes back on the request.",
    status: "shipped",
    category: "improvement",
    daysAgo: 21,
  },
  {
    title: "Signup funnel analytics with a privacy review",
    body: "Measure where signup drops off without collecting emails, IP addresses or user agents in product analytics, and publish the review before turning it on.",
    status: "shipped",
    category: "improvement",
    daysAgo: 20,
  },
  {
    title: "A browser pass and a smoke test that keep every dashboard route honest",
    body: "The last recorded browser pass had every `/app` route stuck on its loading skeleton. It does not reproduce on a clean build, so it became a test instead of a memory: `tests/integration/dashboard-shell.test.ts` boots `next start` against a disposable database, signs in a fixture owner, walks all 34 dashboard routes from the filesystem and fails if a Suspense boundary stays pending. `bun run test:smoke` → 3 pass.",
    status: "shipped",
    category: "improvement",
    daysAgo: 2,
    teamReply:
      "Verified on a clean build and now guarded by a test. If a route ever streams a shell that never resolves, CI fails instead of a customer finding it.",
  },
  {
    title: "Security headers and a frame-ancestors rule on every response",
    body: "Every response now carries `nosniff`, a referrer policy, HSTS on HTTPS a `Permissions-Policy` that only delegates screen capture on the widget surfaces, and a `frame-ancestors` rule that lets the embed be framed by the workspace's allowed origins and nothing else. The report-only CSP is audited across six served documents in `tests/integration/csp-surfaces.test.ts` (6 pass).",
    status: "shipped",
    category: "improvement",
    daysAgo: 2,
  },
  {
    title: "Zero high or critical advisories, and a CI gate that keeps it there",
    body: "`bun audit --audit-level=high` runs in CI and fails the build on a high or critical advisory. The 670-package baseline has two moderate findings, both build-time only, recorded with their exposure and disposition in `docs/security-review.md`. Dependabot groups patch, minor and security updates, and only patch bumps auto-merge.",
    status: "shipped",
    category: "improvement",
    daysAgo: 2,
  },
  {
    title: "Sign-up verification, password reset and account deletion",
    body: "Email verification and password reset use short-lived, single-use tokens stored only as a hash, and a reset revokes every session and sends a notice. Account deletion refuses to orphan a workspace: the only owner is blocked until ownership is transferred. `tests/integration/account-lifecycle.test.ts` covers the lifecycle; throttling lives in Postgres so it survives a serverless restart.",
    status: "shipped",
    category: "feature_request",
    daysAgo: 2,
    teamReply:
      "The reset token was previously stored in plain text. It is now `sha256(token)` at rest, expires in an hour, and is deleted before it is honoured.",
  },
  {
    title: "Prioritisation that counts customers, not clicks",
    body: "Priority is `impact ÷ effort × demand`, where demand counts distinct requesters instead of raw votes. Revenue weighting prefers a company's ARR/MRR trait, then the CRM cache, then an open deal, and every one of those values stays team-only. The public roadmap keeps an explicit Recent / Most wanted switch driven only by public vote count.",
    status: "shipped",
    category: "feature_request",
    daysAgo: 1,
  },
  {
    title: "Evidence on the request, not just the title",
    body: "A request now carries insight rows (a support message, an email quote, a call note) with source and author, context links to a help article or changelog entry, and one demand sentence — \"N customers asked for this, from M sources\" — that counts people without publishing their words.",
    status: "shipped",
    category: "feature_request",
    daysAgo: 1,
  },
  {
    title: "A help center published from the same Markdown the team edits",
    body: "Herald's own help center is imported from `docs/help/*.md` by the same Markdown parser the dashboard upload uses. Eight articles cover the getting-started path, widget recipes for six frameworks, and a migration guide from each source tool. `bun run db:import-help` writes them through the product's own import, revision and Juno knowledge-sync code.",
    status: "shipped",
    category: "feature_request",
    daysAgo: 0,
  },
  {
    title: "The customer portal in Spanish, and one search across it",
    body: "The language chips now perform a real navigation instead of a soft one, so the locale cookie reaches the render. Navigation, search, filters, tabs and empty states are translated, `<html lang>` follows the chosen locale, and the choice persists. `tests/public-i18n.test.ts` keeps both catalogues complete (13 pass).",
    status: "shipped",
    category: "feature_request",
    daysAgo: 0,
    teamReply:
      "Shipped today. Switching to Español translates the page immediately — no reload — and English switches back.",
  },
  {
    title: "A feedback screen that fits the window",
    body: "The duplicate and context rows in the request sidebar shared a single auto-sized grid track, so a long merge target pushed the row past the panel edge. The rows now shrink, and the toolbar is three deliberate rows with an auto-fill filter grid: 3×2 on a wide screen, 2×3 in split view and one column on a phone. Measured at 768, 896, 1280 and 1600px with no overflow.",
    status: "shipped",
    category: "bug",
    daysAgo: 0,
    teamReply:
      "Fixed and measured at four widths. The merge target no longer sits outside the sidebar.",
  },
  {
    title: "A launch checklist with verified backups and a working alert channel",
    body: "`docs/launch-checklist.md` records the remaining gates and the runnable checks behind them. `bun run backups:verify` exits 0 and `bun run alerts:test` exercises the configured channel. Production PITR, a real alert delivery and staffed support coverage are still open, so the checklist is not signed off.",
    status: "in_progress",
    category: "improvement",
    daysAgo: 0,
  },
  {
    title: "Two-factor authentication with recovery codes",
    body: "TOTP for workspace users, recovery codes that are shown once and stored hashed, and an owner switch that can require a second factor for owners and admins. There is no `twoFactor` plugin in the auth config today; this is the first item in the account-security section of the backlog.",
    status: "planned",
    category: "feature_request",
    daysAgo: 0,
  },
  {
    title: "A session list you can revoke, and sign out everywhere",
    body: "Show each session with its device, coarse last-seen location and time, let a person revoke one session or all of them, and expose idle and absolute session lifetimes as workspace settings. Revoking a session is the part that makes a leaked cookie recoverable without a password reset.",
    status: "planned",
    category: "feature_request",
    daysAgo: 0,
  },
];

type SeedRelease = {
  title: string;
  slug: string;
  version: string;
  category: "feature" | "improvement" | "fix";
  summary: string;
  bodyMarkdown: string;
  publishedAt: Date;
  coverPreset: "grid" | "orbit" | "waves" | "plain";
  tags: string[];
  /** Request titles this release closes. */
  shipped: string[];
};

const RELEASES: readonly SeedRelease[] = [
  {
    title: "Request briefs your coding agent can start from",
    slug: "request-briefs-for-agents",
    version: "1.1.0",
    category: "feature",
    summary:
      "One request, its dated evidence, demand, status and open questions as Markdown you can paste into an agent.",
    bodyMarkdown:
      "A request is more than a title. The brief collects the customer quotes and dates behind it, who asked, how many asked, its current status, related releases and the questions still open.\n\nCopy it from the request detail, fetch it from `GET /api/v1/requests/{id}/brief`, or read it through MCP. A human still decides what becomes a ticket.",
    publishedAt: new Date("2026-11-20T10:00:00Z"),
    coverPreset: "orbit",
    tags: ["Agent", "API"],
    shipped: ["Request briefs a coding agent can start from"],
  },
  {
    title: "Five products under one flat account",
    slug: "five-products-one-account",
    version: "1.2.0",
    category: "feature",
    summary:
      "Each product gets its own boards, roadmap and changelog. Indie includes five; Professional is unlimited.",
    bodyMarkdown:
      "Herald now sells products, not board slots. A product owns its public feedback board, roadmap and changelog, and switching products never mixes their data.\n\nIndie includes five products with five boards each. Professional removes the product and board caps. Every plan stays flat per workspace: viewers are free and there is no per-seat price.",
    publishedAt: new Date("2026-11-20T14:00:00Z"),
    coverPreset: "grid",
    tags: ["Products", "Billing"],
    shipped: ["Several products under one flat account"],
  },
  {
    title: "Herald's roadmap is now public, and it runs on Herald",
    slug: "herald-roadmap-public",
    version: "1.3.0",
    category: "improvement",
    summary:
      "The roadmap you are reading is a published Herald roadmap. Every card is a feedback request with the same status the team uses.",
    bodyMarkdown:
      "We moved our own roadmap onto the product. There is no separate CMS and no hand-maintained embed: the cards below are requests in the Herald feedback board, and moving one changes this page.\n\nVote on anything you want prioritised. The \"Most wanted\" view sorts by public votes; recently updated is the default.",
    publishedAt: new Date("2026-11-21T09:00:00Z"),
    coverPreset: "waves",
    tags: ["Roadmap", "Dogfooding"],
    shipped: ["Public roadmap for Herald, run on Herald"],
  },
  {
    title: "Documentation that ships with the product",
    slug: "docs-in-the-product",
    version: "1.4.0",
    category: "improvement",
    summary:
      "Getting started, five migration guides, an API cookbook, self-hosting and the decisions behind them, published from the same Markdown the team edits.",
    bodyMarkdown:
      "Herald's own help center is now imported from `docs/help/*.md` by the same Markdown parser the dashboard import uses. The first collection covers the getting-started path (workspace, board, first release, widget), framework recipes for installing the widget, and a migration guide for each source tool.\n\nThe operations documentation gains a self-hosting guide, a data-processing and retention page written from the schema and prune jobs, an API cookbook, and five architecture decision records. Nothing in this release changes customer data or requires a migration.",
    publishedAt: new Date("2026-11-22T10:00:00Z"),
    coverPreset: "plain",
    tags: ["Docs", "Help center"],
    shipped: ["A help center published from the same Markdown the team edits"],
  },
  {
    title: "Verified in a browser, hardened in transport",
    slug: "verified-and-hardened",
    version: "1.5.0",
    category: "fix",
    summary:
      "Every dashboard route is walked by a smoke test, and every response now carries a real framing and transport policy.",
    bodyMarkdown:
      "The open release blocker was a stale browser record: every `/app` route had once been stuck on its loading skeleton. On a clean build it does not reproduce, so the fix is a test — `bun run test:smoke` signs in a fixture owner, walks all 34 dashboard routes and fails on a permanently pending boundary.\n\nIn the same pass every response gained `nosniff`, a referrer policy, HSTS on HTTPS and a `Permissions-Policy` that delegates screen capture only where the widget annotator needs it. The embed answers `frame-ancestors 'self' <allowed origins>` with no `X-Frame-Options`; every other path is `'none'`/`SAMEORIGIN`. Six served documents are audited against the report-only CSP.",
    publishedAt: new Date("2026-11-20T16:00:00Z"),
    coverPreset: "grid",
    tags: ["Security", "Reliability"],
    shipped: [
      "A browser pass and a smoke test that keep every dashboard route honest",
      "Security headers and a frame-ancestors rule on every response",
    ],
  },
  {
    title: "Account lifecycle, end to end",
    slug: "account-lifecycle",
    version: "1.6.0",
    category: "feature",
    summary:
      "Verification, password reset, change email and account deletion — with hashed single-use tokens and sessions revoked on reset.",
    bodyMarkdown:
      "Sign-up can now require a verified address, and the sign-in form offers a resend instead of a dead end. Password reset is a single-use token stored as `sha256(token)`, expires in an hour, is deleted before it is honoured, and revokes every session with a notice email.\n\nChange email verifies both the old and the new address. Account deletion is blocked for the only owner of a workspace until ownership is transferred, so deleting an account can never orphan a workspace. Failed logins are throttled in Postgres, not in per-instance memory.",
    publishedAt: new Date("2026-11-20T18:00:00Z"),
    coverPreset: "waves",
    tags: ["Accounts", "Security"],
    shipped: ["Sign-up verification, password reset and account deletion"],
  },
  {
    title: "Prioritisation with evidence",
    slug: "prioritisation-with-evidence",
    version: "1.7.0",
    category: "feature",
    summary:
      "Impact over effort, weighted by distinct requesters, with evidence and revenue kept on the team side of the wall.",
    bodyMarkdown:
      "Priority is now a computed score — `impact ÷ effort × demand` — where demand counts distinct requesters rather than raw votes. Revenue weighting uses a company's ARR/MRR trait, then the CRM cache, then an open deal; all three are team-only and never reach a public page.\n\nRequests also carry the evidence behind them: support messages, email quotes, call notes and links to a help article or changelog entry. The public detail shows one sentence — how many customers asked, from how many sources — and never the content.",
    publishedAt: new Date("2026-11-21T15:00:00Z"),
    coverPreset: "orbit",
    tags: ["Feedback", "Prioritisation"],
    shipped: [
      "Prioritisation that counts customers, not clicks",
      "Evidence on the request, not just the title",
    ],
  },
  {
    title: "The portal in Spanish, and one search across it",
    slug: "portal-in-spanish",
    version: "1.8.0",
    category: "feature",
    summary:
      "Language switching works without a reload, the public chrome is translated, and the document declares its locale.",
    bodyMarkdown:
      "The chips looked like they worked: the cookie was set, but the page kept the cached render because a soft navigation reused the same payload. They are now real navigations, so the chosen locale reaches the render.\n\nNavigation, the search placeholder, filters, tabs and empty states are translated, and `<html lang>` follows the selection for screen readers and hyphenation. The choice survives a reload, and English switches back.",
    publishedAt: new Date("2026-11-22T14:00:00Z"),
    coverPreset: "waves",
    tags: ["Portal", "Localisation"],
    shipped: ["The customer portal in Spanish, and one search across it"],
  },
  {
    title: "A feedback screen that fits the window",
    slug: "feedback-screen-fits",
    version: "1.9.0",
    category: "fix",
    summary:
      "The request sidebar no longer overlaps, and the toolbar is three deliberate rows at every width.",
    bodyMarkdown:
      "A long merge target could push the duplicate row past the sidebar edge, because the rows shared one auto-sized grid track. They now shrink inside the panel.\n\nThe toolbar was rebuilt as three rows — search and actions, then filters, then the result count — with an auto-fill filter grid that produces 3×2 on a wide screen, 2×3 in a split view and one column on a phone. Measured at 768, 896, 1280 and 1600px with no overflow.",
    publishedAt: new Date("2026-11-22T16:00:00Z"),
    coverPreset: "plain",
    tags: ["Feedback", "UX"],
    shipped: ["A feedback screen that fits the window"],
  },
];

async function main() {
  const [insertedWorkspace] = await db
    .insert(workspaces)
    .values({
      name: "Herald",
      slug: WORKSPACE_SLUG,
      plan: "pro",
    })
    .onConflictDoNothing({ target: workspaces.slug })
    .returning({ id: workspaces.id });

  const workspace =
    insertedWorkspace ??
    (
      await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, WORKSPACE_SLUG))
        .limit(1)
    )[0];

  if (!workspace) throw new Error("Could not create or find the Herald workspace.");

  let ownerId: string | null = null;
  if (OWNER_EMAIL) {
    const owner = (
      await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, OWNER_EMAIL))
        .limit(1)
    )[0];
    if (!owner) {
      throw new Error(
        `No account for ${OWNER_EMAIL}. Sign up first, then rerun with --email.`,
      );
    }
    ownerId = owner.id;

    await db
      .update(workspaces)
      .set({ plan: "pro", createdBy: owner.id, updatedAt: new Date() })
      .where(eq(workspaces.id, workspace.id));

    await db
      .insert(workspaceMembers)
      .values({
        workspaceId: workspace.id,
        userId: owner.id,
        role: "owner",
      })
      .onConflictDoUpdate({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
        set: { role: "owner", updatedAt: new Date() },
      });
  }

  await db
    .insert(workspaceBranding)
    .values({
      workspaceId: workspace.id,
      brandName: "Herald",
      primaryColor: "#1f6b45",
      theme: "light",
      locale: "en",
    })
    .onConflictDoUpdate({
      target: workspaceBranding.workspaceId,
      set: {
        brandName: "Herald",
        primaryColor: "#1f6b45",
        theme: "light",
        locale: "en",
        updatedAt: new Date(),
      },
    });

  const [product] = await db
    .insert(products)
    .values({
      workspaceId: workspace.id,
      name: "Herald",
      slug: PRODUCT_SLUG,
      description:
        "Feedback, roadmap, changelog, widget and win-back for every product you run, under one flat account.",
      publicFeedbackEnabled: true,
      publicRoadmapEnabled: true,
      publicChangelogEnabled: true,
      publicShippedCounterEnabled: true,
    })
    .onConflictDoUpdate({
      target: [products.workspaceId, products.slug],
      set: {
        name: "Herald",
        description:
          "Feedback, roadmap, changelog, widget and win-back for every product you run, under one flat account.",
        publicFeedbackEnabled: true,
        publicRoadmapEnabled: true,
        publicChangelogEnabled: true,
        publicShippedCounterEnabled: true,
        updatedAt: new Date(),
      },
    })
    .returning({ id: products.id });

  if (!product) throw new Error("Could not create or find the Herald product.");

  const [board] = await db
    .insert(boards)
    .values({
      productId: product.id,
      name: "Feedback",
      slug: BOARD_SLUG,
      description: "Tell us what would make Herald better. We read every request.",
      visibility: "public",
      guestPosting: true,
    })
    .onConflictDoUpdate({
      target: [boards.productId, boards.slug],
      set: {
        name: "Feedback",
        description: "Tell us what would make Herald better. We read every request.",
        visibility: "public",
        guestPosting: true,
        updatedAt: new Date(),
      },
    })
    .returning({ id: boards.id });

  if (!board) throw new Error("Could not create or find the Herald feedback board.");

  const [roadmap] = await db
    .insert(publicRoadmaps)
    .values({
      workspaceId: workspace.id,
      productId: product.id,
      name: "Roadmap",
      slug: ROADMAP_SLUG,
      description:
        "What we are building next. Vote on anything you want prioritised; the status here is the status the team uses.",
      visibility: "public",
      position: 0,
      publishedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [publicRoadmaps.productId, publicRoadmaps.slug],
      set: {
        name: "Roadmap",
        description:
          "What we are building next. Vote on anything you want prioritised; the status here is the status the team uses.",
        visibility: "public",
        publishedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning({ id: publicRoadmaps.id });

  if (!roadmap) throw new Error("Could not create or find the Herald roadmap.");

  await db
    .insert(roadmapBoards)
    .values({
      roadmapId: roadmap.id,
      boardId: board.id,
      productId: product.id,
    })
    .onConflictDoNothing();

  const postIds = new Map<string, string>();
  let created = 0;
  let updated = 0;
  for (const item of ROADMAP_ITEMS) {
    const createdAt = new Date(Date.now() - item.daysAgo * 86_400_000);
    const existing = await db
      .select({ id: feedbackPosts.id })
      .from(feedbackPosts)
      .where(
        and(
          eq(feedbackPosts.productId, product.id),
          eq(feedbackPosts.title, item.title),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(feedbackPosts)
        .set({
          body: item.body,
          category: item.category,
          status: item.status,
          privacy: "public",
          authorId: ownerId,
          authorLabel: "Herald team",
          updatedAt: createdAt,
        })
        .where(eq(feedbackPosts.id, existing[0].id));
      postIds.set(item.title, existing[0].id);
      updated += 1;
    } else {
      const [post] = await db
        .insert(feedbackPosts)
        .values({
          productId: product.id,
          boardId: board.id,
          title: item.title,
          body: item.body,
          category: item.category,
          status: item.status,
          source: "other",
          privacy: "public",
          authorId: ownerId,
          authorLabel: "Herald team",
          importedVoteCount: 0,
          // Keep the intended order visible on "recent" without inventing votes.
          createdAt,
          updatedAt: createdAt,
        })
        .returning({ id: feedbackPosts.id });
      if (post) {
        postIds.set(item.title, post.id);
        created += 1;
      }
    }
  }

  let replies = 0;
  if (ownerId) {
    for (const item of ROADMAP_ITEMS) {
      const postId = postIds.get(item.title);
      if (!item.teamReply || !postId) continue;

      const existingReply = await db
        .select({ id: feedbackComments.id })
        .from(feedbackComments)
        .where(
          and(
            eq(feedbackComments.feedbackPostId, postId),
            eq(feedbackComments.body, item.teamReply),
          ),
        )
        .limit(1);
      if (existingReply[0]) continue;

      await db.insert(feedbackComments).values({
        productId: product.id,
        feedbackPostId: postId,
        authorId: ownerId,
        authorName: "Herald team",
        authorType: "team",
        body: item.teamReply,
        internal: false,
        privacy: "public",
      });
      replies += 1;
    }
  }

  let releaseTagsCreated = 0;
  for (const release of RELEASES) {
    const [row] = await db
      .insert(releases)
      .values({
        productId: product.id,
        title: release.title,
        slug: release.slug,
        version: release.version,
        category: release.category,
        summary: release.summary,
        bodyMarkdown: release.bodyMarkdown,
        status: "published",
        cover: { kind: "preset", preset: release.coverPreset },
        channelPublicChangelog: true,
        channelInAppWidget: true,
        channelSubscriberEmail: false,
        publishedAt: release.publishedAt,
        authorId: ownerId,
        createdAt: release.publishedAt,
        updatedAt: release.publishedAt,
      })
      .onConflictDoUpdate({
        target: [releases.productId, releases.slug],
        set: {
          title: release.title,
          version: release.version,
          category: release.category,
          summary: release.summary,
          bodyMarkdown: release.bodyMarkdown,
          status: "published",
          cover: { kind: "preset", preset: release.coverPreset },
          channelPublicChangelog: true,
          authorId: ownerId,
          publishedAt: release.publishedAt,
          updatedAt: new Date(),
        },
      })
      .returning({ id: releases.id });

    if (!row) continue;

    if (ownerId) {
      await db
        .insert(releaseAuthors)
        .values({
          releaseId: row.id,
          productId: product.id,
          userId: ownerId,
          position: 0,
        })
        .onConflictDoNothing();
    }

    const tags = normalizeReleaseTags(release.tags);
    if (tags.length > 0) {
      await db
        .insert(releaseTags)
        .values(
          tags.map((tag) => ({
            productId: product.id,
            name: tag.name,
            slug: tag.slug,
          })),
        )
        .onConflictDoNothing();
      releaseTagsCreated += tags.length;

      const stored = await db
        .select({ id: releaseTags.id, slug: releaseTags.slug })
        .from(releaseTags)
        .where(eq(releaseTags.productId, product.id));
      const idBySlug = new Map(stored.map((tag) => [tag.slug, tag.id]));
      await db
        .insert(releaseTagLinks)
        .values(
          tags.flatMap((tag) => {
            const tagId = idBySlug.get(tag.slug);
            return tagId ? [{ releaseId: row.id, tagId, productId: product.id }] : [];
          }),
        )
        .onConflictDoNothing();
    }

    for (const title of release.shipped) {
      const postId = postIds.get(title);
      if (!postId) continue;
      await db
        .insert(releaseFeedbackLinks)
        .values({
          productId: product.id,
          releaseId: row.id,
          feedbackPostId: postId,
        })
        .onConflictDoNothing();
    }
  }

  console.log(
    JSON.stringify(
      {
        workspace: `/${WORKSPACE_SLUG}`,
        owner: OWNER_EMAIL ?? null,
        product: PRODUCT_SLUG,
        roadmap: `/p/${WORKSPACE_SLUG}/${PRODUCT_SLUG}/roadmap`,
        posts: { created, updated, total: ROADMAP_ITEMS.length },
        teamReplies: replies,
        releases: RELEASES.length,
        releaseTags: releaseTagsCreated,
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
