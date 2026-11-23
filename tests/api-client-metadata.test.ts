import { describe, expect, test } from "bun:test";

import {
  clientMetadataFromHeaders,
  maskIpAddress,
  summarizeUserAgent,
} from "@/features/api-v1/client-metadata";
import { toAuditCsv } from "@/features/data-controls/audit-csv";
import {
  auditFilterQuery,
  parseAuditFilters,
} from "@/features/data-controls/audit-filters";

describe("api token last-seen metadata", () => {
  test("keeps an IPv4 network prefix, never the full address", () => {
    expect(maskIpAddress("203.0.113.42")).toBe("203.0.113.0/24");
    expect(maskIpAddress("198.51.100.7")).toBe("198.51.100.0/24");
  });

  test("keeps a /48 for IPv6 and rejects unusable values", () => {
    expect(maskIpAddress("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(maskIpAddress("[2001:db8:abcd::2]:443")).toBe("2001:db8:abcd::/48");
    expect(maskIpAddress("::1")).toBeNull();
    expect(maskIpAddress("not-an-ip")).toBeNull();
    expect(maskIpAddress("999.1.1.1")).toBeNull();
    expect(maskIpAddress(null)).toBeNull();
  });

  test("summarises the user agent to one printable, bounded label", () => {
    expect(summarizeUserAgent("curl/8.4.0")).toBe("curl/8.4.0");
    expect(summarizeUserAgent("Mozilla/5.0\r\n(sneaky)\u0000")).toBe("Mozilla/5.0 (sneaky)");
    expect(summarizeUserAgent("x".repeat(400))).toHaveLength(120);
    expect(summarizeUserAgent("   ")).toBeNull();
  });

  test("reads the first forwarded address and never stores it in full", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.42, 10.0.0.1",
      "user-agent": "Herald-CI/1.0",
    });
    const seen = clientMetadataFromHeaders(headers);
    expect(seen.ipPrefix).toBe("203.0.113.0/24");
    expect(seen.userAgent).toBe("Herald-CI/1.0");
    expect(JSON.stringify(seen)).not.toContain("203.0.113.42");
  });
});

describe("audit filters", () => {
  test("keeps valid dates and drops anything that is not one", () => {
    expect(parseAuditFilters({ from: "2026-11-01", to: "yesterday" })).toMatchObject({
      from: "2026-11-01",
      to: "",
    });
  });

  test("strips wildcards and control characters from text filters", () => {
    const filters = parseAuditFilters({
      actor: "  ada%_@example.test ",
      search: "role\nchange",
      action: "member.role_changed",
      targetType: "member;drop",
    });
    expect(filters.actor).toBe("ada@example.test");
    expect(filters.search).toBe("role change");
    expect(filters.action).toBe("member.role_changed");
    expect(filters.targetType).toBe("memberdrop");
  });

  test("builds a query string only for the filters that are set", () => {
    const filters = parseAuditFilters({ actor: "ada@example.test", from: "2026-11-01" });
    expect(auditFilterQuery(filters)).toBe("?actor=ada%40example.test&from=2026-11-01");
    expect(auditFilterQuery(parseAuditFilters({}))).toBe("");
  });
});

describe("audit CSV export", () => {
  test("quotes every value and neutralises spreadsheet formulas", () => {
    const csv = toAuditCsv([
      {
        createdAt: "2026-11-20T10:00:00.000Z",
        action: "member.role_changed",
        actorName: "Ada, Lovelace",
        actorEmail: "ada@example.test",
        targetType: "member",
        targetId: "m1",
        metadata: { memberEmail: "bo@example.test", previousRole: "editor", role: "admin" },
      },
      {
        createdAt: "2026-11-20T11:00:00.000Z",
        action: "workspace.name_updated",
        actorName: "=cmd()",
        actorEmail: null,
        targetType: "workspace",
        targetId: "w1",
        metadata: { name: 'a "quoted" name' },
      },
    ]);

    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("timestamp,action,detail,target_type,target_id,actor_name,actor_email");
    expect(lines[1]).toContain('"Ada, Lovelace"');
    expect(lines[1]).toContain('"bo@example.test · editor → admin"');
    expect(lines[2]).toContain('"\'=cmd()"');
    expect(lines[2]).toContain('"name=a ""quoted"" name"');
  });

  test("an empty export is just the header", () => {
    expect(toAuditCsv([])).toBe(
      "timestamp,action,detail,target_type,target_id,actor_name,actor_email\r\n",
    );
  });
});
