import { z } from "zod";

/**
 * Read-only CRM adapters.
 *
 * They only read company, contact and open-deal data. No create/update call is
 * exposed, so a compromised dashboard cannot write into the customer's CRM.
 */

export const CRM_PROVIDERS = ["hubspot", "salesforce"] as const;
export type CrmProvider = (typeof CRM_PROVIDERS)[number];

export const CRM_PROVIDER_LABELS: Record<CrmProvider, string> = {
  hubspot: "HubSpot",
  salesforce: "Salesforce",
};

export type CrmContact = {
  externalId: string;
  email: string | null;
  lifecycleStage: string | null;
};

export type CrmCompanySnapshot = {
  externalId: string;
  name: string | null;
  domain: string | null;
  contactCount: number;
  openDealCount: number;
  openDealValueCents: number | null;
  annualRevenueCents: number | null;
  contacts: CrmContact[];
};

export class CrmProviderError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "CrmProviderError";
    this.status = status;
  }
}

export function isCrmProvider(value: unknown): value is CrmProvider {
  return typeof value === "string" && (CRM_PROVIDERS as readonly string[]).includes(value);
}

export const crmConfigSchema = z
  .object({
    instanceUrl: z.string().trim().max(2_000).optional(),
  })
  .strict();

export type CrmConfig = z.infer<typeof crmConfigSchema>;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function amountCents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function countValue(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
}

function idsFromAssociations(value: unknown): string[] {
  const associations = record(value);
  if (!associations) return [];
  const results = associations.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((item) => {
      const row = record(item);
      return stringValue(row?.id) ?? (typeof row?.toObjectId === "number" ? String(row.toObjectId) : null);
    })
    .filter((id): id is string => Boolean(id));
}

function escapeSoql(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

async function providerJson<T>(
  input: { fetchImpl?: typeof fetch | undefined },
  url: string,
  init: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new CrmProviderError("Could not reach the CRM.");
  }
  const payload = (await response.json().catch(() => null)) as
    | (T & { message?: string; error?: string })
    | null;
  if (!response.ok) {
    const message =
      typeof payload?.message === "string"
        ? payload.message
        : typeof payload?.error === "string"
          ? payload.error
          : `HTTP ${response.status}`;
    throw new CrmProviderError(`The CRM rejected the request (${message.slice(0, 300)}).`, response.status);
  }
  if (!payload) throw new CrmProviderError("The CRM returned an empty response.", 502);
  return payload;
}

function hubspotHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json",
  };
}

async function hubspotCompany(
  input: { token: string; domain: string | null; externalId: string | null; fetchImpl?: typeof fetch | undefined },
): Promise<CrmCompanySnapshot | null> {
  const headers = hubspotHeaders(input.token);
  let companyId = input.externalId;

  if (!companyId && input.domain) {
    const search = await providerJson<{ results?: { id?: string }[] }>(
      input,
      "https://api.hubapi.com/crm/v3/objects/companies/search",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [{ propertyName: "domain", operator: "EQ", value: input.domain }],
            },
          ],
          properties: ["name", "domain", "annualrevenue"],
          limit: 1,
        }),
      },
    );
    companyId = stringValue(search.results?.[0]?.id);
  }

  if (!companyId) return null;

  const company = await providerJson<{
    id?: string;
    properties?: Record<string, unknown>;
    associations?: Record<string, unknown>;
  }>(
    input,
    `https://api.hubapi.com/crm/v3/objects/companies/${encodeURIComponent(
      companyId,
    )}?properties=name,domain,annualrevenue&associations=contacts,deals`,
    { method: "GET", headers },
  );

  const contactIds = idsFromAssociations(company.associations?.contacts);
  const dealIds = idsFromAssociations(company.associations?.deals);
  const resultId = stringValue(company.id) ?? companyId;

  const [contacts, deals] = await Promise.all([
    contactIds.length > 0
      ? providerJson<{ results?: { id?: string; properties?: Record<string, unknown> }[] }>(
          input,
          "https://api.hubapi.com/crm/v3/objects/contacts/batch/read",
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              inputs: contactIds.slice(0, 100).map((id) => ({ id })),
              properties: ["email", "lifecyclestage"],
            }),
          },
        )
      : Promise.resolve({ results: [] }),
    dealIds.length > 0
      ? providerJson<{ results?: { id?: string; properties?: Record<string, unknown> }[] }>(
          input,
          "https://api.hubapi.com/crm/v3/objects/deals/batch/read",
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              inputs: dealIds.slice(0, 100).map((id) => ({ id })),
              properties: ["amount", "hs_is_closed", "hs_is_closed_won"],
            }),
          },
        )
      : Promise.resolve({ results: [] }),
  ]);

  const openDeals = (deals.results ?? []).filter(
    (deal) => String(deal.properties?.hs_is_closed ?? "").toLowerCase() !== "true",
  );
  const openDealValueCents = openDeals.reduce(
    (sum, deal) => sum + (amountCents(deal.properties?.amount) ?? 0),
    0,
  );

  return {
    externalId: resultId,
    name: stringValue(company.properties?.name),
    domain: stringValue(company.properties?.domain),
    contactCount: contactIds.length,
    openDealCount: openDeals.length,
    openDealValueCents,
    annualRevenueCents: amountCents(company.properties?.annualrevenue),
    contacts: (contacts.results ?? [])
      .map((contact) => ({
        externalId: stringValue(contact.id) ?? "",
        email: stringValue(contact.properties?.email),
        lifecycleStage: stringValue(contact.properties?.lifecyclestage),
      }))
      .filter((contact) => contact.externalId !== ""),
  };
}

