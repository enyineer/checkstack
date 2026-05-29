import { describe, expect, it } from "bun:test";
import { parseCondition, parseTemplate } from "../parser";
import { TemplateParseError } from "../errors";

describe("parseTemplate", () => {
  it("parses pure literal text", () => {
    const t = parseTemplate("hello world");
    expect(t.nodes).toHaveLength(1);
  });

  it("parses a single expression", () => {
    const t = parseTemplate("{{ foo.bar }}");
    expect(t.nodes).toHaveLength(1);
  });

  it("parses interleaved text and expressions", () => {
    const t = parseTemplate("Hello {{ name }}, you have {{ count }} messages.");
    expect(t.nodes).toHaveLength(5);
  });

  it("rejects unterminated expression", () => {
    expect(() => parseTemplate("hello {{ foo")).toThrow(TemplateParseError);
  });

  it("rejects unterminated string", () => {
    expect(() => parseTemplate('{{ "unterminated }}')).toThrow(
      TemplateParseError,
    );
  });

  it("handles escape sequences in strings", () => {
    const t = parseTemplate('{{ "line1\\nline2" }}');
    expect(t.nodes).toHaveLength(1);
  });

  it("parses string-literal index access with hyphen and dot in the key", () => {
    const t = parseTemplate(
      '{{ artifacts["integration-jira.issue"].issueKey }}',
    );
    expect(t.nodes).toHaveLength(1);
  });

  it("rejects unbracketed hyphenated member access", () => {
    expect(() =>
      parseTemplate("{{ artifacts.integration-jira.issue }}"),
    ).toThrow(TemplateParseError);
  });
});

describe("parseCondition", () => {
  it("parses a simple equality", () => {
    const c = parseCondition("trigger.eventId == 'incident.created'");
    expect(c.source).toBe("trigger.eventId == 'incident.created'");
  });

  it("parses logical expressions", () => {
    const c = parseCondition("a && b || c");
    expect(c).toBeDefined();
  });

  it("parses ternaries", () => {
    const c = parseCondition("severity == 'critical' ? 'high' : 'normal'");
    expect(c).toBeDefined();
  });

  it("parses pipes with filter calls", () => {
    const c = parseCondition("title | truncate(40) | upper");
    expect(c).toBeDefined();
  });

  it("rejects malformed input", () => {
    expect(() => parseCondition("foo ==")).toThrow(TemplateParseError);
  });
});
