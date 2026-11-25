import { describe, expect, test } from "bun:test";

import {
  FLAG_DEFAULTS,
  FLAG_ENV_KEYS,
  FEATURE_FLAGS,
  parseFlag,
  resolveFlag,
  resolvedFlags,
} from "@/features/entitlements/flags";
import {
  DEFAULT_PLAN,
  JUNO_DEPLOYMENT_MODEL,
  PLAN_FEATURES,
  PLAN_IDS,
  PLAN_LIMITS,
  PLAN_ORDER,
  PLANS,
  apiRequestsPerMinute,
  checkUsage,
  hasFeature,
  isJunoModelAllowed,
  isPlanId,
  junoModelAllowlist,
  planLimit,
  toPlanId,
} from "@/features/entitlements/plans";

describe("plan catalogue", () => {
  test("every plan defines every feature and limit", () => {
    for (const id of PLAN_IDS) {
      const plan = PLANS[id];
      expect(plan.id).toBe(id);
      expect(plan.name.length).toBeGreaterThan(0);
      for (const feature of PLAN_FEATURES) {
        expect(typeof plan.features[feature]).toBe("boolean");
      }
      for (const limit of PLAN_LIMITS) {
        const value = plan.limits[limit];
        expect(value === null || (typeof value === "number" && value > 0)).toBe(true);
      }
      expect(Array.isArray(plan.junoModels)).toBe(true);
      expect(plan.apiRequestsPerMinute).toBeGreaterThan(0);
    }
  });

  test("API request allowances increase with the plan catalogue", () => {
    expect(apiRequestsPerMinute("free")).toBeLessThan(apiRequestsPerMinute("starter"));
    expect(apiRequestsPerMinute("starter")).toBeLessThan(apiRequestsPerMinute("pro"));
    expect(apiRequestsPerMinute("lifetime")).toBeGreaterThan(0);
    expect(hasFeature("pro", "api")).toBe(true);
    expect(hasFeature("lifetime", "api")).toBe(true);
  });

  test("free is the default and the fallback for unknown values", () => {
    expect(DEFAULT_PLAN).toBe("free");
    expect(toPlanId("free")).toBe("free");
    expect(toPlanId("pro")).toBe("pro");
    expect(toPlanId("enterprise")).toBe("free");
    expect(toPlanId(null)).toBe("free");
    expect(toPlanId(undefined)).toBe("free");
    expect(toPlanId(7)).toBe("free");
  });

  test("isPlanId only accepts catalogue ids", () => {
    expect(isPlanId("pro")).toBe(true);
    expect(isPlanId("PRO")).toBe(false);
    expect(isPlanId("")).toBe(false);
  });

  test("public feedback is available on every plan", () => {
    for (const id of PLAN_IDS) {
      expect(hasFeature(id, "publicFeedback")).toBe(true);
    }
  });

  test("paid capabilities are gated to pro", () => {
    expect(hasFeature("free", "api")).toBe(false);
    expect(hasFeature("free", "ai")).toBe(false);
    expect(hasFeature("pro", "api")).toBe(true);
    expect(hasFeature("pro", "ai")).toBe(true);
  });

  test("Mira models are allowlisted per plan, not only per deployment", () => {
    expect(junoModelAllowlist("free", "gpt-test")).toEqual([]);
    expect(junoModelAllowlist("starter", "gpt-test")).toEqual([]);
    expect(junoModelAllowlist("pro", "gpt-test")).toEqual(["gpt-test"]);
    expect(junoModelAllowlist("lifetime", "gpt-test")).toEqual(["gpt-test"]);
    expect(PLANS.pro.junoModels).toEqual([JUNO_DEPLOYMENT_MODEL]);
    expect(isJunoModelAllowed("pro", "gpt-test", "gpt-test")).toBe(true);
    expect(isJunoModelAllowed("pro", "gpt-test", "other-model")).toBe(false);
    expect(isJunoModelAllowed("free", "gpt-test", "gpt-test")).toBe(false);
    expect(isJunoModelAllowed("pro", null, null)).toBe(true);
  });

  test("guest posting and private boards require pro", () => {
    expect(hasFeature("free", "guestPosting")).toBe(false);
    expect(hasFeature("free", "privateBoards")).toBe(false);
    expect(hasFeature("pro", "guestPosting")).toBe(true);
    expect(hasFeature("pro", "privateBoards")).toBe(true);
  });

  test("products scale with the packaging", () => {
    expect(PLANS.free.limits.products).toBe(1);
    expect(PLANS.starter.limits.products).toBe(5);
    expect(PLANS.pro.limits.products).toBeNull();
    expect(PLANS.starter.name).toBe("Indie");
    expect(PLANS.pro.name).toBe("Professional");
  });

  test("lifetime is a plan but not a fourth pricing card", () => {
    expect(isPlanId("lifetime")).toBe(true);
    expect(PLAN_ORDER).toEqual(["free", "starter", "pro"]);
    expect(PLAN_ORDER).not.toContain("lifetime");
  });

  test("lifetime matches the offer caps and excludes SSO", () => {
    const lifetime = PLANS.lifetime;
    expect(lifetime.limits).toEqual({
      products: null,
      boardsPerProduct: null,
      members: 15,
      monthlyEmails: 5_000,
      monthlyJunoReplies: 150,
      monthlySurveyImpressions: null,
      integrations: null,
    });
    expect(hasFeature("lifetime", "api")).toBe(true);
    expect(hasFeature("lifetime", "ai")).toBe(true);
    expect(hasFeature("lifetime", "advancedSearch")).toBe(true);
    expect(hasFeature("lifetime", "hideAttribution")).toBe(true);
    expect(hasFeature("lifetime", "sso")).toBe(false);
    expect(hasFeature("lifetime", "identityMasking")).toBe(false);
    expect(checkUsage("lifetime", "monthlyJunoReplies", 149).allowed).toBe(true);
    expect(checkUsage("lifetime", "monthlyJunoReplies", 150).allowed).toBe(false);
  });

  test("limits increase with the plan", () => {
    for (const limit of PLAN_LIMITS) {
      const free = planLimit("free", limit);
      const pro = planLimit("pro", limit);
      if (free === null || pro === null) continue;
      expect(pro).toBeGreaterThan(free);
    }
  });
});

