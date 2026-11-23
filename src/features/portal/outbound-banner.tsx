"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Message = {
  id: string;
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
};

export function PortalOutboundBanner({
  workspaceSlug,
  productSlug,
  message,
}: {
  workspaceSlug: string;
  productSlug: string;
  message: Message;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    void fetch("/api/public/outbound", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceSlug,
        productSlug,
        messageId: message.id,
        type: "opened",
      }),
    }).catch(() => undefined);
  }, [workspaceSlug, productSlug, message.id]);

  if (!visible) return null;

  function record(type: "clicked" | "dismissed") {
    void fetch("/api/public/outbound", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceSlug,
        productSlug,
        messageId: message.id,
        type,
      }),
    }).catch(() => undefined);
  }

  return (
    <section
      aria-labelledby={`portal-message-${message.id}`}
      className="rounded-xl border border-primary/25 bg-primary/5 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`portal-message-${message.id}`} className="text-sm font-semibold">
            {message.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{message.body}</p>
          {message.ctaUrl ? (
            <Link
              href={message.ctaUrl}
              onClick={() => record("clicked")}
              className="mt-2 inline-block text-sm font-medium underline"
            >
              {message.ctaLabel || "Open"}
            </Link>
          ) : null}
        </div>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            record("dismissed");
            setVisible(false);
          }}
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}
