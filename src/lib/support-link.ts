const SUPPORT_EMAIL = "support@herald.app";

const PRODUCT_ROUTE = /^\/(?:app|p)\/([^/]+)\/([^/]+)(?:\/.*)?$/;

type SupportLinkInput = {
  /** The route the person was on. Query strings and hashes are ignored. */
  pathname?: string | null | undefined;
  /** Next.js error digest, if the boundary received one. */
  digest?: string | undefined;
  /** Extra sentence for the person to complete, e.g. what access they need. */
  note?: string | undefined;
  /** Injectable for deterministic tests. */
  occurredAt?: Date | undefined;
};

/**
 * Build a support link that pre-fills the conversation with the route, error
 * reference and time. It never includes the error message or request data, so a
 * stack trace, SQL fragment or customer payload cannot leak into a message.
 *
 * Product routes go to the portal support form; every other route falls back to
 * the support mailbox because there is no portal to attach the conversation to.
 */
export function buildSupportHref({
  pathname,
  digest,
  note,
  occurredAt = new Date(),
}: SupportLinkInput): string {
  const path = (pathname ?? "").split(/[?#]/, 1)[0] || "(unknown page)";
  const subject = `Herald support: error on ${path}`.slice(0, 160);
  const lines = [
    "I ran into an error in Herald.",
    "",
    `Page: ${path}`,
    `Time: ${occurredAt.toISOString()}`,
    ...(digest ? [`Reference: ${digest}`] : []),
    "",
    note ?? "What I was doing:",
  ];

  const params = new URLSearchParams({ subject, body: lines.join("\n") });
  const product = PRODUCT_ROUTE.exec(path);

  if (product) {
    return `/p/${product[1]}/${product[2]}/support?${params.toString()}`;
  }

  return `mailto:${SUPPORT_EMAIL}?${params.toString()}`;
}
