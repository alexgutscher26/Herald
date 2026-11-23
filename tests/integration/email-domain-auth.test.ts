import { afterEach, describe, expect, test } from "bun:test";

import {
  checkEmailDomainAuth,
  checkEmailDomainAuthFor,
  emailDomainFromAddress,
  type TxtResolver,
} from "@/features/email/domain-auth";

/**
 * DNS is never contacted here: the resolver is injected, so each case pins the
 * mapping from records to status without depending on the test machine's DNS.
 */

const previous: Record<string, string | undefined> = {};

afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete previous[key];
  }
});

function configureEmail(from: string): void {
  previous.RESEND_API_KEY ??= process.env.RESEND_API_KEY;
  previous.EMAIL_FROM ??= process.env.EMAIL_FROM;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = from;
}

describe("emailDomainFromAddress", () => {
  test("reads the domain from a display-name address", () => {
    expect(emailDomainFromAddress("Herald <updates@example.test>")).toBe(
      "example.test",
    );
    expect(emailDomainFromAddress("updates@Example.Test")).toBe("example.test");
    expect(emailDomainFromAddress("not-an-address")).toBeNull();
    expect(emailDomainFromAddress(null)).toBeNull();
  });
});

describe("checkEmailDomainAuth", () => {
  test("reports ok when all three records resolve", async () => {
    configureEmail("Herald <updates@example.test>");
    const records: Record<string, string[][]> = {
      "example.test": [["v=spf1 include:_spf.example.test ~all"]],
      "resend._domainkey.example.test": [["p=abc123"]],
      "_dmarc.example.test": [["v=DMARC1; p=none"]],
    };
    const resolver: TxtResolver = async (name) => {
      const value = records[name];
      if (!value) throw new Error("ENOTFOUND");
      return value;
    };

    const report = await checkEmailDomainAuth(resolver);
    expect(report.configured).toBe(true);
    expect(report.domain).toBe("example.test");
    expect(report.ready).toBe(true);
    expect(report.records.map((record) => record.status)).toEqual([
      "ok",
      "ok",
      "ok",
    ]);
    expect(report.records[0]?.value).toContain("v=spf1");
  });

  test("reads SPF from the Resend return-path subdomain", async () => {
    const resolver: TxtResolver = async (name) => {
      if (name === "send.campaigns.test") {
        return [["v=spf1 include:amazonses.com ~all"]];
      }
      if (name === "resend._domainkey.campaigns.test") return [["p=abc123"]];
      if (name === "_dmarc.campaigns.test") return [["v=DMARC1; p=none"]];
      throw new Error("ENOTFOUND");
    };

    const report = await checkEmailDomainAuthFor(
      "Campaigns <news@campaigns.test>",
      { resolver, source: "workspace" },
    );
    expect(report).toMatchObject({
      configured: true,
      domain: "campaigns.test",
      source: "workspace",
      ready: true,
    });
    expect(report.records[0]).toMatchObject({
      key: "spf",
      host: "send.campaigns.test",
      status: "ok",
    });
  });

  test("separates a missing record from a failed lookup", async () => {
    configureEmail("Herald <updates@example.test>");
    const resolver: TxtResolver = async (name) => {
      if (name === "example.test" || name === "send.example.test") return [];
      throw new Error("ENOTFOUND");
    };

    const report = await checkEmailDomainAuth(resolver);
    expect(report.ready).toBe(false);
    expect(report.records.find((record) => record.key === "spf")?.status).toBe(
      "missing",
    );
    expect(report.records.find((record) => record.key === "dkim")?.status).toBe(
      "unknown",
    );
    expect(report.records.find((record) => record.key === "dmarc")?.status).toBe(
      "unknown",
    );
  });

  test("stays unconfigured without a sender address", async () => {
    previous.EMAIL_FROM ??= process.env.EMAIL_FROM;
    previous.RESEND_API_KEY ??= process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.RESEND_API_KEY;

    const report = await checkEmailDomainAuth(async () => []);
    expect(report).toEqual({
      configured: false,
      domain: null,
      source: null,
      records: [],
      ready: false,
    });
  });
});
