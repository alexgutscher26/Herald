import "server-only";

import { and, desc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/db";
import {
  conversationAttachments,
  conversationMessages,
  conversations,
  type ConversationSourceContext,
  type ConversationStatus,
} from "@/db/schema/conversations";
import { customers } from "@/db/schema/customers";
import { products, workspaces } from "@/db/schema/workspaces";
import { CUSTOMER_SESSION_COOKIE } from "@/features/customer-session/config";
import {
  findActiveCustomerSession,
  type ActiveCustomerSession,
} from "@/features/customer-session/session";
import { widgetSurfaceEnabled } from "@/features/entitlements/entitlements";
import { hasFeature, toPlanId } from "@/features/entitlements/plans";
import { teamPresence } from "@/features/operators/service";
import { createSignedStorageUrl } from "@/features/storage/urls";
import { emailKey, isValidEmail } from "@/lib/email";

import { createInboundToken } from "@/features/email/inbound-address";
import {
  loadPendingFeedbackCard,
  type JunoFeedbackCard,
} from "@/features/juno/feedback-cards";
import {
  junoConversations,
  junoSettings,
} from "@/db/schema/knowledge";
import {
  csatEligibility } from "./csat";
import { queueAwayReply, queueCustomerMessageNotifications } from "./notify";
import { classifyConversationSpam } from "./spam";
import { loadSpamRules } from "./spam-settings";
import type { IntakeQuestionView } from "./intake";
import { applyIntakeTraits, listIntakeQuestions } from "./support-settings";

/**
 * Customer side of conversations.
 *
 * Every read and write starts from the first-party customer session cookie and
 * checks the session's workspace against the product in the URL. The customer
 * id is never accepted from the request; a thread is only returned when it
 * belongs to the session's customer.
 */

export type CustomerProduct = { id: string; workspaceId: string; name: string };

export type CustomerThread = {
  id: string;
  subject: string;
  preview: string;
  status: ConversationStatus;
  unread: number;
  updatedAt: string;
};

export type CustomerAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  url: string;
  isImage: boolean;
};

export type CustomerMessage = {
  id: string;
  author: "customer" | "team";
  body: string;
  /** True for a Mira answer, so the widget can label it without faking an agent. */
  fromJuno?: boolean;
  /** Where a Mira answer came from; null for every human message. */
  citations?: { sourceName: string; title: string; url: string | null }[] | null;
  attachments?: CustomerAttachment[];
  createdAt: string;
};

type CustomerAttachmentUpload = {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "file";
};

export type CustomerCsat = {
  /** True once this thread has been resolved with CSAT enabled. */
  requested: boolean;
  rating: number | null;
  /** True for the first rating and for one allowed re-rating. */
  canRate: boolean;
};

export type CustomerThreads =
  | { state: "not_found" }
  | {
      state: "signed_out";
      /** Product-wide widget intake questions; optional to answer. */
      intake: IntakeQuestionView[];
    }
  | {
      state: "ready";
      email: string | null;
      unread: number;
      /** Current operator presence, refreshed with the list poll. */
      online: boolean;
      intake: IntakeQuestionView[];
      threads: CustomerThread[];
    };

async function resolveProduct(
  workspaceSlug: string,
  productSlug: string,
): Promise<CustomerProduct | null> {
  const rows = await db
    .select({
      productId: products.id,
      productName: products.name,
      workspaceId: workspaces.id,
      plan: workspaces.plan,
    })
    .from(products)
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaces.slug, workspaceSlug),
        eq(products.slug, productSlug),
        or(
          eq(products.publicFeedbackEnabled, true),
          eq(products.publicRoadmapEnabled, true),
          eq(products.publicChangelogEnabled, true),
        ),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Messages ship with the widget surface; a downgraded workspace keeps the
  // stored rows but loses the public entry point.
  const plan = toPlanId(row.plan);
  if (!widgetSurfaceEnabled(plan) || !hasFeature(plan, "widget")) return null;

  return { id: row.productId, workspaceId: row.workspaceId, name: row.productName };
}

