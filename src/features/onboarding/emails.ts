import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { analyticsEvents } from "@/db/schema/analytics";
import { boards } from "@/db/schema/boards";
import {
  onboardingEmailSends,
  type OnboardingEmailKind,
} from "@/db/schema/onboarding";
import { releases } from "@/db/schema/releases";
import { products, workspaceMembers, workspaces } from "@/db/schema/workspaces";
import { isAuthEmailConfigured } from "@/features/email/auth-mail";
import { sendEmail } from "@/features/email/provider";
import {
  renderOnboardingFirstBoardEmail,
  renderOnboardingFirstReleaseEmail,
  renderOnboardingWelcomeEmail,
  renderOnboardingWidgetEmail,
  type RenderedEmail,
} from "@/features/email/templates";
import {
  publicBoardPath,
  publicChangelogEntryPath,
  publicProductPath,
} from "@/features/public/paths";
import { getServerEnv } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";

import { nextOnboardingKind } from "./sequence";

/**
 * Account onboarding email delivery.
 *
 * The sweep reads observed milestones and sends one email per account per
 * invocation. The unique (user, kind) ledger makes a retry or an overlapping
 * cron run a no-op once an email has been sent. Account content is never
 * mixed into workspace subscriber delivery or suppression lists.
 *
 * Accounts created before the sequence was enabled are excluded, so shipping
 * this does not email existing customers with stale setup tips.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const SEQUENCE_STARTED_AT = new Date("2026-11-22T00:00:00Z");
const MAX_AGE_DAYS = 45;

type Candidate = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
};

type OwnedProduct = {
  workspaceSlug: string;
  productSlug: string;
  productName: string;
  boardSlug: string | null;
};

type PublishedRelease = OwnedProduct & {
  releaseTitle: string;
  releaseSlug: string;
};

export type OnboardingSweepSummary = {
  configured: boolean;
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
};

function origin(): string {
  return new URL(getServerEnv().BETTER_AUTH_URL).origin;
}

async function listCandidates(
  limit: number,
  now: Date,
): Promise<Candidate[]> {
  const oldest = new Date(now.getTime() - MAX_AGE_DAYS * DAY_MS);
  const rows = await db.execute(sql`
    SELECT u.id, u.name, u.email, u.created_at
    FROM "user" u
    WHERE u.onboarding_emails = true
      AND u.created_at >= ${SEQUENCE_STARTED_AT}
      AND u.created_at >= ${oldest}
      AND (
        SELECT count(*)
        FROM onboarding_email_sends s
        WHERE s.user_id = u.id AND s.status IN ('sent', 'skipped')
      ) < 4
    ORDER BY u.created_at ASC
    LIMIT ${limit}
  `);

  return (rows.rows as Array<Record<string, unknown>>).flatMap((row) => {
    if (
      typeof row.id !== "string" ||
      typeof row.name !== "string" ||
      typeof row.email !== "string" ||
      !(row.created_at instanceof Date)
    ) {
      return [];
    }
    return [
      {
        id: row.id,
        name: row.name,
        email: row.email,
        createdAt: row.created_at,
      },
    ];
  });
}

async function loadOwnedProduct(userId: string): Promise<OwnedProduct | null> {
  const rows = await db
    .select({
      workspaceSlug: workspaces.slug,
      productSlug: products.slug,
      productName: products.name,
      boardSlug: boards.slug,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .innerJoin(products, eq(products.workspaceId, workspaces.id))
    .leftJoin(boards, eq(boards.productId, products.id))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.role, "owner"),
      ),
    )
    .orderBy(
      asc(workspaces.createdAt),
      asc(products.createdAt),
      asc(boards.position),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function loadFirstPublishedRelease(
  userId: string,
): Promise<PublishedRelease | null> {
  const rows = await db
    .select({
      workspaceSlug: workspaces.slug,
      productSlug: products.slug,
      productName: products.name,
      boardSlug: boards.slug,
      releaseTitle: releases.title,
      releaseSlug: releases.slug,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .innerJoin(products, eq(products.workspaceId, workspaces.id))
    .leftJoin(boards, eq(boards.productId, products.id))
    .innerJoin(releases, eq(releases.productId, products.id))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.role, "owner"),
        eq(releases.status, "published"),
      ),
    )
    .orderBy(asc(releases.publishedAt), asc(boards.position))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    workspaceSlug: row.workspaceSlug,
    productSlug: row.productSlug,
    productName: row.productName,
    boardSlug: row.boardSlug,
    releaseTitle: row.releaseTitle,
    releaseSlug: row.releaseSlug,
  };
}

async function loadFirstWidgetInstall(
  userId: string,
): Promise<OwnedProduct | null> {
  const rows = await db
    .select({
      workspaceSlug: workspaces.slug,
      productSlug: products.slug,
      productName: products.name,
      boardSlug: boards.slug,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .innerJoin(products, eq(products.workspaceId, workspaces.id))
    .leftJoin(boards, eq(boards.productId, products.id))
    .innerJoin(
      analyticsEvents,
      and(
        eq(analyticsEvents.productId, products.id),
        eq(analyticsEvents.type, "widget_install"),
      ),
    )
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.role, "owner"),
      ),
    )
    .orderBy(asc(analyticsEvents.occurredAt), asc(boards.position))
    .limit(1);

  return rows[0] ?? null;
}

function buildEmail(input: {
  kind: OnboardingEmailKind;
  candidate: Candidate;
  owned: OwnedProduct | null;
  release: PublishedRelease | null;
  widget: OwnedProduct | null;
}): RenderedEmail | null {
  const base = origin();
  const preferencesUrl = `${base}/app/account#email-preferences`;
  const name = input.candidate.name;

  switch (input.kind) {
    case "welcome":
      return renderOnboardingWelcomeEmail({
        name,
        setupUrl: `${base}/app/onboarding`,
        preferencesUrl,
      });
    case "first_board": {
      if (!input.owned) return null;
      const boardPath = input.owned.boardSlug
        ? publicBoardPath(
            input.owned.workspaceSlug,
            input.owned.productSlug,
            input.owned.boardSlug,
          )
        : publicProductPath(
            input.owned.workspaceSlug,
            input.owned.productSlug,
          );
      return renderOnboardingFirstBoardEmail({
        name,
        productName: input.owned.productName,
        boardUrl: `${base}${boardPath}`,
        dashboardUrl: `${base}/app/${encodeURIComponent(
          input.owned.workspaceSlug,
        )}/${encodeURIComponent(input.owned.productSlug)}`,
        preferencesUrl,
      });
    }
    case "first_release": {
      if (!input.release) return null;
      return renderOnboardingFirstReleaseEmail({
        name,
        productName: input.release.productName,
        releaseTitle: input.release.releaseTitle,
        releaseUrl: `${base}${publicChangelogEntryPath(
          input.release.workspaceSlug,
          input.release.productSlug,
          input.release.releaseSlug,
        )}`,
        preferencesUrl,
      });
    }
    case "widget_installed": {
      if (!input.widget) return null;
      return renderOnboardingWidgetEmail({
        name,
        productName: input.widget.productName,
        settingsUrl: `${base}/app/${encodeURIComponent(
          input.widget.workspaceSlug,
        )}/${encodeURIComponent(input.widget.productSlug)}/widget`,
        preferencesUrl,
      });
    }
  }
}

async function deliver(input: {
  candidate: Candidate;
  kind: OnboardingEmailKind;
  email: RenderedEmail;
}): Promise<"sent" | "skipped" | "failed"> {
  const existing = await db
    .select({ status: onboardingEmailSends.status })
    .from(onboardingEmailSends)
    .where(
      and(
        eq(onboardingEmailSends.userId, input.candidate.id),
        eq(onboardingEmailSends.kind, input.kind),
      ),
    )
    .limit(1);

  if (
    existing[0]?.status === "sent" ||
    existing[0]?.status === "skipped"
  ) {
    return "skipped";
  }

  const result = await sendEmail({
    to: input.candidate.email,
    ...input.email,
    idempotencyKey: `onboarding:${input.candidate.id}:${input.kind}`,
  });

  const now = new Date();
  const status = result.ok ? "sent" : "failed";
  await db
    .insert(onboardingEmailSends)
    .values({
      userId: input.candidate.id,
      kind: input.kind,
      status,
      providerMessageId: result.ok ? result.providerMessageId : null,
      error: result.ok ? null : result.error,
      sentAt: result.ok ? now : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [onboardingEmailSends.userId, onboardingEmailSends.kind],
      set: {
        status,
        providerMessageId: result.ok ? result.providerMessageId : null,
        error: result.ok ? null : result.error,
        sentAt: result.ok ? now : null,
        updatedAt: now,
      },
    });

  if (!result.ok) {
    logEvent("warn", "onboarding.email_failed", {
      kind: input.kind,
      retryable: result.retryable,
      error: result.error,
    });
    return "failed";
  }

  logEvent("info", "onboarding.email_sent", { kind: input.kind });
  return "sent";
}

/**
 * One bounded sweep. It returns counts rather than addresses, and the caller
 * turns a non-zero failure count into a retrying job.
 */
