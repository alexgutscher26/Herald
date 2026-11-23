import { describe, expect, test } from "bun:test";

import { isSameOriginRequest } from "@/features/customer-session/origin";

const expectedOrigin = "https://app.example.com";

describe("isSameOriginRequest", () => {
  test("accepts a matching origin", () => {
    expect(
      isSameOriginRequest({ origin: expectedOrigin, secFetchSite: null, expectedOrigin }),
    ).toBe(true);
  });

  test("ignores a trailing slash and default port differences", () => {
    expect(
      isSameOriginRequest({
        origin: "https://app.example.com/",
        secFetchSite: "same-origin",
        expectedOrigin,
      }),
    ).toBe(true);
  });

  test("rejects a foreign origin", () => {
    expect(
      isSameOriginRequest({
        origin: "https://evil.example.com",
        secFetchSite: null,
        expectedOrigin,
      }),
    ).toBe(false);
  });

  test("rejects a lookalike subdomain", () => {
    expect(
      isSameOriginRequest({
        origin: "https://app.example.com.evil.test",
        secFetchSite: null,
        expectedOrigin,
      }),
    ).toBe(false);
  });

  test("accepts a missing origin only with a same-origin hint", () => {
    expect(
      isSameOriginRequest({ origin: null, secFetchSite: "same-origin", expectedOrigin }),
    ).toBe(true);
    expect(
      isSameOriginRequest({ origin: null, secFetchSite: null, expectedOrigin }),
    ).toBe(false);
    expect(
      isSameOriginRequest({ origin: null, secFetchSite: "same-site", expectedOrigin }),
    ).toBe(false);
  });

  test("rejects cross-site requests even when the origin looks right", () => {
    expect(
      isSameOriginRequest({
        origin: expectedOrigin,
        secFetchSite: "cross-site",
        expectedOrigin,
      }),
    ).toBe(false);
  });

  test("rejects malformed origins", () => {
    expect(
      isSameOriginRequest({ origin: "not a url", secFetchSite: null, expectedOrigin }),
    ).toBe(false);
  });
});