async function resolveSession(input: {
  product: CustomerProduct;
  sessionCookie?: string | null | undefined;
}): Promise<ActiveCustomerSession | null> {
  let cookieValue = input.sessionCookie;
  if (cookieValue === undefined) {
    const store = await cookies();
    cookieValue = store.get(CUSTOMER_SESSION_COOKIE)?.value ?? null;
  }

  const active = await findActiveCustomerSession(cookieValue ?? null);
  if (!active) return null;
  if (active.session.workspaceId !== input.product.workspaceId) return null;
  return active;
}

/**
 * Resolve a product for an email CSAT link.
 *
 * Email support may be on while every public feedback surface is off, so this
 * deliberately does not reuse `resolveProduct`'s widget/public-surface gate.
 * The unguessable reply token on the conversation is the authorization.
 */
async function resolveSupportProduct(
  workspaceSlug: string,
  productSlug: string,
): Promise<{ id: string; workspaceId: string; name: string } | null> {
  const rows = await db
    .select({
      productId: products.id,
      productName: products.name,
      workspaceId: workspaces.id,
    })
    .from(products)
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(
      and(eq(workspaces.slug, workspaceSlug), eq(products.slug, productSlug)),
    )
    .limit(1);
  const row = rows[0];
  return row
    ? { id: row.productId, workspaceId: row.workspaceId, name: row.productName }
    : null;
}

export async function publicConversationUnreadCount(input: {
  workspaceSlug: string;
  productSlug: string;
  sessionCookie?: string | null | undefined;
}): Promise<number> {
  const product = await resolveProduct(input.workspaceSlug, input.productSlug);
  if (!product) return 0;

  const active = await resolveSession({
    product,
    sessionCookie: input.sessionCookie,
  });
  if (!active) return 0;

  const rows = await db
    .select({
      value: sql<number>`coalesce(sum(${conversations.unreadForCustomer}), 0)::int`,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.productId, product.id),
        eq(conversations.customerId, active.customer.id),
        ne(conversations.status, "spam"),
        ne(conversations.status, "archived"),
      ),
    );

  return rows[0]?.value ?? 0;
}

