import { describe, it, expect } from "bun:test";
import { matchesTemplate, templateToTokens } from "./user-pattern-matcher";
import { WILDCARD as W } from "./masking";

describe("templateToTokens", () => {
  const cases: Array<{ template: string; tokens: string[] }> = [
    { template: "", tokens: [] },
    { template: "boot", tokens: ["boot"] },
    { template: "user <*> logged in", tokens: ["user", W, "logged", "in"] },
    { template: "<*>", tokens: [W] },
    { template: "<*> <*>", tokens: [W, W] },
  ];
  for (const { template, tokens } of cases) {
    it(`splits ${JSON.stringify(template)} into ${tokens.length} tokens`, () => {
      expect(templateToTokens(template)).toEqual(tokens);
    });
  }

  it("round-trips with join", () => {
    const template = "GET /api/users/<*> <*> in <*>ms";
    expect(templateToTokens(template).join(" ")).toBe(template);
  });
});

describe("matchesTemplate", () => {
  const cases: Array<{
    name: string;
    templateTokens: string[];
    lineTokens: string[];
    expected: boolean;
  }> = [
    {
      name: "identical wildcard-free templates match",
      templateTokens: ["boot", "complete"],
      lineTokens: ["boot", "complete"],
      expected: true,
    },
    {
      name: "a literal mismatch fails",
      templateTokens: ["boot", "complete"],
      lineTokens: ["boot", "failed"],
      expected: false,
    },
    {
      name: "differing token count fails (line longer)",
      templateTokens: ["user", W, "in"],
      lineTokens: ["user", "42", "logged", "in"],
      expected: false,
    },
    {
      name: "differing token count fails (line shorter)",
      templateTokens: ["user", W, "logged", "in"],
      lineTokens: ["user", "42", "in"],
      expected: false,
    },
    {
      name: "a wildcard matches a numeric token",
      templateTokens: ["user", W, "logged", "in"],
      lineTokens: ["user", W, "logged", "in"],
      expected: true,
    },
    {
      name: "a wildcard matches a literal token at that position",
      templateTokens: ["user", W, "logged", "in"],
      lineTokens: ["user", "alice", "logged", "in"],
      expected: true,
    },
    {
      name: "a non-wildcard position must be exactly equal even next to a wildcard",
      templateTokens: ["error", W, "at", "line", W],
      lineTokens: ["error", "boom", "on", "line", "7"],
      expected: false,
    },
    {
      name: "multiple wildcards all match",
      templateTokens: [W, "took", W, "ms"],
      lineTokens: ["req", "took", "42", "ms"],
      expected: true,
    },
    {
      name: "empty template matches an empty line",
      templateTokens: [],
      lineTokens: [],
      expected: true,
    },
    {
      name: "empty template does not match a non-empty line",
      templateTokens: [],
      lineTokens: ["x"],
      expected: false,
    },
    {
      name: "an all-wildcard template of the right length matches anything",
      templateTokens: [W, W, W],
      lineTokens: ["any", "three", "tokens"],
      expected: true,
    },
    {
      name: "a masked token in the line is treated as a literal at a non-wildcard position",
      templateTokens: ["key=<*>", "set"],
      lineTokens: ["key=<*>", "set"],
      expected: true,
    },
    {
      name: "a masked token that differs from a non-wildcard literal fails",
      templateTokens: ["key=<*>", "set"],
      lineTokens: ["id=<*>", "set"],
      expected: false,
    },
  ];

  for (const { name, templateTokens, lineTokens, expected } of cases) {
    it(name, () => {
      expect(matchesTemplate({ templateTokens, lineTokens })).toBe(expected);
    });
  }
});
