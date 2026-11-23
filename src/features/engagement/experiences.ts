/**
 * Tours and banners: content, schedule and frequency rules.
 *
 * Pure so the create/update form, the public delivery query and the tests share
 * one interpretation. Stored content is sanitised here rather than trusted from
 * the JSON textarea: the loader reads it directly in every visitor's browser.
 */

import type { ExperienceContent, ExperienceCopy } from "@/db/schema/engagement";

import { matchesTargeting, normalizeTargetingRules } from "./rules";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The loader's locale switch only knows these two. */
export const EXPERIENCE_LOCALES = ["en", "es"] as const;
export type ExperienceLocale = (typeof EXPERIENCE_LOCALES)[number];

export function isExperienceLocale(value: unknown): value is ExperienceLocale {
  return (
    typeof value === "string" &&
    (EXPERIENCE_LOCALES as readonly string[]).includes(value)
  );
}

type RawRecord = Record<string, unknown>;

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : null;
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseInput(input: unknown): RawRecord | null {
  if (typeof input === "string") {
    try {
      return record(JSON.parse(input) as unknown);
    } catch {
      return null;
    }
  }
  return record(input);
}

function webUrl(value: string): boolean {
  return value === "" || /^(https?:\/\/|\/)/.test(value);
}

const CTA_PANELS = new Set([
  "home",
  "feedback",
  "roadmap",
  "updates",
  "messages",
  "notifications",
]);

function normalizeStep(
  raw: unknown,
  locale: string,
  index: number,
): { ok: true; step: StepCopy } | { ok: false; error: string } {
  const entry = record(raw);
  if (!entry) {
    return { ok: false, error: `${locale.toUpperCase()} step ${index + 1} must be an object.` };
  }
  const title = clean(entry.title, 200);
  const body = clean(entry.body, 2000);
  if (!title || !body) {
    return {
      ok: false,
      error: `${locale.toUpperCase()} step ${index + 1} needs a title and body.`,
    };
  }
  const selector = clean(entry.selector, 300);
  const pageUrl = clean(entry.pageUrl, 2000);
  if (pageUrl && !webUrl(pageUrl)) {
    return {
      ok: false,
      error: `${locale.toUpperCase()} step ${index + 1} has an invalid page URL.`,
    };
  }
  const audience = normalizeTargetingRules(entry.audience);
  return {
    ok: true,
    step: {
      selector,
      title,
      body,
      ...(pageUrl ? { pageUrl } : {}),
      ...(audience.length > 0 ? { audience } : {}),
    },
  };
}

/**
 * Drop steps whose attribute audience does not match this customer.
 *
 * The loader evaluates page, time, selector and event rules because only the
 * browser knows them; it deliberately ignores attribute rules. Applying those
 * here, where customer traits exist, gives every step the same audience model
 * as the experience instead of refusing the rule.
 */
export function filterExperienceStepAudience(
  content: ExperienceContent,
  attributes: Record<string, string | number | boolean | null>,
): ExperienceContent {
  const result: ExperienceContent = {};
  for (const [locale, copy] of Object.entries(content)) {
    if (!copy.steps || copy.steps.length === 0) {
      result[locale] = copy;
      continue;
    }
    const steps = copy.steps.filter((step) => {
      const rules = (step.audience ?? []).filter(
        (rule) => rule.type === "attribute",
      );
      return rules.length === 0 || matchesTargeting(rules, { attributes });
    });
    result[locale] = { ...copy, steps };
  }
  return result;
}

type StepCopy = NonNullable<ExperienceCopy["steps"]>[number];

