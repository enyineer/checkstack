import { describe, expect, test } from "bun:test";
import { PROVIDER_TOOL_NAME_PATTERN, toProviderToolName } from "./tool-name";

describe("toProviderToolName", () => {
  test("maps the '.' namespace separator to '_'", () => {
    expect(toProviderToolName("incident.list")).toBe("incident_list");
    expect(toProviderToolName("catalog.listSystems")).toBe(
      "catalog_listSystems",
    );
    expect(toProviderToolName("dependency.list")).toBe("dependency_list");
  });

  test("maps every '.' in a multi-dot name", () => {
    expect(toProviderToolName("a.b.c")).toBe("a_b_c");
  });

  test("leaves an already provider-safe name unchanged", () => {
    expect(toProviderToolName("incident_list")).toBe("incident_list");
    expect(toProviderToolName("get-status")).toBe("get-status");
    expect(toProviderToolName("Tool_123")).toBe("Tool_123");
  });

  test("the result always matches the provider pattern", () => {
    for (const name of ["incident.list", "a.b.c", "get-status", "x"]) {
      expect(PROVIDER_TOOL_NAME_PATTERN.test(toProviderToolName(name))).toBe(
        true,
      );
    }
  });

  test("throws on an illegal character rather than silently rewriting it", () => {
    expect(() => toProviderToolName("foo$bar")).toThrow(/Invalid AI tool name/);
    expect(() => toProviderToolName("with space")).toThrow(
      /Invalid AI tool name/,
    );
    expect(() => toProviderToolName("emoji😀")).toThrow(/Invalid AI tool name/);
  });

  test("throws on an empty name", () => {
    expect(() => toProviderToolName("")).toThrow(/Invalid AI tool name/);
  });
});
