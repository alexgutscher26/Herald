import { NextResponse } from "next/server";

import { getConversationThread } from "@/features/conversations/queries";
import { requireProductContext } from "@/lib/authz";

export const dynamic = "force-dynamic";

function markdownSafe(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      workspaceSlug: string;
      productSlug: string;
      conversationId: string;
    }>;
  },
) {
  const { workspaceSlug, productSlug, conversationId } = await params;
  // The route segment becomes a response filename, so never pass an arbitrary
  // string through to the query or the Content-Disposition header.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      conversationId,
    )
  ) {
    return new NextResponse("Conversation not found.", { status: 404 });
  }
  const context = await requireProductContext(
    workspaceSlug,
    productSlug,
    "conversation:read",
  );
  const thread = await getConversationThread({
    productId: context.product.id,
    conversationId,
    userId: context.user.id,
  });
  if (!thread) {
    return new NextResponse("Conversation not found.", { status: 404 });
  }

  const lines: string[] = [
    `# ${markdownSafe(thread.conversation.subject)}`,
    "",
    `- Customer: ${markdownSafe(thread.customer.name)}${
      thread.customer.email ? ` <${thread.customer.email}>` : ""
    }`,
    `- Status: ${thread.conversation.status}`,
    `- Started: ${thread.conversation.createdAt}`,
    `- Assignee: ${thread.assigneeName ?? "Unassigned"}`,
    `- Exported: ${new Date().toISOString()}`,
    "",
  ];
  if (thread.tags.length > 0) {
    lines.push(`Tags: ${thread.tags.map((tag) => tag.name).join(", ")}`, "");
  }
  if (thread.conversation.csat.requested) {
    lines.push(
      `CSAT: ${
        thread.conversation.csat.rating === null
          ? "requested, no rating"
          : `${thread.conversation.csat.rating}/5`
      }`,
      "",
    );
  }
  lines.push("---", "", "## Messages", "");

  for (const message of thread.messages) {
    lines.push(
      `### ${message.authorName} · ${message.authorType}${
        message.kind === "note" ? " · internal note" : ""
      }`,
      "",
      `_${message.createdAt}_`,
      "",
      markdownSafe(message.body),
      "",
    );
  }

  if (thread.attachments.length > 0) {
    lines.push("## Attachments", "");
    for (const attachment of thread.attachments) {
      lines.push(
        `- ${attachment.filename} (${attachment.mimeType}, ${attachment.sizeBytes} bytes) — ${attachment.url}`,
      );
    }
    lines.push("");
  }

  const body = lines.join("\n");
  return new NextResponse(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="conversation-${thread.conversation.id.slice(
        0,
        8,
      )}.md"`,
      "cache-control": "private, no-store",
    },
  });
}
