import { describe, it, expect } from "bun:test";
import { validateJsonTemplate } from "./validateJsonTemplate";

describe("validateJsonTemplate", () => {
  it("accepts valid JSON", () => {
    expect(validateJsonTemplate('{"a": 1, "b": "two"}')).toEqual([]);
  });

  it("accepts empty content", () => {
    expect(validateJsonTemplate("")).toEqual([]);
    expect(validateJsonTemplate("  \n ")).toEqual([]);
  });

  it("accepts a template as a quoted string value", () => {
    expect(
      validateJsonTemplate('{"repo": "{{trigger.payload.repository}}"}'),
    ).toEqual([]);
  });

  it("accepts a template embedded inside a string", () => {
    expect(validateJsonTemplate('{"msg": "build {{id}} done"}')).toEqual([]);
  });

  it("accepts an UNQUOTED template value (e.g. a number)", () => {
    // This is the case a plain JSON validator would reject.
    expect(
      validateJsonTemplate('{"timeout": {{trigger.payload.timeout}}}'),
    ).toEqual([]);
  });

  it("accepts a template as an array element", () => {
    expect(validateJsonTemplate('{"items": [{{count}}, 2]}')).toEqual([]);
  });

  it("flags a genuine structural error (missing comma)", () => {
    const diagnostics = validateJsonTemplate('{"a": 1 "b": 2}');
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an unclosed object", () => {
    const diagnostics = validateJsonTemplate('{"a": 1');
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a genuine error even when templates are present, at the right offset", () => {
    // The `2` is missing its preceding colon; offset must point into the
    // ORIGINAL text (same-length substitution preserves offsets).
    const text = '{"a": {{x}}, "b" 2}';
    const diagnostics = validateJsonTemplate(text);
    expect(diagnostics.length).toBeGreaterThan(0);
    // The error should land at/after the `2`, not inside the template.
    const firstOffset = diagnostics[0]?.offset ?? -1;
    expect(text.slice(firstOffset, firstOffset + 1)).toBe("2");
  });

  it("does not let an unclosed `{{` swallow a later template", () => {
    // `{{` on its own is not a complete template, so substitution leaves it;
    // the real `{{y}}` value is still substituted and the JSON stays valid.
    expect(validateJsonTemplate('{"a": "{{", "b": {{y}}}')).toEqual([]);
  });
});
