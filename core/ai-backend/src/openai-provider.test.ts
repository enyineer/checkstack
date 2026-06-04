import { describe, expect, it } from "bun:test";
import { OpenAiCompatibleConnectionSchema } from "./openai-provider";

/** Minimal valid connection sans spendCap; spread + override `spendCap` per case. */
const baseConfig = {
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "sk-test",
  defaultModel: "deepseek-v4-flash",
};

describe("OpenAiCompatibleConnectionSchema spendCap", () => {
  it("accepts a connection with NO spendCap (unlimited)", () => {
    const parsed = OpenAiCompatibleConnectionSchema.parse({ ...baseConfig });
    expect(parsed.spendCap).toBeUndefined();
  });

  it("treats an empty spendCap object as no cap", () => {
    const parsed = OpenAiCompatibleConnectionSchema.parse({
      ...baseConfig,
      spendCap: {},
    });
    expect(parsed.spendCap).toBeUndefined();
  });

  it("treats blank-string spendCap fields as no cap", () => {
    const parsed = OpenAiCompatibleConnectionSchema.parse({
      ...baseConfig,
      spendCap: { tokenBudget: "", windowMinutes: "" },
    });
    expect(parsed.spendCap).toBeUndefined();
  });

  it("treats an incomplete spendCap (one blank bound) as no cap", () => {
    expect(
      OpenAiCompatibleConnectionSchema.parse({
        ...baseConfig,
        spendCap: { tokenBudget: 1000 },
      }).spendCap,
    ).toBeUndefined();
    expect(
      OpenAiCompatibleConnectionSchema.parse({
        ...baseConfig,
        spendCap: { windowMinutes: 60 },
      }).spendCap,
    ).toBeUndefined();
  });

  it("keeps a fully-specified spendCap", () => {
    const parsed = OpenAiCompatibleConnectionSchema.parse({
      ...baseConfig,
      spendCap: { tokenBudget: 1000, windowMinutes: 60 },
    });
    expect(parsed.spendCap).toEqual({ tokenBudget: 1000, windowMinutes: 60 });
  });

  it("still rejects a present cap with a non-positive bound", () => {
    expect(() =>
      OpenAiCompatibleConnectionSchema.parse({
        ...baseConfig,
        spendCap: { tokenBudget: 0, windowMinutes: 60 },
      }),
    ).toThrow();
  });
});
