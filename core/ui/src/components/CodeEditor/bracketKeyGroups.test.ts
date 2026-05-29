import { describe, it, expect } from "bun:test";
import { extractBracketKeyGroups } from "./bracketKeyGroups";

describe("extractBracketKeyGroups", () => {
  it("returns [] when there is no `declare const context`", () => {
    expect(
      extractBracketKeyGroups({ typeDefinitions: "interface Foo { x: string }" }),
    ).toEqual([]);
  });

  it("returns [] when no property keys are non-identifiers", () => {
    const typeDefinitions = `declare const context: {
      event: { payload: { repository: string; count: number } };
    };`;
    expect(extractBracketKeyGroups({ typeDefinitions })).toEqual([]);
  });

  it("extracts a non-identifier key and its dotted parent path", () => {
    const typeDefinitions = `declare const context: {
      artifacts: {
        "integration-jira.issue": { key: string; summary: string };
      };
    };`;
    expect(extractBracketKeyGroups({ typeDefinitions })).toEqual([
      { objectExpression: "context.artifacts", keys: ["integration-jira.issue"] },
    ]);
  });

  it("groups multiple non-identifier keys under the same parent", () => {
    const typeDefinitions = `declare const context: {
      artifacts: {
        "integration-jira.issue": { key: string };
        "integration-github.pr": { number: number };
        valid: { ok: boolean };
      };
    };`;
    expect(extractBracketKeyGroups({ typeDefinitions })).toEqual([
      {
        objectExpression: "context.artifacts",
        keys: ["integration-jira.issue", "integration-github.pr"],
      },
    ]);
  });

  it("does NOT treat string-literal union *values* as keys", () => {
    const typeDefinitions = `declare const context: {
      artifacts: {
        "a-b": { status: "open" | "closed"; url: "https://x" };
      };
    };`;
    expect(extractBracketKeyGroups({ typeDefinitions })).toEqual([
      { objectExpression: "context.artifacts", keys: ["a-b"] },
    ]);
  });

  it("ignores JSDoc and line comments (including braces inside them)", () => {
    const typeDefinitions = `declare const context: {
      /** an object like { not: a real brace } */
      artifacts: {
        // "comment-key": should be ignored
        "real-key": { x: string };
      };
    };`;
    expect(extractBracketKeyGroups({ typeDefinitions })).toEqual([
      { objectExpression: "context.artifacts", keys: ["real-key"] },
    ]);
  });

  it("handles `readonly` and optional `?` modifiers and deeper paths", () => {
    const typeDefinitions = `declare const context: {
      readonly event: {
        readonly meta?: {
          "x-trace.id": { v: string };
        };
      };
    };`;
    expect(extractBracketKeyGroups({ typeDefinitions })).toEqual([
      { objectExpression: "context.event.meta", keys: ["x-trace.id"] },
    ]);
  });

  it("skips non-identifier keys nested under a non-identifier parent", () => {
    // `context["a-b"]` is not a dotted objectExpression, so the inner key has
    // no addressable parent and must be skipped.
    const typeDefinitions = `declare const context: {
      "a-b": {
        "c-d": { x: string };
      };
    };`;
    expect(extractBracketKeyGroups({ typeDefinitions })).toEqual([
      { objectExpression: "context", keys: ["a-b"] },
    ]);
  });

  it("respects a custom root name", () => {
    const typeDefinitions = `declare const scope: {
      vars: { "weird key": { x: string } };
    };`;
    expect(
      extractBracketKeyGroups({ typeDefinitions, rootName: "scope" }),
    ).toEqual([{ objectExpression: "scope.vars", keys: ["weird key"] }]);
  });
});
