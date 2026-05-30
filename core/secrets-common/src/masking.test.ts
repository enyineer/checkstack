import { describe, it, expect } from "bun:test";
import {
  maskSecrets,
  maskSecretsDeep,
  DEFAULT_MASK_TOKEN,
  MIN_MASKABLE_LENGTH,
} from "./masking";

describe("maskSecrets", () => {
  it("redacts a literal secret value anywhere in the text", () => {
    const out = maskSecrets({
      text: "connecting with token=s3cret-token-value done",
      values: ["s3cret-token-value"],
    });
    expect(out).toBe(`connecting with token=${DEFAULT_MASK_TOKEN} done`);
    expect(out).not.toContain("s3cret-token-value");
  });

  it("redacts every occurrence, not just the first", () => {
    const out = maskSecrets({
      text: "a=topsecret b=topsecret c=topsecret",
      values: ["topsecret"],
    });
    expect(out).toBe("a=**** b=**** c=****");
  });

  it("masks a script echoing its own injected secret (leak guard)", () => {
    // Simulates a user script that does `console.log(process.env.API_TOKEN)`.
    const stdout = "API_TOKEN is gh_aBcDeF123456 and nothing else";
    const out = maskSecrets({ text: stdout, values: ["gh_aBcDeF123456"] });
    expect(out).not.toContain("gh_aBcDeF123456");
    expect(out).toContain("API_TOKEN is **** and nothing else");
  });

  it("skips trivially-short values to avoid over-masking", () => {
    const shortValue = "ab"; // below MIN_MASKABLE_LENGTH
    expect(shortValue.length).toBeLessThan(MIN_MASKABLE_LENGTH);
    const out = maskSecrets({
      text: "absolutely fabulous tabular",
      values: [shortValue],
    });
    expect(out).toBe("absolutely fabulous tabular");
  });

  it("masks longer values before shorter overlapping ones", () => {
    // "supersecret" contains "secret"; both are secrets. The whole long
    // value must be redacted as one unit, not partially by the short one.
    const out = maskSecrets({
      text: "value=supersecret",
      values: ["secret", "supersecret"],
    });
    expect(out).toBe("value=****");
  });

  it("supports a custom token", () => {
    const out = maskSecrets({
      text: "pw=hunter2pw",
      values: ["hunter2pw"],
      token: "[REDACTED]",
    });
    expect(out).toBe("pw=[REDACTED]");
  });

  it("returns text unchanged when no secret occurs", () => {
    const out = maskSecrets({ text: "nothing here", values: ["absent-value"] });
    expect(out).toBe("nothing here");
  });

  it("dedupes values without error", () => {
    const out = maskSecrets({
      text: "x=dup-value-here y=dup-value-here",
      values: ["dup-value-here", "dup-value-here"],
    });
    expect(out).toBe("x=**** y=****");
  });
});

describe("maskSecretsDeep", () => {
  it("masks strings in nested objects and arrays", () => {
    const out = maskSecretsDeep({
      value: {
        log: ["line with topsecretvalue", "clean line"],
        nested: { token: "topsecretvalue" },
        count: 3,
      },
      values: ["topsecretvalue"],
    });
    expect(out).toEqual({
      log: ["line with ****", "clean line"],
      nested: { token: "****" },
      count: 3,
    });
  });

  it("masks object keys too", () => {
    const out = maskSecretsDeep({
      value: { topsecretvalue: 1 },
      values: ["topsecretvalue"],
    });
    expect(out).toEqual({ "****": 1 });
  });

  it("returns the value unchanged when no maskable values are given", () => {
    const value = { a: "short", b: ["x"] };
    expect(maskSecretsDeep({ value, values: ["ab"] })).toBe(value);
  });

  it("leaves non-string leaves untouched", () => {
    const out = maskSecretsDeep({
      value: { n: 42, b: true, z: null },
      values: ["topsecretvalue"],
    });
    expect(out).toEqual({ n: 42, b: true, z: null });
  });
});
