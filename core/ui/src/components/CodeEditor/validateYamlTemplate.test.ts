import { describe, it, expect } from "bun:test";
import { validateYamlTemplate } from "./validateYamlTemplate";

describe("validateYamlTemplate", () => {
  it("accepts valid YAML", () => {
    expect(validateYamlTemplate("a: 1\nb: two\n")).toEqual([]);
  });

  it("accepts empty content", () => {
    expect(validateYamlTemplate("")).toEqual([]);
  });

  it("accepts a template as a quoted string value", () => {
    expect(validateYamlTemplate('repo: "{{trigger.payload.repository}}"')).toEqual(
      [],
    );
  });

  it("accepts an UNQUOTED template value (e.g. a number)", () => {
    expect(validateYamlTemplate("timeout: {{trigger.payload.timeout}}")).toEqual(
      [],
    );
  });

  it("accepts a template as a list item", () => {
    expect(validateYamlTemplate("items:\n  - {{count}}\n  - 2")).toEqual([]);
  });

  it("flags tabs used as indentation", () => {
    const diagnostics = validateYamlTemplate("foo:\n\tbar: 1");
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.message).toContain("YAML:");
  });

  it("flags a genuine structural error (with templates present)", () => {
    const diagnostics = validateYamlTemplate("a: {{x}}\n  b: 2");
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
