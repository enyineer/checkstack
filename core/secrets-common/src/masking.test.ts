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

  it("masks a value at exactly the minimum length boundary", () => {
    const value = "a".repeat(MIN_MASKABLE_LENGTH); // exactly 4 chars -> masked
    const out = maskSecrets({ text: `x=${value}`, values: [value] });
    expect(out).toBe("x=****");
    const tooShort = "a".repeat(MIN_MASKABLE_LENGTH - 1); // 3 chars -> skipped
    expect(maskSecrets({ text: `y=${tooShort}`, values: [tooShort] })).toBe(
      `y=${tooShort}`,
    );
  });

  it("redacts a value embedded mid-string with no surrounding whitespace", () => {
    const out = maskSecrets({
      text: "prefix" + "tok-abcdef" + "suffix",
      values: ["tok-abcdef"],
    });
    expect(out).toBe("prefix****suffix");
  });

  it("redacts a value across multiple lines of output", () => {
    const out = maskSecrets({
      text: "line1 sk-live-9999\nline2 sk-live-9999\nclean",
      values: ["sk-live-9999"],
    });
    expect(out).toBe("line1 ****\nline2 ****\nclean");
  });

  it("DOCUMENTED LIMIT: an encoded/transformed form of a secret is NOT masked", () => {
    const secret = "topsecretvalue";
    const base64 = Buffer.from(secret).toString("base64");
    // Masking is by literal occurrence only. A script that base64-encodes a
    // secret before printing it defeats masking — this is the documented
    // limitation, asserted here so the contract is explicit + regression-safe.
    const out = maskSecrets({
      text: `encoded=${base64} raw=${secret}`,
      values: [secret],
    });
    expect(out).toContain(base64); // encoded form survives (NOT masked)
    expect(out).toContain("raw=****"); // literal form IS masked
    expect(out).not.toContain(`raw=${secret}`);
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