export async function loadCustomerThreads(input: {
  workspaceSlug: string;
  productSlug: string;
  sessionCookie?: string | null | undefined;
}): Promise<CustomerThreads> {
  const product = await resolveProduct(input.workspaceSlug, input.productSlug);
  if (!product) return { state: "not_found" };

  const intake = await listIntakeQuestions({
    productId: product.id,
    channel: "widget",
  });

  const active = await resolveSession({
    product,
    sessionCookie: input.sessionCookie,
  });
  if (!active) return { state: "signed_out", intake };

  const rows = await db
    .select({
      id: conversations.id,
      subject: conversations.subject,
      preview: conversations.lastMessagePreview,
      status: conversations.status,
      unread: conversations.unreadForCustomer,
      updatedAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.productId, product.id),
        eq(conversations.customerId, active.customer.id),
        ne(conversations.status, "spam"),
        ne(conversations.status, "archived"),
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(50);

  return {
    state: "ready",
    email: active.customer.email,
    unread: rows.reduce((sum, row) => sum + row.unread, 0),
    online: await teamPresence(product.workspaceId),
    intake,
    threads: rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      preview: row.preview,
      status: row.status,
      unread: row.unread,
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}

export async function loadCustomerThread(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  sessionCookie?: string | null | undefined;
}): Promise<
  | { state: "not_found" }
  | { state: "signed_out" }
  | {
      state: "ready";
      thread: CustomerThread;
      email: string | null;
      messages: CustomerMessage[];
      /** True while Mira is enabled and the latest message is still the customer's. */
      junoPending: boolean;
      /** Whether this thread can ask for a rating, and the rating already given. */
      csat: CustomerCsat;
      /** Mira's pending offer; null until the customer confirms or declines. */
      feedbackCard: JunoFeedbackCard | null;
    }
> {
  const product = await resolveProduct(input.workspaceSlug, input.productSlug);
  if (!product) return { state: "not_found" };

  const active = await resolveSession({
    product,
    sessionCookie: input.sessionCookie,
  });
  if (!active) return { state: "signed_out" };

  const rows = await db
    .select({
      id: conversations.id,
      subject: conversations.subject,
      status: conversations.status,
      unread: conversations.unreadForCustomer,
      csatRequestedAt: conversations.csatRequestedAt,
      csatRating: conversations.csatRating,
      csatRatedAt: conversations.csatRatedAt,
      csatReratedAt: conversations.csatReratedAt,
      resolvedAt: conversations.resolvedAt,
      updatedAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.productId, product.id),
        eq(conversations.customerId, active.customer.id),
        ne(conversations.status, "spam"),
        ne(conversations.status, "archived"),
      ),
    )
    .limit(1);

  const thread = rows[0];
  if (!thread) return { state: "not_found" };

  const messages = await db
    .select({
      id: conversationMessages.id,
      authorType: conversationMessages.authorType,
      body: conversationMessages.body,
      citations: conversationMessages.citations,
      createdAt: conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, thread.id),
        eq(conversationMessages.productId, product.id),
        eq(conversationMessages.kind, "message"),
      ),
    )
    .orderBy(conversationMessages.createdAt)
    .limit(200);

  const attachmentRows = await db
    .select({
      id: conversationAttachments.id,
      messageId: conversationAttachments.messageId,
      fileName: conversationAttachments.filename,
      mimeType: conversationAttachments.mimeType,
      byteSize: conversationAttachments.sizeBytes,
      storageKey: conversationAttachments.storageKey,
    })
    .from(conversationAttachments)
    .where(
      and(
        eq(conversationAttachments.conversationId, thread.id),
        eq(conversationAttachments.productId, product.id),
        isNotNull(conversationAttachments.messageId),
      ),
    )
    .orderBy(conversationAttachments.createdAt);

  const attachmentsByMessage = new Map<string, CustomerAttachment[]>();
  for (const attachment of attachmentRows) {
    if (!attachment.messageId) continue;
    const list = attachmentsByMessage.get(attachment.messageId) ?? [];
    list.push({
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize,
      url: createSignedStorageUrl(attachment.storageKey),
      isImage: attachment.mimeType.startsWith("image/"),
    });
    attachmentsByMessage.set(attachment.messageId, list);
  }

  const feedbackCard = await loadPendingFeedbackCard(thread.id);
  const { rerate: reratedReopen } = csatEligibility(thread, new Date());

  const junoRows = await db
    .select({
      enabled: junoSettings.enabled,
      state: junoConversations.state,
    })
    .from(junoSettings)
    .leftJoin(
      junoConversations,
      eq(junoConversations.conversationId, thread.id),
    )
    .where(eq(junoSettings.productId, product.id))
    .limit(1);
  const juno = junoRows[0];
  // An away reply is written by the system, not a teammate. It must not hide
  // the fact that the customer's question is still waiting for Mira, or every
  // first message sent while the team is away would lose its typing hint.
  const lastSubstantiveMessage = [...messages]
    .reverse()
    .find((message) => message.authorType !== "system");
  const junoPending = Boolean(
    juno?.enabled &&
      lastSubstantiveMessage?.authorType === "customer" &&
      (thread.status === "queue" || thread.status === "open") &&
      juno.state !== "paused" &&
      juno.state !== "handed_off",
  );

  return {
    state: "ready",
    email: active.customer.email,
    feedbackCard,
    junoPending,
    csat: {
      requested: thread.csatRequestedAt !== null,
      rating: thread.csatRating,
      canRate:
        thread.csatRequestedAt !== null &&
        thread.status === "resolved" &&
        (thread.csatRating === null || reratedReopen),
    },
    thread: {
      id: thread.id,
      subject: thread.subject,
      status: thread.status,
      unread: thread.unread,
      updatedAt: thread.updatedAt.toISOString(),
      preview: "",
    },
    // System messages are the public side of an automated away reply; they
    // are written by the team and must stay visible to the customer.
    messages: messages.map((message) => ({
      id: message.id,
      author: message.authorType === "customer" ? "customer" : "team",
      fromJuno: message.authorType === "juno",
      citations: message.citations ?? null,
      body: message.body,
      attachments: attachmentsByMessage.get(message.id) ?? [],
      createdAt: message.createdAt.toISOString(),
    })),
  };
}

