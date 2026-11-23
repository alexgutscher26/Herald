import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { conversations } from "@/db/schema/conversations";
import { authorizeAppApi } from "@/features/app-api/auth";
import { publishConversationEvent } from "@/features/live/conversation-events";

/**
 * A typing signal is ephemeral: no table row and no message body. The browser
 * throttles it; the payload only says who is typing in which conversation.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      workspaceSlug: string;
      productSlug: string;
      conversationId: string;
    }>;
  },
): Promise<NextResponse> {
  const { workspaceSlug, productSlug, conversationId } = await context.params;
  const authorized = await authorizeAppApi({
    request,
    workspaceSlug,
    productSlug,
    permission: "conversation:write",
    mutation: true,
  });
  if (!authorized.ok) return authorized.response;

  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.productId, authorized.context.product.id),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
  }

  await publishConversationEvent({
    type: "typing",
    productId: authorized.context.product.id,
    conversationId,
    userId: authorized.context.user.id,
    name: authorized.context.user.name,
    at: Date.now(),
  });

  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
