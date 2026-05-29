import { describe, it, expect } from "bun:test";
import { validateXmlTemplate } from "./validateXmlTemplate";

describe("validateXmlTemplate", () => {
  it("accepts valid XML", () => {
    expect(validateXmlTemplate("<root><a>1</a></root>")).toEqual([]);
  });

  it("accepts empty content", () => {
    expect(validateXmlTemplate("")).toEqual([]);
    expect(validateXmlTemplate("  \n ")).toEqual([]);
  });

  it("accepts a template in element text", () => {
    expect(
      validateXmlTemplate("<root><repo>{{trigger.payload.repository}}</repo></root>"),
    ).toEqual([]);
  });

  it("accepts a template in a (quoted) attribute value", () => {
    expect(validateXmlTemplate('<root attr="{{id}}"></root>')).toEqual([]);
  });

  it("flags a mismatched closing tag", () => {
    const diagnostics = validateXmlTemplate("<a><b></a>");
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.message).toContain("XML:");
  });

  it("flags an unclosed tag even with templates present", () => {
    const diagnostics = validateXmlTemplate("<root><x>{{v}}</root>");
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