/**
 * Start a thread.
 *
 * A guest session may supply an address here; that is the only point where a
 * public write attaches an email without verification, and it is stored as
 * unverified (`verified_at` stays null). An existing address is never replaced
 * by a request.
 */
export async function startCustomerConversation(input: {
  workspaceSlug: string;
  productSlug: string;
  subject?: string | null | undefined;
  body: string;
  email?: string | null | undefined;
  sourceUrl?: string | null | undefined;
  sourceContext?: ConversationSourceContext | null | undefined;
  /** Optional intake answers, keyed by trait name; invalid keys are dropped. */
  intake?: unknown;
  /** A validated upload to link to the opening message in the same transaction. */
  attachment?: CustomerAttachmentUpload | null | undefined;
  sessionCookie?: string | null | undefined;
  now?: Date | undefined;
}): Promise<
  | { state: "not_found" }
  | { state: "signed_out" }
  | { state: "invalid"; error: string }
  | { state: "ready"; conversationId: string; messageId: string | null }
> {
  const product = await resolveProduct(input.workspaceSlug, input.productSlug);
  if (!product) return { state: "not_found" };

  const active = await resolveSession({
    product,
    sessionCookie: input.sessionCookie,
  });
  if (!active) return { state: "signed_out" };

  const rawBody = input.body.trim().slice(0, 4000);
  if (rawBody.length === 0 && !input.attachment) {
    return { state: "invalid", error: "Write a message first." };
  }
  // An attachment-only message still needs a customer-visible line in the
  // inbox preview and email fallback; the file itself renders separately.
  const body = rawBody.length > 0 ? rawBody : "Sent an image";

  const email = input.email?.trim() ?? "";
  if (email !== "" && !isValidEmail(email)) {
    return { state: "invalid", error: "Enter a valid email address." };
  }

  const now = input.now ?? new Date();
  const subject =
    input.subject?.replace(/[\r\n]+/g, " ").trim().slice(0, 160) ||
    (input.attachment ? "Image attachment" : "Conversation");
  const verdict = classifyConversationSpam(
    { subject, body },
    await loadSpamRules(db, product.id),
  );

  // Intake never blocks a guest: a missing or malformed answer is ignored, and
  // a failed merge is not allowed to turn a first message into an error.
  if (input.intake !== undefined) {
    await applyIntakeTraits({
      productId: product.id,
      channel: "widget",
      customerId: active.customer.id,
      answers: input.intake,
      now,
    }).catch(() => undefined);
  }

  return db.transaction(async (tx) => {
    if (email !== "" && !active.customer.email) {
      await tx
        .update(customers)
        .set({ email, emailNormalized: emailKey(email), updatedAt: now })
        .where(eq(customers.id, active.customer.id));
    }

    const created = await tx
      .insert(conversations)
      .values({
        workspaceId: product.workspaceId,
        productId: product.id,
        customerId: active.customer.id,
        subject,
        replyToken: createInboundToken(),
        status: verdict.spam ? "spam" : "queue",
        spamReason: verdict.reason,
        sourceUrl: input.sourceUrl ?? null,
        sourceContext: input.sourceContext ?? { channel: "widget" },
        lastMessagePreview: body.slice(0, 160),
        lastMessageAt: now,
        lastCustomerMessageAt: now,
        unreadForTeam: verdict.spam ? 0 : 1,
        updatedAt: now,
      })
      .returning();

    const conversation = created[0];
    if (!conversation) {
      return { state: "invalid" as const, error: "Could not start the conversation." };
    }

    const inserted = await tx
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        productId: product.id,
        authorType: "customer",
        authorCustomerId: active.customer.id,
        channel: "widget",
        body,
        createdAt: now,
      })
      .returning({ id: conversationMessages.id });

    if (inserted[0] && input.attachment) {
      await tx.insert(conversationAttachments).values({
        conversationId: conversation.id,
        productId: product.id,
        messageId: inserted[0].id,
        kind: input.attachment.kind,
        storageKey: input.attachment.storageKey,
        filename: input.attachment.fileName,
        mimeType: input.attachment.mimeType,
        sizeBytes: input.attachment.sizeBytes,
        createdAt: now,
      });
    }

    if (inserted[0] && !verdict.spam) {
      const customerEmail = active.customer.email ?? (email || null);
      await queueCustomerMessageNotifications(tx, {
        workspaceId: product.workspaceId,
        productId: product.id,
        conversationId: conversation.id,
        messageId: inserted[0].id,
        subject,
        body,
        customerName: active.customer.name ?? "Customer",
        kind: "new_conversation",
        now,
      });
      await queueAwayReply(tx, {
        conversation,
        customerEmail,
        now,
      });
    }

    return {
      state: "ready" as const,
      conversationId: conversation.id,
      messageId: inserted[0]?.id ?? null,
    };
  });
}

