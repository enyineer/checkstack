import { describe, it, expect } from "bun:test";
import { assessRegexSafety } from "./regex-safety";

function safe(source: string): boolean {
  return assessRegexSafety({ source }).safe;
}

function reason(source: string): string | undefined {
  const verdict = assessRegexSafety({ source });
  return verdict.safe ? undefined : verdict.reason;
}

describe("assessRegexSafety", () => {
  it("accepts typical id-extraction patterns", () => {
    expect(safe("trace[_-]?id[=:]\\s*([0-9a-fA-F-]{16,36})")).toBe(true);
    expect(safe("traceId=([0-9a-f]+)")).toBe(true);
    expect(safe('"trace_id"\\s*:\\s*"([0-9a-f]{32})"')).toBe(true);
    expect(safe("(abc)?x")).toBe(true);
    expect(safe("^([0-9a-f]{32})$")).toBe(true);
    expect(safe("(?:trace|span)=([0-9a-f]{16,32})")).toBe(true); // alternation NOT quantified
    expect(safe("(?<id>[0-9a-f]{32})")).toBe(true); // named group
    expect(safe("(?=x)([0-9a-f]{32})")).toBe(true); // lookahead
    expect(safe("([0-9a-f]+?)-")).toBe(true); // lazy quantifier marker
  });

  it("rejects the exponential families: quantified groups containing quantifiers or alternation", () => {
    expect(reason("(a+)+$")).toContain("quantifier");
    expect(reason("(\\w+)*")).toContain("quantifier");
    expect(reason("(a|a)+")).toContain("quantifier");
    expect(reason("(a|b)+")).toContain("quantifier"); // conservative: use [ab]+
    expect(reason("((a)+)+")).toContain("quantifier");
    expect(reason("(?:x+)?")).toContain("quantifier"); // optional over quantified group
    expect(reason("(a{2,200})+")).toContain("quantifier");
  });

  it("rejects backreferences", () => {
    expect(reason("(a)\\1")).toContain("backreference");
    expect(reason("(?<x>a)\\k<x>")).toContain("backreference");
  });

  it("caps unbounded quantifiers at 2 (O(n^2) worst case)", () => {
    expect(safe("a+b+")).toBe(true);
    expect(safe(".*trace=([0-9a-f]{32})")).toBe(true);
    expect(reason("a+b+c+")).toContain("unbounded");
    expect(reason(".*trace=([0-9a-f]+).*")).toContain("unbounded");
    // Wide bounded repetitions count as unbounded.
    expect(reason("a{2,500}b*c*")).toContain("unbounded");
    expect(safe("a{2,100}b*c*")).toBe(true); // {2,100} is bounded
  });

  it("treats escapes and character classes as plain atoms", () => {
    expect(safe("\\d+\\.\\d+")).toBe(true); // escaped dot, two unbounded
    expect(safe("[+*()|\\]]+x")).toBe(true); // metachars inside a class
    expect(safe("\\{+")).toBe(true); // escaped brace then quantifier
    expect(safe("a{,3}+")).toBe(true); // `{,3}` is a LITERAL in JS, + quantifies `}`
  });

  it("fails closed on malformed input", () => {
    expect(safe("(a")).toBe(false);
    expect(safe("a)")).toBe(false);
    expect(safe("[abc")).toBe(false);
    expect(safe("(?<name")).toBe(false);
    expect(safe("(?Pinvalid)")).toBe(false);
  });
});
