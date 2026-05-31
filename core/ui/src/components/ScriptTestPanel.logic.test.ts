import { describe, expect, test } from "bun:test";
import {
  buildSecretOverrides,
  distinctSecretNames,
  formatReturnValue,
  hasNoOutput,
  isFailedResult,
  rejectionResult,
  validateSampleContextJson,
  type ScriptTestPanelResult,
} from "./ScriptTestPanel.logic";

const base: ScriptTestPanelResult = {
  stdout: "",
  stderr: "",
  durationMs: 10,
  timedOut: false,
};

describe("isFailedResult", () => {
  test("a clean result is not a failure", () => {
    expect(isFailedResult({ ...base, result: { ok: true } })).toBe(false);
  });
  test("an error result is a failure", () => {
    expect(isFailedResult({ ...base, error: "boom" })).toBe(true);
  });
  test("a timed-out result is a failure", () => {
    expect(isFailedResult({ ...base, timedOut: true })).toBe(true);
  });
});

describe("formatReturnValue", () => {
  test("pretty-prints an object", () => {
    expect(formatReturnValue({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
  test("renders undefined explicitly", () => {
    expect(formatReturnValue(undefined)).toBe("undefined");
  });
  test("falls back to String() for non-serialisable values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatReturnValue(circular)).toBe("[object Object]");
  });
});

describe("hasNoOutput", () => {
  test("true when nothing was produced", () => {
    expect(hasNoOutput(base)).toBe(true);
  });
  test("false when there is a return value", () => {
    expect(hasNoOutput({ ...base, result: null })).toBe(false);
  });
  test("false when there is stdout", () => {
    expect(hasNoOutput({ ...base, stdout: "hi" })).toBe(false);
  });
  test("false when there is an error", () => {
    expect(hasNoOutput({ ...base, error: "x" })).toBe(false);
  });
});

describe("validateSampleContextJson", () => {
  test("empty value is valid (null)", () => {
    expect(validateSampleContextJson("   ")).toBeNull();
  });
  test("valid JSON is valid (null)", () => {
    expect(validateSampleContextJson('{"a":1}')).toBeNull();
  });
  test("malformed JSON returns a message", () => {
    expect(validateSampleContextJson("{ not json")).not.toBeNull();
  });
});

describe("rejectionResult", () => {
  test("wraps a thrown Error into a failure result", () => {
    const r = rejectionResult(new Error("network down"));
    expect(r.error).toBe("network down");
    expect(isFailedResult(r)).toBe(true);
    expect(r.timedOut).toBe(false);
  });
});

describe("distinctSecretNames", () => {
  test("returns [] for an absent or empty mapping", () => {
    expect(distinctSecretNames(undefined)).toEqual([]);
    expect(distinctSecretNames({})).toEqual([]);
  });

  test("extracts distinct secret names from templates, first-seen order", () => {
    expect(
      distinctSecretNames({
        API_TOKEN: "${{ secrets.jira_token }}",
        DB: "${{ secrets.db_pass }}",
        ALSO: "${{ secrets.jira_token }}",
      }),
    ).toEqual(["jira_token", "db_pass"]);
  });

  test("tolerates a legacy bare secret name as a value", () => {
    expect(distinctSecretNames({ secret: "SECRET" })).toEqual(["SECRET"]);
  });

  test("ignores values that are neither a template nor a bare name", () => {
    expect(distinctSecretNames({ X: "not a name" })).toEqual([]);
  });
});

describe("buildSecretOverrides", () => {
  const secretEnv = {
    API_TOKEN: "${{ secrets.jira_token }}",
    DB: "${{ secrets.db_pass }}",
  };

  test("returns undefined when no draft is filled", () => {
    expect(
      buildSecretOverrides({ secretEnv, drafts: {} }),
    ).toBeUndefined();
    expect(
      buildSecretOverrides({ secretEnv, drafts: { jira_token: "" } }),
    ).toBeUndefined();
  });

  test("keeps only filled drafts for referenced names", () => {
    expect(
      buildSecretOverrides({
        secretEnv,
        drafts: { jira_token: "abc", db_pass: "" },
      }),
    ).toEqual({ jira_token: "abc" });
  });

  test("drops drafts for names not referenced by the mapping", () => {
    expect(
      buildSecretOverrides({
        secretEnv,
        drafts: { jira_token: "abc", stale: "leak" },
      }),
    ).toEqual({ jira_token: "abc" });
  });
});