export async function appendCustomerMessage(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  body: string;
  /** A validated upload to link to the reply in the same transaction. */
  attachment?: CustomerAttachmentUpload | null | undefined;
  sessionCookie?: string | null | undefined;
  now?: Date;
}): Promise<
  | { state: "not_found" }
  | { state: "signed_out" }
  | { state: "invalid"; error: string }
  | { state: "ready"; conversationId: string; messageId: string | null }
> {
  const product = await resolveProduct(input.workspaceSlug, input.productSlug);
  if (!product) return { state: "not_found" };

  const active = await resolveSession({
    product,
    sessionCookie: input.sessionCookie,
  });
  if (!active) return { state: "signed_out" };

  const rawBody = input.body.trim().slice(0, 4000);
  if (rawBody.length === 0 && !input.attachment) {
    return { state: "invalid", error: "Write a message first." };
  }
  const body = rawBody.length > 0 ? rawBody : "Sent an image";

  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.productId, product.id),
          eq(conversations.customerId, active.customer.id),
        ),
      )
      .limit(1)
      .for("update");

    const conversation = rows[0];
    if (!conversation) return { state: "not_found" as const };
    if (conversation.status === "spam") {
      return { state: "invalid" as const, error: "This conversation is closed." };
    }

    const verdict = classifyConversationSpam(
      {
        subject: conversation.subject,
        body,
      },
      await loadSpamRules(tx, product.id),
    );

    const inserted = await tx
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        productId: product.id,
        authorType: "customer",
        authorCustomerId: active.customer.id,
        channel: "widget",
        body,
        createdAt: now,
      })
      .returning({ id: conversationMessages.id });

    if (inserted[0] && input.attachment) {
      await tx.insert(conversationAttachments).values({
        conversationId: conversation.id,
        productId: product.id,
        messageId: inserted[0].id,
        kind: input.attachment.kind,
        storageKey: input.attachment.storageKey,
        filename: input.attachment.fileName,
        mimeType: input.attachment.mimeType,
        sizeBytes: input.attachment.sizeBytes,
        createdAt: now,
      });
    }

    const reopened =
      conversation.status === "resolved" ||
      conversation.status === "snoozed" ||
      conversation.status === "archived";

    await tx
      .update(conversations)
      .set({
        status: verdict.spam ? "spam" : reopened ? "queue" : conversation.status,
        spamReason: verdict.spam ? verdict.reason : conversation.spamReason,
        snoozedUntil: reopened ? null : conversation.snoozedUntil,
        resolvedAt: reopened ? null : conversation.resolvedAt,
        unreadForTeam: verdict.spam ? 0 : conversation.unreadForTeam + 1,
        unreadForCustomer: 0,
        lastMessagePreview: body.slice(0, 160),
        lastMessageAt: now,
        lastCustomerMessageAt: now,
        updatedAt: now,
      })
      .where(eq(conversations.id, conversation.id));

    if (inserted[0] && !verdict.spam) {
      await queueCustomerMessageNotifications(tx, {
        workspaceId: product.workspaceId,
        productId: product.id,
        conversationId: conversation.id,
        messageId: inserted[0].id,
        subject: conversation.subject,
        body,
        customerName: active.customer.name ?? "Customer",
        kind: "reply",
        now,
      });
      await queueAwayReply(tx, {
        conversation,
        customerEmail: active.customer.email,
        now,
      });
    }

    return {
      state: "ready" as const,
      conversationId: conversation.id,
      messageId: inserted[0]?.id ?? null,
    };
  });
}

