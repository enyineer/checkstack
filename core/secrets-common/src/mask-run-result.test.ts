import { describe, it, expect } from "bun:test";
import { maskScriptRunOutput } from "./mask-run-result";

describe("maskScriptRunOutput", () => {
  it("redacts secret values from stdout, stderr, error, and result", () => {
    const masked = maskScriptRunOutput({
      output: {
        result: { token: "gh_secretToken123", nested: ["gh_secretToken123"] },
        stdout: "printing gh_secretToken123 to stdout",
        stderr: "error referencing db-password-456",
        error: "failed with db-password-456",
      },
      values: ["gh_secretToken123", "db-password-456"],
    });
    expect(masked.stdout).toBe("printing **** to stdout");
    expect(masked.stderr).toBe("error referencing ****");
    expect(masked.error).toBe("failed with ****");
    expect(masked.result).toEqual({ token: "****", nested: ["****"] });
  });

  it("is a no-op with an empty value set (Phase 1 default)", () => {
    const output = {
      result: { token: "gh_secretToken123" },
      stdout: "gh_secretToken123",
      stderr: "",
    };
    const masked = maskScriptRunOutput({ output, values: [] });
    expect(masked).toBe(output);
  });

  it("leaves result/error absent when not provided", () => {
    const masked = maskScriptRunOutput({
      output: { stdout: "has topsecretvalue", stderr: "clean" },
      values: ["topsecretvalue"],
    });
    expect(masked.stdout).toBe("has ****");
    expect("result" in masked).toBe(false);
    expect("error" in masked).toBe(false);
  });
});
