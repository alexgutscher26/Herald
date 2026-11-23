import "server-only";

import { resolveTxt } from "node:dns/promises";

import { getEmailConfig } from "@/lib/env";

/**
 * Sender-domain authentication lookup.
 *
 * Deliverability starts with three DNS records. This reads them instead of
 * guessing: SPF from the sending domain, DKIM from the provider's selector and
 * DMARC from `_dmarc.<domain>`. Lookups are best-effort and time-boxed, and a
 * failed or slow lookup reports `unknown`, never `missing`, so the page cannot
 * accuse a domain of an unverified problem. No value here is invented: the
 * records shown are what DNS returned.
 */

export type DomainAuthStatus = "ok" | "missing" | "unknown";
export type DomainAuthKey = "spf" | "dkim" | "dmarc";

export type DomainAuthRecord = {
  key: DomainAuthKey;
  label: string;
  host: string;
  status: DomainAuthStatus;
  value: string | null;
};

export type DomainAuthReport = {
  configured: boolean;
  domain: string | null;
  /** Workspace sender identity, or the deployment fallback. */
  source: "workspace" | "deployment" | null;
  records: DomainAuthRecord[];
  ready: boolean;
};

export type TxtResolver = (name: string) => Promise<string[][]>;

const LOOKUP_TIMEOUT_MS = 2000;
const DKIM_SELECTOR = "resend";

/** Pull the domain out of an EMAIL_FROM value such as `Herald <a@b.com>`. */
export function emailDomainFromAddress(from: string | null | undefined): string | null {
  if (!from) return null;
  const match = /@([^>\s,;]+)/.exec(from);
  if (!match?.[1]) return null;
  const domain = match[1].toLowerCase().replace(/[).,;:]+$/, "");
  if (domain.length === 0 || !domain.includes(".")) return null;
  return domain;
}

async function readTxt(
  host: string,
  resolver: TxtResolver,
): Promise<string[] | null> {
  try {
    const rows = await Promise.race([
      resolver(host),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), LOOKUP_TIMEOUT_MS);
      }),
    ]);
    return rows.map((row) => row.join("").trim()).filter((value) => value !== "");
  } catch {
    return null;
  }
}

function pick(values: string[] | null, prefix: string): string | null {
  if (!values) return null;
  return values.find((value) => value.toLowerCase().includes(prefix)) ?? null;
}

/**
 * Check the domain of an explicit sender address. The Settings page passes the
 * workspace's verified identity; the no-argument wrapper keeps the deployment
 * EMAIL_FROM fallback used by older callers.
 */
export async function checkEmailDomainAuthFor(
  from: string | null | undefined,
  options: {
    resolver?: TxtResolver;
    source?: "workspace" | "deployment";
  } = {},
): Promise<DomainAuthReport> {
  const resolver = options.resolver ?? resolveTxt;
  const domain = emailDomainFromAddress(from);
  if (!domain) {
    return {
      configured: false,
      domain: null,
      source: null,
      records: [],
      ready: false,
    };
  }

  const dkimHost = `${DKIM_SELECTOR}._domainkey.${domain}`;
  const dmarcHost = `_dmarc.${domain}`;
  const returnPathHost = `send.${domain}`;

  // Resend puts the envelope From and SPF on `send.<domain>`, but a root SPF
  // record is also valid for this check. Report whichever one actually exists.
  const [rootSpfValues, returnPathSpfValues, dkimValues, dmarcValues] =
    await Promise.all([
      readTxt(domain, resolver),
      readTxt(returnPathHost, resolver),
      readTxt(dkimHost, resolver),
      readTxt(dmarcHost, resolver),
    ]);

  function statusOf(values: string[] | null, prefix: string): DomainAuthStatus {
    if (values === null) return "unknown";
    return pick(values, prefix) ? "ok" : "missing";
  }

  const rootSpf = pick(rootSpfValues, "v=spf1");
  const returnPathSpf = pick(returnPathSpfValues, "v=spf1");
  const spfHost = rootSpf ? domain : returnPathHost;
  const spfValues = rootSpf ? rootSpfValues : returnPathSpfValues;

  const records: DomainAuthRecord[] = [
    {
      key: "spf",
      label: "SPF",
      host: spfHost,
      status: statusOf(spfValues, "v=spf1"),
      value: rootSpf ?? returnPathSpf,
    },
    {
      key: "dkim",
      label: "DKIM",
      host: dkimHost,
      status: statusOf(dkimValues, "p="),
      value: dkimValues?.[0] ?? null,
    },
    {
      key: "dmarc",
      label: "DMARC",
      host: dmarcHost,
      status: statusOf(dmarcValues, "v=dmarc1"),
      value: pick(dmarcValues, "v=dmarc1"),
    },
  ];

  return {
    configured: true,
    domain,
    source: options.source ?? "deployment",
    records,
    ready: records.every((record) => record.status === "ok"),
  };
}

export async function checkEmailDomainAuth(
  resolver: TxtResolver = resolveTxt,
): Promise<DomainAuthReport> {
  let from: string | null = null;
  try {
    from = getEmailConfig()?.EMAIL_FROM ?? null;
  } catch {
    // A half-configured sender is a setup problem the email card already
    // reports; the domain check stays unconfigured rather than throwing.
    from = null;
  }

  return checkEmailDomainAuthFor(from, { resolver, source: "deployment" });
}