describe("checkUsage", () => {
  test("allows usage below the limit and reports what is left", () => {
    const result = checkUsage("free", "boardsPerProduct", 1);
    expect(result).toEqual({
      allowed: true,
      limit: 2,
      current: 1,
      remaining: 1,
    });
  });

  test("refuses the increment that would exceed the limit", () => {
    expect(checkUsage("free", "products", 0).allowed).toBe(true);
    expect(checkUsage("free", "products", 1).allowed).toBe(false);
    expect(checkUsage("free", "members", 2).allowed).toBe(true);
    expect(checkUsage("free", "members", 3).allowed).toBe(false);
  });

  test("remaining never goes negative for an over-limit workspace", () => {
    const result = checkUsage("free", "products", 9);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  test("normalises nonsense counters instead of throwing", () => {
    expect(checkUsage("free", "products", Number.NaN).current).toBe(0);
    expect(checkUsage("free", "products", -5).current).toBe(0);
    expect(checkUsage("free", "products", 0, 0).allowed).toBe(true);
    expect(checkUsage("free", "products", 0, Number.NaN).allowed).toBe(true);
  });

  test("a higher plan allows more before refusing", () => {
    const free = checkUsage("free", "products", 1);
    const pro = checkUsage("pro", "products", 1);
    expect(free.allowed).toBe(false);
    expect(pro.allowed).toBe(true);
  });
});

describe("feature flags", () => {
  test("parses the documented true and false spellings", () => {
    for (const value of ["1", "true", "TRUE", "on", "yes", " enabled "]) {
      expect(parseFlag(value, false)).toBe(true);
    }
    for (const value of ["0", "false", "FALSE", "off", "no", "disabled"]) {
      expect(parseFlag(value, true)).toBe(false);
    }
  });

  test("unset, empty and unrecognised values keep the default", () => {
    expect(parseFlag(undefined, true)).toBe(true);
    expect(parseFlag(null, false)).toBe(false);
    expect(parseFlag("", true)).toBe(true);
    expect(parseFlag("maybe", true)).toBe(true);
    expect(parseFlag("maybe", false)).toBe(false);
  });

  test("defaults describe what ships: public feedback and widget on, api off", () => {
    expect(FLAG_DEFAULTS.public_feedback).toBe(true);
    expect(FLAG_DEFAULTS.widget).toBe(true);
    expect(FLAG_DEFAULTS.api).toBe(false);
  });

  test("resolves each flag from its own variable", () => {
    const env = {
      FLAG_PUBLIC_FEEDBACK: "off",
      FLAG_WIDGET: "on",
      FLAG_API: "1",
    };
    expect(resolveFlag("public_feedback", env)).toBe(false);
    expect(resolveFlag("widget", env)).toBe(true);
    expect(resolveFlag("api", env)).toBe(true);
  });

  test("a malformed value does not accidentally enable a flag", () => {
    expect(resolveFlag("api", { FLAG_API: "sure" })).toBe(false);
    expect(resolveFlag("public_feedback", { FLAG_PUBLIC_FEEDBACK: "nope" })).toBe(true);
  });

  test("every flag has a distinct environment variable", () => {
    const keys = FEATURE_FLAGS.map((flag) => FLAG_ENV_KEYS[flag]);
    expect(new Set(keys).size).toBe(FEATURE_FLAGS.length);
  });

  test("resolvedFlags returns every flag", () => {
    const flags = resolvedFlags({ FLAG_WIDGET: "true" });
    expect(Object.keys(flags).sort()).toEqual([...FEATURE_FLAGS].sort());
    expect(flags.widget).toBe(true);
    expect(flags.api).toBe(false);
  });
});
