/**
 * Coarse "last seen" metadata for API tokens.
 *
 * Storing a full client IP turns an operational convenience into a personal
 * data liability, so only the network prefix is kept: /24 for IPv4 and /48 for
 * IPv6. That is enough to tell "the CI runner" from "a laptop" without making
 * the column a location record. The user agent is trimmed to a short label.
 *
 * Pure: no database, no request context. Unit-tested in
 * `tests/api-client-metadata.test.ts`.
 */

export const MAX_USER_AGENT_LENGTH = 120;

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first ? first : null;
}

/** Mask an IPv4 or IPv6 address down to its network prefix. */
export function maskIpAddress(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;

  // `[2001:db8::1]:443` and `2001:db8::1%eth0` both appear in proxy headers.
  const bracketed = /^\[([^\]]+)\]/.exec(value)?.[1];
  const address = (bracketed ?? value).split("%")[0] ?? "";

  if (address.includes(":")) {
    const hextets = address
      .toLowerCase()
      .split(":")
      .filter((part) => part.length > 0);
    // `::1` and other loopback/unspecified forms have too few groups to place a
    // useful prefix; they are not worth recording.
    if (hextets.length < 3 || hextets.some((part) => !/^[0-9a-f]{0,4}$/.test(part))) {
      return null;
    }
    return `${hextets.slice(0, 3).join(":")}::/48`;
  }

  const octets = address.split(".");
  if (octets.length !== 4) return null;
  if (octets.some((octet) => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)) return null;
  return `${octets.slice(0, 3).join(".")}.0/24`;
}

/** One short, printable user-agent label. */
export function summarizeUserAgent(raw: string | null | undefined): string | null {
  const value = raw?.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return null;
  return value.slice(0, MAX_USER_AGENT_LENGTH);
}

/**
 * Resolve the client's network prefix and user agent from request headers.
 *
 * `x-forwarded-for` is only meaningful when a trusted proxy sets it; that is a
 * deployment concern. The value is never trusted for authorization — it is
 * display metadata on a token that already authenticated.
 */
export function clientMetadataFromHeaders(headers: Headers): {
  ipPrefix: string | null;
  userAgent: string | null;
} {
  const forwarded = firstHeaderValue(headers.get("x-forwarded-for"));
  const direct = firstHeaderValue(headers.get("x-real-ip"));
  const cloudflare = firstHeaderValue(headers.get("cf-connecting-ip"));

  return {
    ipPrefix: maskIpAddress(forwarded ?? direct ?? cloudflare),
    userAgent: summarizeUserAgent(headers.get("user-agent")),
  };
}