export type EmailCsatView =
  | { state: "not_found" }
  | {
      state: "ready";
      productName: string;
      subject: string;
      rating: number | null;
      canRate: boolean;
      rerate: boolean;
    };

/** Resolve a rating page from the unguessable reply token, without a session. */
export async function loadEmailCsat(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  token: string;
  now?: Date;
}): Promise<EmailCsatView> {
  const product = await resolveSupportProduct(input.workspaceSlug, input.productSlug);
  if (!product || input.token === "") return { state: "not_found" };

  const rows = await db
    .select({
      subject: conversations.subject,
      csatRequestedAt: conversations.csatRequestedAt,
      csatRating: conversations.csatRating,
      csatRatedAt: conversations.csatRatedAt,
      csatReratedAt: conversations.csatReratedAt,
      resolvedAt: conversations.resolvedAt,
      status: conversations.status,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.productId, product.id),
        eq(conversations.replyToken, input.token),
        ne(conversations.status, "spam"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return { state: "not_found" };

  const { canRate, rerate } = csatEligibility(row, input.now ?? new Date());
  return {
    state: "ready",
    productName: product.name,
    subject: row.subject,
    rating: row.csatRating,
    canRate,
    rerate,
  };
}

export async function submitEmailCsat(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  token: string;
  rating: number;
  now?: Date;
}): Promise<
  | { state: "not_found" }
  | { state: "invalid"; error: string }
  | { state: "ready"; rating: number }
> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { state: "invalid", error: "Choose a rating from 1 to 5." };
  }
  const product = await resolveSupportProduct(input.workspaceSlug, input.productSlug);
  if (!product || input.token === "") return { state: "not_found" };

  const now = input.now ?? new Date();
  const rows = await db
    .select({
      csatRequestedAt: conversations.csatRequestedAt,
      csatRating: conversations.csatRating,
      csatRatedAt: conversations.csatRatedAt,
      csatReratedAt: conversations.csatReratedAt,
      resolvedAt: conversations.resolvedAt,
      status: conversations.status,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.productId, product.id),
        eq(conversations.replyToken, input.token),
      ),
    )
    .limit(1);
  const current = rows[0];
  if (!current) return { state: "not_found" };
  const { canRate, rerate } = csatEligibility(current, now);
  if (!canRate) {
    return current.csatRating !== null
      ? { state: "invalid", error: "This conversation already has a rating." }
      : { state: "invalid", error: "This conversation is not waiting for a rating." };
  }

  const updated = await db
    .update(conversations)
    .set({
      csatRating: input.rating,
      csatRatedAt: now,
      ...(rerate ? { csatReratedAt: now } : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.productId, product.id),
        eq(conversations.replyToken, input.token),
        eq(conversations.status, "resolved"),
        rerate
          ? and(
              isNotNull(conversations.csatRating),
              isNull(conversations.csatReratedAt),
            )
          : isNull(conversations.csatRating),
      ),
    )
    .returning({ id: conversations.id });
  if (updated.length === 0) {
    return { state: "invalid", error: "This conversation already has a rating." };
  }
  return { state: "ready", rating: input.rating };
}

