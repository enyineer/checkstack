import { describe, expect, it } from "bun:test";
import { parseCondition, parseTemplate } from "../parser";
import {
  evaluate,
  evaluateBoolean,
  render,
} from "../renderer";
import { TemplateRenderError, UnknownFilterError } from "../errors";

describe("render", () => {
  it("renders literal text unchanged", () => {
    expect(render(parseTemplate("hello"), {})).toBe("hello");
  });

  it("substitutes simple identifiers", () => {
    const out = render(parseTemplate("Hello {{ name }}!"), {
      name: "Nico",
    });
    expect(out).toBe("Hello Nico!");
  });

  it("resolves nested member access", () => {
    const out = render(parseTemplate("{{ trigger.payload.title }}"), {
      trigger: { payload: { title: "Database down" } },
    });
    expect(out).toBe("Database down");
  });

  it("resolves array index access", () => {
    const out = render(parseTemplate("{{ items[0] }}"), {
      items: ["first", "second"],
    });
    expect(out).toBe("first");
  });

  it("resolves bracket access with string", () => {
    const out = render(parseTemplate('{{ nodes["jira-create"].issueKey }}'), {
      nodes: { "jira-create": { issueKey: "PROJ-42" } },
    });
    expect(out).toBe("PROJ-42");
  });

  it("renders empty string for missing references (non-strict)", () => {
    const out = render(parseTemplate("Hello {{ missing }}!"), {});
    expect(out).toBe("Hello !");
  });

  it("throws in strict mode for missing references", () => {
    expect(() =>
      render(parseTemplate("Hello {{ missing }}!"), {}, { strict: true }),
    ).toThrow(TemplateRenderError);
  });

  it("supports filter pipes", () => {
    const out = render(parseTemplate("{{ title | upper }}"), {
      title: "fire",
    });
    expect(out).toBe("FIRE");
  });

  it("supports filter pipes with arguments", () => {
    const out = render(parseTemplate('{{ x | default("none") }}'), {});
    expect(out).toBe("none");
  });

  it("chains multiple filters", () => {
    const out = render(parseTemplate("{{ x | default('fallback') | upper }}"), {});
    expect(out).toBe("FALLBACK");
  });

  it("renders ternaries", () => {
    const out = render(
      parseTemplate("{{ severity == 'critical' ? 'PAGE' : 'log' }}"),
      { severity: "critical" },
    );
    expect(out).toBe("PAGE");
  });

  it("renders objects as JSON", () => {
    const out = render(parseTemplate("{{ obj }}"), {
      obj: { a: 1, b: 2 },
    });
    expect(out).toBe('{"a":1,"b":2}');
  });

  it("throws UnknownFilterError for missing filters", () => {
    expect(() => render(parseTemplate("{{ x | unknown_filter }}"), { x: 1 })).toThrow(
      UnknownFilterError,
    );
  });

  it("supports truncate filter", () => {
    const out = render(parseTemplate("{{ msg | truncate(5) }}"), {
      msg: "Hello World",
    });
    expect(out).toBe("Hello…");
  });
});

describe("evaluate / evaluateBoolean", () => {
  it("evaluates equality conditions", () => {
    expect(
      evaluateBoolean(parseCondition("a == b"), { a: 1, b: 1 }),
    ).toBe(true);
  });

  it("evaluates string equality with quoted RHS", () => {
    expect(
      evaluateBoolean(
        parseCondition("trigger.eventId == 'incident.created'"),
        { trigger: { eventId: "incident.created" } },
      ),
    ).toBe(true);
  });

  it("evaluates logical AND/OR short-circuit", () => {
    expect(evaluateBoolean(parseCondition("false && missing.foo"), {})).toBe(
      false,
    );
    expect(evaluateBoolean(parseCondition("true || missing.foo"), {})).toBe(
      true,
    );
  });

  it("evaluates negation", () => {
    expect(evaluateBoolean(parseCondition("!enabled"), { enabled: false })).toBe(
      true,
    );
  });

  it("evaluates comparison operators", () => {
    expect(evaluateBoolean(parseCondition("3 < 4"), {})).toBe(true);
    expect(evaluateBoolean(parseCondition("4 >= 4"), {})).toBe(true);
  });

  it("returns raw value from evaluate", () => {
    expect(evaluate(parseCondition("severity"), { severity: "critical" })).toBe(
      "critical",
    );
  });

  it("treats empty arrays and objects as falsy (consistent with truthiness rule)", () => {
    expect(evaluateBoolean(parseCondition("items"), { items: [] })).toBe(false);
    expect(evaluateBoolean(parseCondition("obj"), { obj: {} })).toBe(false);
  });
});
