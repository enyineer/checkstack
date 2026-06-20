import { describe, expect, test } from "bun:test";
import {
  PASSWORD_CRITERIA,
  evaluatePasswordCriteria,
  passwordSchema,
} from "./schemas";

describe("password criteria", () => {
  test("a fully valid password meets every criterion and parses", () => {
    const password = "Abcdef12";
    const evaluated = evaluatePasswordCriteria(password);
    expect(evaluated.every((c) => c.met)).toBe(true);
    expect(passwordSchema.safeParse(password).success).toBe(true);
  });

  test("an empty password meets no criterion", () => {
    const evaluated = evaluatePasswordCriteria("");
    expect(evaluated.every((c) => !c.met)).toBe(true);
  });

  test("each criterion isolates the rule it checks", () => {
    // Missing uppercase only.
    const noUpper = evaluatePasswordCriteria("abcdef12");
    expect(noUpper.find((c) => c.id === "uppercase")?.met).toBe(false);
    expect(noUpper.find((c) => c.id === "lowercase")?.met).toBe(true);
    expect(noUpper.find((c) => c.id === "number")?.met).toBe(true);
    expect(noUpper.find((c) => c.id === "length")?.met).toBe(true);

    // Too short only.
    const short = evaluatePasswordCriteria("Ab1");
    expect(short.find((c) => c.id === "length")?.met).toBe(false);
  });

  test("the checklist stays in lock-step with the schema", () => {
    // A password is schema-valid iff every criterion is met. This guards against
    // the checklist and the schema drifting apart.
    const samples = [
      "Abcdef12",
      "abcdef12",
      "ABCDEF12",
      "Abcdefgh",
      "Ab1",
      "",
      "LongEnough1",
    ];
    for (const sample of samples) {
      const allMet = evaluatePasswordCriteria(sample).every((c) => c.met);
      expect(allMet).toBe(passwordSchema.safeParse(sample).success);
    }
  });

  test("exposes exactly the four documented rules", () => {
    expect(PASSWORD_CRITERIA.map((c) => c.id)).toEqual([
      "length",
      "uppercase",
      "lowercase",
      "number",
    ]);
  });
});
