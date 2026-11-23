import { describe, expect, test } from "bun:test";

import { buildRequestBrief, type RequestBriefInput } from "@/features/feedback/brief";

/**
 * The brief is the agent wedge: one request rendered the same way every time.
 * These tests pin the exact Markdown, prove array order cannot change it, and
 * prove internal notes and contact details cannot reach the output.
 */

const base: RequestBriefInput = {
  workspaceSlug: "acme",
  productName: "Acme Cloud",
  requestId: "11111111-2222-4333-8444-555555555555",
  title: "Single sign-on for enterprise accounts",
  body: "Enterprise buyers keep asking for SAML SSO.\nThey cannot roll us out without it.",
  status: "planned",
  category: "feature_request",
  boardName: "Feedback",
  createdAt: new Date("2026-10-01T09:00:00.000Z"),
  updatedAt: new Date("2026-11-02T12:00:00.000Z"),
  voteCount: 7,
  teamVoteCount: 2,
  importedVoteCount: 1,
  voters: [
    { id: "v1", name: "Ada Lovelace", company: "Northwind" },
    { id: "v2", name: "Grace Hopper", company: "Acme Corp" },
    { id: "v3", name: "Alan Turing", company: "Acme Corp" },
    { id: "v4", name: "Katherine Johnson", company: null },
  ],
  insights: [
    {
      quote: "Our security review blocks any tool without SAML.",
      source: "email",
      authorLabel: "Grace Hopper",
      occurredAt: new Date("2026-10-05T08:00:00.000Z"),
    },
    {
      quote: "We cannot sign the contract without SSO.",
      source: "call",
      authorLabel: "Ada Lovelace",
      occurredAt: new Date("2026-10-02T15:30:00.000Z"),
    },
  ],
  comments: [
    {
      body: "Internal: pricing is not agreed, do not quote this.",
      authorName: "Dana Team",
      authorType: "team",
      createdAt: new Date("2026-10-03T09:00:00.000Z"),
      internal: true,
    },
    {
      body: "Would this include SCIM provisioning too?",
      authorName: "Ada Lovelace",
      authorType: "customer",
      createdAt: new Date("2026-10-06T10:00:00.000Z"),
    },
  ],
  tags: ["sso", "enterprise", "sso"],
  releases: [
    { title: "Single sign-on", slug: "sso", status: "draft", publishedAt: null },
  ],
};

const expected = `# Single sign-on for enterprise accounts

Request brief for **Acme Cloud** · workspace \`acme\` · request \`11111111-2222-4333-8444-555555555555\`.

## Problem

Enterprise buyers keep asking for SAML SSO.
They cannot roll us out without it.

## Evidence

- **2026-10-02** · call · Ada Lovelace
  > We cannot sign the contract without SSO.
- **2026-10-05** · email · Grace Hopper
  > Our security review blocks any tool without SAML.
- **2026-10-06** · public comment · Ada Lovelace
  > Would this include SCIM provisioning too?

## Demand

Votes: 7 (customer votes 4, team votes 2, imported 1).

Segments:

- Acme Corp — 2 customers
- No company — 1 customer
- Northwind — 1 customer

## Current status

- Status: Planned
- Category: Feature request
- Board: Feedback
- Tags: enterprise, sso
- Linked releases: "Single sign-on" (draft)
- Created: 2026-10-01
- Updated: 2026-11-02

## Open questions

- What is explicitly out of scope for a first version?
- How will we know this worked after it ships?
`;

describe("buildRequestBrief", () => {
  test("renders the full brief as stable Markdown", () => {
    expect(buildRequestBrief(base)).toBe(expected);
  });

  test("does not depend on the order rows arrive in", () => {
    const shuffled: RequestBriefInput = {
      ...base,
      voters: [...base.voters].reverse(),
      insights: [...base.insights].reverse(),
      comments: [...base.comments].reverse(),
      tags: [...base.tags].reverse(),
      releases: [...base.releases].reverse(),
    };

    expect(buildRequestBrief(shuffled)).toBe(expected);
  });

  test("never renders an internal note or a contact detail", () => {
    const withSecrets = {
      ...base,
      authorEmail: "author@example.test",
      voters: base.voters.map((voter) => ({ ...voter, email: "voter@example.test" })),
      insights: base.insights.map((insight) => ({
        ...insight,
        email: "insight@example.test",
      })),
      comments: base.comments.map((comment) => ({
        ...comment,
        email: "comment@example.test",
      })),
    } as RequestBriefInput;

    const markdown = buildRequestBrief(withSecrets);

    expect(markdown).not.toContain("internal note");
    expect(markdown).not.toContain("pricing is not agreed");
    expect(markdown).not.toContain("do not quote this");
    expect(markdown).not.toContain("example.test");
    expect(markdown).not.toContain("author@");
  });

  test("states every gap explicitly for an empty request", () => {
    const markdown = buildRequestBrief({
      ...base,
      title: "Empty request",
      body: "   ",
      status: "open",
      voteCount: 0,
      teamVoteCount: 0,
      importedVoteCount: 0,
      voters: [],
      insights: [],
      comments: [],
      tags: [],
      releases: [],
    });

    expect(markdown).toContain("_No description was provided._");
    expect(markdown).toContain("_No customer quotes or public comments recorded yet._");
    expect(markdown).toContain("No votes are recorded yet.");
    expect(markdown).toContain("No customer segments are recorded as voters.");
    expect(markdown).toContain("- Tags: none");
    expect(markdown).toContain("- Linked releases: none");
    expect(markdown).toContain(
      "- This is still Open. Has it been triaged and scoped?",
    );
    expect(markdown).toContain(
      "- No customer quotes are recorded. What did customers say, in their own words?",
    );
    expect(markdown).toContain(
      "- No release is linked. Which milestone should this ship in?",
    );
  });
});
