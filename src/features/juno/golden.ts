import { createHash } from "node:crypto";

import type { JunoSettings } from "@/db/schema/knowledge";

import { cosineSimilarity, hashEmbedding } from "./embedding";
import { buildAnswerPrompt, buildAnswerSystemPrompt, cleanAnswer } from "./policy";
import { JUNO_PROMPT_VERSION } from "./prompt-version";
import { lexicalScore } from "./text";

/**
 * CI golden set.
 *
 * A prompt change is a behavior change. This fixture runs the real prompt
 * builders against a fixed provider stub, so a failing set fails `test:unit`
 * in CI before a prompt-version bump can merge. The fingerprint pins the
 * assembled system prompt as well: editing the prompt without refreshing the
 * golden set (and its version) breaks the build.
 *
 * It is intentionally self-contained: no database, network or API key.
 */

export const JUNO_GOLDEN_SET_VERSION = JUNO_PROMPT_VERSION;

/** SHA-256 of the assembled system prompt for the fixture settings below. */
export const JUNO_GOLDEN_PROMPT_FINGERPRINT =
  "981d1e9d07fe593abe817c20c851638aaa457bef48d23130983b6e45d734ae26";

const settings: JunoSettings = {
  productId: "00000000-0000-4000-8000-000000000000",
  enabled: true,
  duplicateMode: "assisted",
  submissionAssistantEnabled: false,
  tone: "warm",
  replyLength: "medium",
  formality: "neutral",
  emoji: false,
  language: "workspace",
  model: "golden-model",
  confidenceFloor: 0.35,
  dailyBudgetCents: 100,
  autoResolveChatMinutes: 30,
  autoResolveEmailMinutes: 4320,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

export type JunoGoldenCase = {
  id: string;
  question: string;
  sources: { title: string; url: string | null; content: string }[];
  expectedKeywords: string[];
  /** Fixed provider output, including the deliberate style noise `cleanAnswer` removes. */
  stubAnswer: string;
};

export const JUNO_GOLDEN_CASES: JunoGoldenCase[] = [
  {
    id: "invite-teammate",
    question: "How do I invite a teammate?",
    sources: [
      {
        title: "Invite a teammate",
        url: "/help/team/invite",
        content:
          "Open Settings, choose Team, then Invite teammate. Enter an email address and pick a role. The invitation expires after seven days.",
      },
    ],
    expectedKeywords: ["settings", "team", "invite"],
    stubAnswer:
      "Answer: Open Settings, choose Team, then Invite teammate and enter an email address. [1]",
  },
  {
    id: "export-data",
    question: "Can I export my data?",
    sources: [
      {
        title: "Export your data",
        url: "/help/data/export",
        content:
          "Workspace owners can export all requests and customers from Settings, Data. The export is a CSV file and is available immediately.",
      },
    ],
    expectedKeywords: ["settings", "export", "csv"],
    stubAnswer:
      "Answer: Workspace owners can export a CSV from Settings, Data. [1]",
  },
  {
    id: "unknown-answer",
    question: "Do you offer a mobile app?",
    sources: [
      {
        title: "Invite a teammate",
        url: "/help/team/invite",
        content: "Open Settings, choose Team, then Invite teammate.",
      },
    ],
    expectedKeywords: [],
    stubAnswer: "",
  },
];

export type GoldenResult = {
  passed: number;
  failed: number;
  failures: string[];
  fingerprint: string;
  promptVersion: string;
};

function sourceScore(
  question: string,
  source: { content: string },
): number {
  const lexical = lexicalScore(question, source.content);
  const vector = Math.max(
    0,
    cosineSimilarity(hashEmbedding(question), hashEmbedding(source.content)),
  );
  return Math.min(1, 0.6 * lexical + 0.4 * vector);
}

function keywordScore(answer: string, expected: string[]): number {
  const wanted = expected.map((keyword) => keyword.toLowerCase());
  if (wanted.length === 0) return 1;
  const normalized = answer.toLowerCase();
  return wanted.filter((keyword) => normalized.includes(keyword)).length / wanted.length;
}

export function goldenPromptFingerprint(): string {
  const system = buildAnswerSystemPrompt(settings, "en");
  return createHash("sha256").update(system).digest("hex");
}

/**
 * Run every case through the real prompt builders with a fixed stub.
 * A handoff case (`stubAnswer` empty) must not clear the confidence floor.
 */
export function runJunoGoldenSet(): GoldenResult {
  const system = buildAnswerSystemPrompt(settings, "en");
  const failures: string[] = [];
  let passed = 0;

  for (const testCase of JUNO_GOLDEN_CASES) {
    const best = testCase.sources
      .map((source) => ({
        source,
        score: sourceScore(testCase.question, source),
      }))
      .sort((left, right) => right.score - left.score)[0];

    const handoffCase = testCase.stubAnswer.trim() === "";
    if (handoffCase) {
      if (best && best.score >= settings.confidenceFloor) {
        failures.push(`${testCase.id}: expected a handoff, but a source cleared the floor.`);
      } else {
        passed += 1;
      }
      continue;
    }

    if (!best || best.score < settings.confidenceFloor) {
      failures.push(`${testCase.id}: no source cleared the confidence floor.`);
      continue;
    }

    const prompt = buildAnswerPrompt({
      question: testCase.question,
      history: [],
      sources: testCase.sources,
    });
    if (!prompt.includes(testCase.question)) {
      failures.push(`${testCase.id}: the customer question was not included verbatim.`);
      continue;
    }
    if (system.trim() === "") {
      failures.push(`${testCase.id}: the system prompt was empty.`);
      continue;
    }

    const answer = cleanAnswer(testCase.stubAnswer);
    if (answer === "" || keywordScore(answer, testCase.expectedKeywords) < 1) {
      failures.push(`${testCase.id}: the stub answer missed an expected phrase.`);
      continue;
    }
    if (/\[1\]\s*$/.test(answer) || /^answer:/i.test(answer)) {
      failures.push(`${testCase.id}: cleanAnswer left provider noise in the answer.`);
      continue;
    }
    passed += 1;
  }

  return {
    passed,
    failed: JUNO_GOLDEN_CASES.length - passed,
    failures,
    fingerprint: goldenPromptFingerprint(),
    promptVersion: JUNO_PROMPT_VERSION,
  };
}
