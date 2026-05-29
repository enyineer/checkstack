/**
 * Tests for the staged template-completion analyzer + provider.
 *
 * `analyzeExpression` is the brain — it classifies the cursor position
 * into field / operator / value / filter. The provider tests then
 * verify the end-to-end mapping (offsets, enum values, filters, brace
 * closing) over a couple of representative fixtures.
 */
import { describe, expect, it } from "bun:test";
import {
  analyzeExpression,
  createTemplateCompletionProvider,
  type CompletionField,
  type CompletionFilter,
} from "./template-completion";

describe("analyzeExpression", () => {
  it("classifies an empty / partial identifier as the field stage", () => {
    expect(analyzeExpression("")).toMatchObject({ kind: "field", query: "" });
    expect(analyzeExpression("trig")).toMatchObject({
      kind: "field",
      query: "trig",
      tokenStart: 0,
    });
    expect(analyzeExpression("trigger.payload.sev")).toMatchObject({
      kind: "field",
      query: "trigger.payload.sev",
      tokenStart: 0,
    });
  });

  it("moves to the operator stage after a completed field + space", () => {
    expect(analyzeExpression("trigger.payload.severity ")).toMatchObject({
      kind: "operator",
    });
  });

  it("moves to the value stage right after a comparator", () => {
    const stage = analyzeExpression("trigger.payload.severity == ");
    expect(stage).toMatchObject({
      kind: "value",
      fieldPath: "trigger.payload.severity",
      query: "",
      quoted: false,
    });
  });

  it("stays in the value stage while typing a quoted value", () => {
    const stage = analyzeExpression('trigger.payload.severity == "hi');
    expect(stage).toMatchObject({
      kind: "value",
      fieldPath: "trigger.payload.severity",
      query: "hi",
      quoted: true,
    });
  });

  it("treats a partial value with no quote as the value stage too", () => {
    const stage = analyzeExpression("count == 4");
    expect(stage).toMatchObject({
      kind: "value",
      fieldPath: "count",
      query: "4",
    });
  });

  it("enters the filter stage after a pipe", () => {
    expect(analyzeExpression("trigger.payload.title | ")).toMatchObject({
      kind: "filter",
      query: "",
    });
    expect(analyzeExpression("trigger.payload.title | up")).toMatchObject({
      kind: "filter",
      query: "up",
    });
  });

  it("offers operators again after a completed comparison + space", () => {
    expect(
      analyzeExpression('trigger.payload.severity == "high" '),
    ).toMatchObject({ kind: "operator" });
  });

  it("returns to the field stage after a logical connector", () => {
    const stage = analyzeExpression('a == "x" && trig');
    expect(stage).toMatchObject({ kind: "field", query: "trig" });
  });
});

// ─── Provider ───────────────────────────────────────────────────────────

const fields: CompletionField[] = [
  { path: "trigger.payload.severity", type: "string", enumValues: ["low", "high"] },
  { path: "trigger.payload.title", type: "string" },
  { path: "trigger.payload.acknowledged", type: "boolean" },
];

const filters: CompletionFilter[] = [
  { name: "upper", description: "Uppercase." },
  { name: "default", signature: "fallback", hasArgs: true },
];

describe("createTemplateCompletionProvider — template mode", () => {
  const provider = createTemplateCompletionProvider({
    fields,
    filters,
    mode: "template",
  });

  it("returns null when the cursor is not inside a {{ }} block", () => {
    expect(provider({ value: "plain text", cursor: 5 })).toBeNull();
  });

  it("suggests fields inside an unclosed {{, appends the closing braces, and a space to advance", () => {
    const value = "{{trig";
    const result = provider({ value, cursor: value.length });
    expect(result).not.toBeNull();
    expect(result!.heading).toBe("Fields");
    const severity = result!.items.find((i) =>
      i.label.includes("severity"),
    );
    // Inserts the field + a space + the closing braces; the caret lands
    // after the space (before `}}`) so the operator stage opens next.
    expect(severity?.insertText).toBe("trigger.payload.severity }}");
    expect(severity?.caretOffset).toBe(-2);
  });

  it("appends a trailing space (no braces) when the block is already closed", () => {
    const value = "{{ trig }}";
    const cursor = "{{ trig".length;
    const result = provider({ value, cursor });
    const severity = result!.items.find((i) => i.label.includes("severity"));
    expect(severity?.insertText).toBe("trigger.payload.severity ");
    expect(severity?.caretOffset).toBe(0);
  });

  it("offers comparators + pipe in the operator stage", () => {
    const value = "{{ trigger.payload.severity ";
    const result = provider({ value, cursor: value.length });
    expect(result!.heading).toBe("Operators");
    const labels = result!.items.map((i) => i.label);
    expect(labels).toContain("==");
    expect(labels).toContain("!=");
    expect(labels).toContain("|");
  });

  it("offers enum values after a comparator on an enum field", () => {
    const value = '{{ trigger.payload.severity == ';
    const result = provider({ value, cursor: value.length });
    expect(result!.heading).toContain("severity");
    const inserts = result!.items.map((i) => i.insertText);
    expect(inserts).toContain('"low"');
    expect(inserts).toContain('"high"');
  });

  it("offers true/false for a boolean field value stage", () => {
    const value = "{{ trigger.payload.acknowledged == ";
    const result = provider({ value, cursor: value.length });
    const inserts = result!.items.map((i) => i.insertText);
    expect(inserts).toEqual(["true", "false"]);
  });

  it("returns null in the value stage for a field with no known values", () => {
    const value = "{{ trigger.payload.title == ";
    const result = provider({ value, cursor: value.length });
    expect(result).toBeNull();
  });

  it("offers filters after a pipe, with () for arg-taking filters", () => {
    const value = "{{ trigger.payload.title | ";
    const result = provider({ value, cursor: value.length });
    expect(result!.heading).toBe("Filters");
    const def = result!.items.find((i) => i.label.startsWith("default"));
    expect(def?.insertText).toBe("default()");
    expect(def?.caretOffset).toBe(-1);
    const upper = result!.items.find((i) => i.label === "upper");
    expect(upper?.insertText).toBe("upper");
  });
});

describe("createTemplateCompletionProvider — expression mode", () => {
  const provider = createTemplateCompletionProvider({
    fields,
    filters,
    mode: "expression",
  });

  it("treats the whole value as an expression (no {{ needed)", () => {
    const result = provider({ value: "trigger.payload.sev", cursor: 19 });
    expect(result!.heading).toBe("Fields");
    // Field insert in expression mode never appends braces, but does
    // append a trailing space to advance to the operator stage.
    const severity = result!.items.find((i) => i.label.includes("severity"));
    expect(severity?.insertText).toBe("trigger.payload.severity ");
  });

  it("suggests enum values after a comparator", () => {
    const value = "trigger.payload.severity == ";
    const result = provider({ value, cursor: value.length });
    const inserts = result!.items.map((i) => i.insertText);
    expect(inserts).toEqual(['"low"', '"high"']);
  });

  it("replaces only the partial token, not the whole expression", () => {
    const value = "trigger.payload.sev";
    const result = provider({ value, cursor: value.length });
    expect(result!.replaceStart).toBe(0);
    expect(result!.replaceEnd).toBe(value.length);
  });
});