function normalizeCopy(
  raw: unknown,
  locale: string,
  kind: "tour" | "banner",
): { ok: true; copy: ExperienceCopy } | { ok: false; error: string } {
  const entry = record(raw);
  if (!entry) {
    return { ok: false, error: `${locale.toUpperCase()} content must be an object.` };
  }
  const title = clean(entry.title, 200);
  const body = clean(entry.body, 4000);
  if (!title || !body) {
    return { ok: false, error: `Add ${locale.toUpperCase()} title and body copy.` };
  }
  const ctaUrl = clean(entry.ctaUrl, 2000);
  if (ctaUrl && !webUrl(ctaUrl)) {
    return { ok: false, error: `${locale.toUpperCase()} call-to-action URL must start with / or http(s)://.` };
  }
  const ctaPanel = clean(entry.ctaPanel, 40);
  if (ctaPanel && !CTA_PANELS.has(ctaPanel)) {
    return { ok: false, error: `${locale.toUpperCase()} call-to-action panel is not a widget panel.` };
  }

  const copy: ExperienceCopy = {
    title,
    body,
    ctaLabel: clean(entry.ctaLabel, 80) || undefined,
    ctaUrl: ctaUrl || undefined,
    ctaPanel: ctaPanel || undefined,
  };
  if (kind !== "tour") return { ok: true, copy };

  const rawSteps = Array.isArray(entry.steps) ? entry.steps : [];
  if (rawSteps.length === 0) {
    return { ok: false, error: `A ${locale.toUpperCase()} tour needs at least one step.` };
  }
  if (rawSteps.length > 20) {
    return { ok: false, error: `${locale.toUpperCase()} tours support at most 20 steps.` };
  }
  const steps: StepCopy[] = [];
  for (let index = 0; index < rawSteps.length; index += 1) {
    const result = normalizeStep(rawSteps[index], locale, index);
    if (!result.ok) return result;
    steps.push(result.step);
  }
  copy.steps = steps;
  return { ok: true, copy };
}

export type ExperienceContentResult =
  | { ok: true; content: ExperienceContent; locale: ExperienceLocale }
  | { ok: false; error: string };

/**
 * Validate every locale variant, not just the default.
 *
 * The loader selects a variant wholesale, with no per-field fallback, so a
 * half-translated Spanish entry would otherwise replace complete English copy
 * on Spanish hosts. An optional locale is free to be absent; if present it must
 * stand on its own.
 */
export function normalizeExperienceContent(
  input: unknown,
  kind: "tour" | "banner",
  defaultLocale: string,
): ExperienceContentResult {
  const raw = parseInput(input);
  if (!raw) {
    return { ok: false, error: "Content must be a JSON object keyed by locale." };
  }
  const unknownLocales = Object.keys(raw).filter(
    (key) => !isExperienceLocale(key),
  );
  if (unknownLocales.length > 0) {
    return {
      ok: false,
      error: `Unsupported content locale: ${unknownLocales.join(", ")}. Use en or es.`,
    };
  }

  const locale: ExperienceLocale = isExperienceLocale(defaultLocale)
    ? defaultLocale
    : "en";
  const content: ExperienceContent = {};
  for (const key of EXPERIENCE_LOCALES) {
    if (!(key in raw)) continue;
    const result = normalizeCopy(raw[key], key, kind);
    if (!result.ok) return result;
    content[key] = result.copy;
  }
  if (!content[locale]) {
    return { ok: false, error: `Add ${locale.toUpperCase()} title and body copy.` };
  }
  return { ok: true, content, locale };
}

export function experienceScheduleProblem(
  start: Date | null,
  end: Date | null,
): string | null {
  if (start && end && end.getTime() <= start.getTime()) {
    return "The end of the schedule must be after its start.";
  }
  return null;
}

export type ExperienceScheduleState = "always" | "scheduled" | "live" | "ended";

/** Describe the window for the admin list; delivery uses the same comparison. */
export function experienceScheduleState(
  schedule: { scheduleStart: Date | null; scheduleEnd: Date | null },
  now = Date.now(),
): ExperienceScheduleState {
  if (schedule.scheduleStart && schedule.scheduleStart.getTime() > now) {
    return "scheduled";
  }
  if (schedule.scheduleEnd && schedule.scheduleEnd.getTime() < now) {
    return "ended";
  }
  return schedule.scheduleStart || schedule.scheduleEnd ? "live" : "always";
}

export function frequencyReached(
  viewedAt: readonly Date[],
  cap: number,
  windowDays: number,
  now = Date.now(),
): boolean {
  if (!Number.isFinite(cap) || cap <= 0) return false;
  const since = now - Math.max(1, windowDays) * DAY_MS;
  let count = 0;
  for (const at of viewedAt) {
    if (at.getTime() > since) count += 1;
  }
  return count >= cap;
}

export function frequencyLabel(cap: number, windowDays: number): string {
  if (!Number.isFinite(cap) || cap <= 0) return "Unlimited impressions";
  return `${cap} per ${windowDays} day${windowDays === 1 ? "" : "s"}`;
}

