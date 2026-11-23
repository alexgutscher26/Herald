import { describe, expect, test } from "bun:test";

import {
  DEFAULT_AUTHENTICATED_PATH,
  safePostAuthRedirect,
  withRedirectParam,
} from "@/lib/redirect";

const NUL = String.fromCharCode(0x00);
const DEL = String.fromCharCode(0x7f);
const LF = String.fromCharCode(0x0a);
const CR = String.fromCharCode(0x0d);

describe("safePostAuthRedirect", () => {
  test("returns the default when nothing valid is supplied", () => {
    expect(safePostAuthRedirect(undefined)).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safePostAuthRedirect(null)).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safePostAuthRedirect("")).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safePostAuthRedirect(42)).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safePostAuthRedirect({})).toBe(DEFAULT_AUTHENTICATED_PATH);
  });

  test("accepts destinations inside the application area", () => {
    expect(safePostAuthRedirect("/app")).toBe("/app");
    expect(safePostAuthRedirect("/app/acme/widget/releases")).toBe("/app/acme/widget/releases");
    expect(safePostAuthRedirect("/app?tab=3")).toBe("/app?tab=3");
    expect(safePostAuthRedirect("/app/acme?filter=open#top")).toBe("/app/acme?filter=open#top");
  });

  test("rejects absolute and protocol-relative URLs", () => {
    expect(safePostAuthRedirect("https://evil.example")).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safePostAuthRedirect("http://evil.example")).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safePostAuthRedirect("//evil.example")).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safePostAuthRedirect("///evil.example")).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safePostAuthRedirect("/\\evil.example")).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safePostAuthRedirect("\\\\evil.example")).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safePostAuthRedirect("javascript:alert(1)")).toBe(DEFAULT_AUTHENTICATED_PATH);
  });

  test("rejects lookalike prefixes outside /app", () => {
    expect(safePostAuthRedirect("/application")).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safePostAuthRedirect("/app-evil")).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safePostAuthRedirect("/app/../../etc/passwd")).toBe("/app/../../etc/passwd");
    expect(safePostAuthRedirect("/sign-in")).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safePostAuthRedirect("/")).toBe(DEFAULT_AUTHENTICATED_PATH);
  });

  test("rejects embedded backslashes", () => {
    expect(safePostAuthRedirect("/app\\..\\evil")).toBe(DEFAULT_AUTHENTICATED_PATH);
  });

  test("rejects control characters used for header or URL smuggling", () => {
    expect(safePostAuthRedirect(`/app${CR}${LF}Location: https://evil.example`)).toBe(
      DEFAULT_AUTHENTICATED_PATH,
    );
    expect(safePostAuthRedirect(`/app${LF}`)).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safePostAuthRedirect(`/app${NUL}`)).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safePostAuthRedirect(`/app${DEL}`)).toBe(DEFAULT_AUTHENTICATED_PATH);
  });

  test("rejects absurdly long values", () => {
    expect(safePostAuthRedirect(`/app/${"a".repeat(2000)}`)).toBe(DEFAULT_AUTHENTICATED_PATH);
  });
});

describe("withRedirectParam", () => {
  test("appends the parameter to a bare path", () => {
    expect(withRedirectParam("/sign-in", "/app/x")).toBe("/sign-in?redirect=%2Fapp%2Fx");
  });

  test("uses & when the path already has a query string", () => {
    expect(withRedirectParam("/sign-in?lang=en", "/app")).toBe(
      "/sign-in?lang=en&redirect=%2Fapp",
    );
  });

  test("round-trips through safePostAuthRedirect", () => {
    const url = withRedirectParam("/sign-in", "/app/acme/widget");
    const value = new URL(url, "http://localhost").searchParams.get("redirect");
    expect(safePostAuthRedirect(value)).toBe("/app/acme/widget");
  });
});