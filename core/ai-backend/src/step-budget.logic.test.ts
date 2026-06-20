import { describe, expect, test } from "bun:test";
import {
  FINAL_ANSWER_SYSTEM,
  prepareFinalAnswerStep,
} from "./step-budget.logic";

describe("prepareFinalAnswerStep", () => {
  const maxSteps = 8;

  test("lets early steps call tools freely (no override)", () => {
    for (let s = 0; s <= maxSteps - 2; s++) {
      expect(prepareFinalAnswerStep({ stepNumber: s, maxSteps })).toEqual({});
    }
  });

  test("removes all tools AND forces an answer on the final allowed step", () => {
    const r = prepareFinalAnswerStep({ stepNumber: maxSteps - 1, maxSteps });
    expect(r).toEqual({ activeTools: [], system: FINAL_ANSWER_SYSTEM });
  });

  test("the final-step system tells the model to answer now without tools", () => {
    // A reasoning model otherwise keeps 'thinking about searching' and never
    // emits a final answer; the instruction is what makes it conclude.
    expect(FINAL_ANSWER_SYSTEM).toMatch(/no longer call/i);
    expect(FINAL_ANSWER_SYSTEM).toMatch(/final answer/i);
    expect(FINAL_ANSWER_SYSTEM).toMatch(/do not guess/i);
  });

  test("stays forced past the cap (defensive >=)", () => {
    expect(
      prepareFinalAnswerStep({ stepNumber: maxSteps + 3, maxSteps }),
    ).toEqual({ activeTools: [], system: FINAL_ANSWER_SYSTEM });
  });

  test("a single-step budget forces an answer immediately", () => {
    expect(prepareFinalAnswerStep({ stepNumber: 0, maxSteps: 1 })).toEqual({
      activeTools: [],
      system: FINAL_ANSWER_SYSTEM,
    });
  });

  test("carries persistent guidance (an active skill) into the final answer step", () => {
    const skill = 'Active skill "Redneck" - write like a redneck, y\'all.';
    const r = prepareFinalAnswerStep({
      stepNumber: maxSteps - 1,
      maxSteps,
      persistentGuidance: skill,
    });
    expect(r).toEqual({
      activeTools: [],
      system: `${FINAL_ANSWER_SYSTEM}\n\n${skill}`,
    });
    // The style guidance is the LAST thing the model reads on the synthesis
    // step, so it governs the user-visible reply instead of being dropped.
    const system = "system" in r ? r.system : "";
    expect(system.indexOf(FINAL_ANSWER_SYSTEM)).toBeLessThan(
      system.indexOf(skill),
    );
  });

  test("does not alter early steps even with persistent guidance", () => {
    expect(
      prepareFinalAnswerStep({
        stepNumber: 0,
        maxSteps,
        persistentGuidance: "ignored on non-final steps",
      }),
    ).toEqual({});
  });
});