export async function sendDueOnboardingEmails(input?: {
  limit?: number;
  now?: Date;
}): Promise<OnboardingSweepSummary> {
  if (!isAuthEmailConfigured()) {
    return {
      configured: false,
      checked: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const limit = Math.min(Math.max(Math.trunc(input?.limit ?? 25), 1), 50);
  const now = input?.now ?? new Date();
  const candidates = await listCandidates(Math.min(limit * 3, 100), now);

  let checked = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    if (sent >= limit) break;
    checked += 1;

    const [sends, owned, release, widget] = await Promise.all([
      db
        .select({
          kind: onboardingEmailSends.kind,
          status: onboardingEmailSends.status,
          sentAt: onboardingEmailSends.sentAt,
        })
        .from(onboardingEmailSends)
        .where(eq(onboardingEmailSends.userId, candidate.id)),
      loadOwnedProduct(candidate.id),
      loadFirstPublishedRelease(candidate.id),
      loadFirstWidgetInstall(candidate.id),
    ]);

    const sentKinds = sends
      .filter((row) => row.status === "sent" || row.status === "skipped")
      .map((row) => row.kind);
    const lastSentAt = sends.reduce<Date | null>((latest, row) => {
      if (row.status !== "sent" || !row.sentAt) return latest;
      return !latest || row.sentAt > latest ? row.sentAt : latest;
    }, null);

    const kind = nextOnboardingKind({
      sent: sentKinds,
      milestones: {
        hasWorkspace: Boolean(owned),
        hasPublishedRelease: Boolean(release),
        hasWidgetInstall: Boolean(widget),
      },
      lastSentAt,
      now,
    });
    if (!kind) continue;

    const email = buildEmail({ kind, candidate, owned, release, widget });
    if (!email) continue;

    try {
      const outcome = await deliver({ candidate, kind, email });
      if (outcome === "sent") sent += 1;
      else if (outcome === "skipped") skipped += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      logEvent("error", "onboarding.email_threw", {
        kind,
        error: serializeError(error),
      });
    }
  }

  return {
    configured: true,
    checked,
    sent,
    skipped,
    failed,
  };
}