/**
 * Record one CSAT rating on the conversation itself.
 *
 * The rating is not a message, so it never appears in the customer-visible
 * thread. A first rating is accepted once; after a reopen, one update is
 * allowed while the re-resolution is at most seven days old.
 */
export async function submitCustomerCsat(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  rating: number;
  sessionCookie?: string | null | undefined;
  now?: Date;
}): Promise<
  | { state: "not_found" }
  | { state: "signed_out" }
  | { state: "invalid"; error: string }
  | { state: "ready"; rating: number }
> {
  const product = await resolveProduct(input.workspaceSlug, input.productSlug);
  if (!product) return { state: "not_found" };

  const active = await resolveSession({
    product,
    sessionCookie: input.sessionCookie,
  });
  if (!active) return { state: "signed_out" };

  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { state: "invalid", error: "Choose a rating from 1 to 5." };
  }

  const now = input.now ?? new Date();
  const rows = await db
    .select({
      csatRequestedAt: conversations.csatRequestedAt,
      csatRating: conversations.csatRating,
      csatRatedAt: conversations.csatRatedAt,
      csatReratedAt: conversations.csatReratedAt,
      resolvedAt: conversations.resolvedAt,
      status: conversations.status,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.productId, product.id),
        eq(conversations.customerId, active.customer.id),
        eq(conversations.status, "resolved"),
      ),
    )
    .limit(1);
  const current = rows[0];
  if (!current || current.csatRequestedAt === null) {
    return {
      state: "invalid",
      error: "This conversation is not waiting for a rating.",
    };
  }

  const { rerate: rerating } = csatEligibility(current, now);

  if (current.csatRating !== null && !rerating) {
    return {
      state: "invalid",
      error: "This conversation already has a rating.",
    };
  }

  const updated = await db
    .update(conversations)
    .set({
      csatRating: input.rating,
      csatRatedAt: now,
      ...(rerating ? { csatReratedAt: now } : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.productId, product.id),
        eq(conversations.customerId, active.customer.id),
        eq(conversations.status, "resolved"),
        rerating
          ? and(
              isNotNull(conversations.csatRating),
              isNull(conversations.csatReratedAt),
            )
          : isNull(conversations.csatRating),
        sql`${conversations.csatRequestedAt} IS NOT NULL`,
      ),
    )
    .returning({ id: conversations.id });

  if (updated.length === 0) {
    return {
      state: "invalid",
      error: "This conversation is not waiting for a rating.",
    };
  }

  return { state: "ready", rating: input.rating };
}

export async function markCustomerConversationRead(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
  sessionCookie?: string | null | undefined;
}): Promise<{ ok: boolean }> {
  const product = await resolveProduct(input.workspaceSlug, input.productSlug);
  if (!product) return { ok: false };

  const active = await resolveSession({
    product,
    sessionCookie: input.sessionCookie,
  });
  if (!active) return { ok: false };

  const updated = await db
    .update(conversations)
    .set({ unreadForCustomer: 0 })
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.productId, product.id),
        eq(conversations.customerId, active.customer.id),
      ),
    )
    .returning({ id: conversations.id });

  return { ok: updated.length > 0 };
}

/** Resolve a product/workspace pair for servers that must create a session. */
export async function resolveCustomerProductForSession(input: {
  workspaceSlug: string;
  productSlug: string;
}): Promise<{ workspaceId: string; productId: string } | null> {
  const product = await resolveProduct(input.workspaceSlug, input.productSlug);
  return product ? { workspaceId: product.workspaceId, productId: product.id } : null;
}
