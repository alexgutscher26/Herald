import { describe, expect, test } from "bun:test";

import {
  JUNO_GOLDEN_CASES,
  JUNO_GOLDEN_PROMPT_FINGERPRINT,
  JUNO_GOLDEN_SET_VERSION,
  goldenPromptFingerprint,
  runJunoGoldenSet,
} from "@/features/juno/golden";
import { JUNO_PROMPT_VERSION } from "@/features/juno/prompt-version";

describe("Juno CI golden set", () => {
  test("every golden case passes with the fixed provider stub", () => {
    const result = runJunoGoldenSet();
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(JUNO_GOLDEN_CASES.length);
    expect(result.failed).toBe(0);
  });

  test("the prompt version and golden set move together", () => {
    expect(JUNO_GOLDEN_SET_VERSION).toBe(JUNO_PROMPT_VERSION);
  });

  test("the assembled system prompt matches the pinned fingerprint", () => {
    // A prompt edit without refreshing the golden set changes this hash and
    // fails CI before the change can ship.
    expect(goldenPromptFingerprint()).toBe(JUNO_GOLDEN_PROMPT_FINGERPRINT);
  });
});
