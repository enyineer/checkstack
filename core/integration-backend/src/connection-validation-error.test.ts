import { describe, expect, it } from "bun:test";
import { z } from "zod";

import {
  buildConfigValidationErrorData,
  CONFIG_VALIDATION_ERROR_CODE,
} from "./connection-validation-error";

const connectionSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url(),
  spendCap: z.object({ tokenBudget: z.number().positive() }).optional(),
});

function errorFor(input: unknown): z.ZodError {
  const result = connectionSchema.safeParse(input);
  if (result.success) throw new Error("expected validation to fail");
  return result.error;
}

describe("buildConfigValidationErrorData", () => {
  it("tags the payload with the config-validation discriminator", () => {
    const data = buildConfigValidationErrorData(
      errorFor({ apiKey: "", baseUrl: "not-a-url" }),
    );
    expect(data.code).toBe(CONFIG_VALIDATION_ERROR_CODE);
    expect(data.issues.length).toBeGreaterThan(0);
  });

  it("carries top-level field paths and messages", () => {
    const data = buildConfigValidationErrorData(
      errorFor({ apiKey: "", baseUrl: "https://x.test" }),
    );
    const apiKeyIssue = data.issues.find((i) => i.path[0] === "apiKey");
    expect(apiKeyIssue).toBeDefined();
    expect(typeof apiKeyIssue?.message).toBe("string");
  });

  it("carries nested field paths", () => {
    const data = buildConfigValidationErrorData(
      errorFor({
        apiKey: "sk",
        baseUrl: "https://x.test",
        spendCap: { tokenBudget: -1 },
      }),
    );
    const nested = data.issues.find(
      (i) => i.path[0] === "spendCap" && i.path[1] === "tokenBudget",
    );
    expect(nested).toBeDefined();
  });

  it("yields a JSON-roundtrippable payload (string/number paths only)", () => {
    const data = buildConfigValidationErrorData(
      errorFor({ apiKey: "", baseUrl: "bad" }),
    );
    const roundtripped: unknown = JSON.parse(JSON.stringify(data));
    expect(roundtripped).toEqual(data);
    for (const issue of data.issues) {
      for (const segment of issue.path) {
        expect(["string", "number"]).toContain(typeof segment);
      }
    }
  });
});
