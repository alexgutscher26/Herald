import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { releases } from "@/db/schema/releases";
import { products, workspaceMembers } from "@/db/schema/workspaces";
import { getSenderIdentity, senderIdentityProblem } from "@/features/email/identity";
import { readWidgetSettings } from "@/features/widget/settings";

import type { SetupChecklist, SetupStep } from "./setup-types";

/**
 * Derive the new-product setup checklist from PostgreSQL.
 *
 * Every step is an observed fact: a saved description, a published release, a
 * saved widget allowlist, a complete sender identity, more than one member.
 * Nothing is marked done because a button was clicked, and widget
 * *installation* is deliberately not claimed — the widget page verifies that
 * against the deployed origin, and this checklist only knows that the
 * configuration was saved.
 */
export async function getSetupChecklist(input: {
  workspaceId: string;
  workspaceSlug: string;
  productId: string;
  productSlug: string;
  productName: string;
}): Promise<SetupChecklist> {
  const base = `/app/${input.workspaceSlug}/${input.productSlug}`;

  const [productRows, memberRows, releaseRows, widget, sender] = await Promise.all([
    db
      .select({ description: products.description })
      .from(products)
      .where(
        and(
          eq(products.id, input.productId),
          eq(products.workspaceId, input.workspaceId),
        ),
      )
      .limit(1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, input.workspaceId)),
    db
      .select({ status: releases.status, publishedAt: releases.publishedAt })
      .from(releases)
      .where(eq(releases.productId, input.productId)),
    readWidgetSettings(input.workspaceId),
    getSenderIdentity(input.workspaceId),
  ]);

  const description = (productRows[0]?.description ?? "").trim();
  const published = releaseRows.filter((release) => release.status === "published");
  const origins = widget?.allowedOrigins ?? [];
  const senderReady = senderIdentityProblem(sender) === null;
  const memberCount = memberRows[0]?.count ?? 0;

  const steps: SetupStep[] = [
    {
      id: "product-details",
      label: "Add product details",
      description: `Describe ${input.productName} in a sentence. The description appears on the public changelog, roadmap and widget.`,
      detail:
        description.length > 0
          ? description
          : "A description is saved for this product.",
      done: description.length >= 10,
      href: `${base}/settings#product-details`,
    },
    {
      id: "first-release",
      label: "Publish your first release",
      description:
        "Draft an entry, link the feedback it answers, then publish to the changelog or schedule it.",
      detail:
        published.length === 1
          ? "1 published release"
          : `${published.length} published releases`,
      done: published.length > 0,
      href: `${base}/releases/new`,
    },
    {
      id: "widget",
      label: "Install the widget",
      description:
        "Save at least one allowed domain, copy the snippet, and verify the installation from the widget page. Installation itself is never assumed here.",
      detail:
        origins.length === 1
          ? `Configured for ${origins[0]}`
          : `Configured for ${origins.length} domains`,
      done: origins.length > 0,
      href: `${base}/widget`,
    },
    {
      id: "email",
      label: "Configure email",
      description:
        "Save a sender name, a verified sending address and the postal address campaign email requires.",
      detail: sender.from
        ? `Sending as ${sender.from}`
        : "A sender identity is saved.",
      done: senderReady,
      href: `${base}/settings#sender-identity`,
    },
    {
      id: "teammate",
      label: "Invite a teammate",
      description:
        "Add an editor, admin or owner so triage and publishing are not one person's job.",
      detail:
        memberCount === 1
          ? "1 member in this workspace"
          : `${memberCount} members in this workspace`,
      done: memberCount > 1,
      href: `/app/${input.workspaceSlug}/settings`,
    },
  ];

  return {
    steps,
    completed: steps.filter((step) => step.done).length,
    total: steps.length,
  };
}

/**
 * Whether the five setup facts exist somewhere in the workspace.
 *
 * Checkout is workspace-scoped while the overview checklist is per product.
 * A Free workspace has one product, so these are the same facts in practice.
 * The check uses the same evidence the checklist shows; a client cannot claim
 * completion.
 */
export async function isWorkspaceSetupComplete(workspaceId: string): Promise<boolean> {
  const [descriptionRows, releaseRows, memberRows, widget, sender] = await Promise.all([
    db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.workspaceId, workspaceId),
          sql`length(trim(coalesce(${products.description}, ''))) >= 10`,
        ),
      )
      .limit(1),
    db
      .select({ id: releases.id })
      .from(releases)
      .innerJoin(products, eq(releases.productId, products.id))
      .where(and(eq(products.workspaceId, workspaceId), eq(releases.status, "published")))
      .limit(1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId)),
    readWidgetSettings(workspaceId),
    getSenderIdentity(workspaceId),
  ]);

  return (
    Boolean(descriptionRows[0]) &&
    Boolean(releaseRows[0]) &&
    (widget?.allowedOrigins.length ?? 0) > 0 &&
    senderIdentityProblem(sender) === null &&
    (memberRows[0]?.count ?? 0) > 1
  );
}
