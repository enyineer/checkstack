import { describe, it, expect } from "bun:test";
import { createMaskingContext, EMPTY_MASKING_CONTEXT } from "./masking-context";

describe("SecretMaskingContext", () => {
  it("redacts held values in text and deep payloads", () => {
    const ctx = createMaskingContext({
      values: ["token-abc-123", "db-pass-456"],
    });
    expect(ctx.size).toBe(2);
    expect(ctx.maskText("Authorization: token-abc-123")).toBe(
      "Authorization: ****",
    );
    expect(
      ctx.maskDeep({ stdout: "pw=db-pass-456", meta: { n: 1 } }),
    ).toEqual({ stdout: "pw=****", meta: { n: 1 } });
  });

  it("is a no-op when it holds no values", () => {
    expect(EMPTY_MASKING_CONTEXT.size).toBe(0);
    const text = "nothing to mask token-abc-123";
    expect(EMPTY_MASKING_CONTEXT.maskText(text)).toBe(text);
    const payload = { a: "token-abc-123" };
    expect(EMPTY_MASKING_CONTEXT.maskDeep(payload)).toBe(payload);
  });

  it("masks a script echoing its own injected secret", () => {
    const ctx = createMaskingContext({ values: ["gh_injectedSecret999"] });
    const stdout = "echo: gh_injectedSecret999\nexit 0";
    expect(ctx.maskText(stdout)).toBe("echo: ****\nexit 0");
  });
});