async function salesforceQuery<T>(
  input: { token: string; instanceUrl: string; fetchImpl?: typeof fetch | undefined },
  query: string,
): Promise<T> {
  const url = new URL(
    `${input.instanceUrl.replace(/\/+$/, "")}/services/data/v60.0/query`,
  );
  url.searchParams.set("q", query);
  return providerJson<T>(input, url.toString(), {
    method: "GET",
    headers: {
      authorization: `Bearer ${input.token}`,
      accept: "application/json",
    },
  });
}

async function salesforceCompany(input: {
  token: string;
  instanceUrl: string;
  domain: string | null;
  externalId: string | null;
  fetchImpl?: typeof fetch | undefined;
}): Promise<CrmCompanySnapshot | null> {
  const where = input.externalId
    ? `Id = '${escapeSoql(input.externalId)}'`
    : input.domain
      ? `Website LIKE '%${escapeSoql(input.domain)}%'`
      : null;
  if (!where) return null;

  const found = await salesforceQuery<{
    records?: {
      Id?: string;
      Name?: string;
      Website?: string;
      AnnualRevenue?: number | null;
    }[];
  }>(
    { ...input },
    `SELECT Id, Name, Website, AnnualRevenue FROM Account WHERE ${where} LIMIT 1`,
  );
  const account = found.records?.[0];
  const accountId = stringValue(account?.Id);
  if (!account || !accountId) return null;

  const [contactCount, dealTotal, contactRows] = await Promise.all([
    salesforceQuery<{ totalSize?: number }>(
      { ...input },
      `SELECT COUNT() FROM Contact WHERE AccountId = '${escapeSoql(accountId)}'`,
    ),
    salesforceQuery<{ records?: { expr0?: number; expr1?: number | null }[] }>(
      { ...input },
      `SELECT COUNT(Id), SUM(Amount) FROM Opportunity WHERE AccountId = '${escapeSoql(
        accountId,
      )}' AND IsClosed = false`,
    ),
    salesforceQuery<{ records?: { Id?: string; Email?: string | null }[] }>(
      { ...input },
      `SELECT Id, Email FROM Contact WHERE AccountId = '${escapeSoql(accountId)}' LIMIT 200`,
    ),
  ]);

  return {
    externalId: accountId,
    name: stringValue(account.Name),
    domain: stringValue(account.Website),
    contactCount: countValue(contactCount.totalSize),
    openDealCount: countValue(dealTotal.records?.[0]?.expr0),
    openDealValueCents: amountCents(dealTotal.records?.[0]?.expr1),
    annualRevenueCents: amountCents(account.AnnualRevenue),
    contacts: (contactRows.records ?? [])
      .map((contact) => ({
        externalId: stringValue(contact.Id) ?? "",
        email: stringValue(contact.Email),
        lifecycleStage: null,
      }))
      .filter((contact) => contact.externalId !== ""),
  };
}

export async function fetchCrmCompany(input: {
  provider: CrmProvider;
  token: string;
  instanceUrl?: string | null | undefined;
  domain: string | null;
  externalId: string | null;
  fetchImpl?: typeof fetch | undefined;
}): Promise<CrmCompanySnapshot | null> {
  if (input.provider === "hubspot") {
    return hubspotCompany({
      token: input.token,
      domain: input.domain,
      externalId: input.externalId,
      fetchImpl: input.fetchImpl,
    });
  }
  if (!input.instanceUrl) throw new CrmProviderError("Salesforce needs an instance URL.");
  return salesforceCompany({
    token: input.token,
    instanceUrl: input.instanceUrl,
    domain: input.domain,
    externalId: input.externalId,
    fetchImpl: input.fetchImpl,
  });
}
