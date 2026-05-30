import { describe, expect, test } from "bun:test";
import { evaluateSizeCap } from "./size-cap";

const cap = { warnBytes: 150 * 1024 * 1024, blockBytes: 300 * 1024 * 1024 };

describe("evaluateSizeCap", () => {
  test("ok below the warn threshold", () => {
    expect(evaluateSizeCap({ totalSizeBytes: 50 * 1024 * 1024, cap }).level).toBe(
      "ok",
    );
  });

  test("warns between warn and block", () => {
    const v = evaluateSizeCap({ totalSizeBytes: 200 * 1024 * 1024, cap });
    expect(v.level).toBe("warn");
    if (v.level !== "ok") expect(v.message).toContain("200.0MB");
  });

  test("blocks above the block threshold", () => {
    const v = evaluateSizeCap({ totalSizeBytes: 400 * 1024 * 1024, cap });
    expect(v.level).toBe("block");
  });

  test("exactly at a threshold is not over it", () => {
    expect(
      evaluateSizeCap({ totalSizeBytes: cap.warnBytes, cap }).level,
    ).toBe("ok");
    expect(
      evaluateSizeCap({ totalSizeBytes: cap.blockBytes, cap }).level,
    ).toBe("warn");
  });
});
