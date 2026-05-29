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

/** Helper: a field whose templateRef mirrors its canonical path. */
function plainField(
  path: string,
  type: string,
  enumValues?: Array<string | number | boolean>,
): CompletionField {
  return { path, templateRef: path, type, enumValues };
}

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
  plainField("trigger.payload.severity", "string", ["low", "high"]),
  plainField("trigger.payload.title", "string"),
  plainField("trigger.payload.acknowledged", "boolean"),
];

/**
 * Artifact with a hyphenated/dotted id: canonical `path` stays dotted,
 * but `templateRef` is the runtime-parseable bracket form that must be
 * inserted into `{{ }}` and used for the value-stage lookup.
 */
const bracketFields: CompletionField[] = [
  {
    path: "artifact.integration-jira.issue.issueKey",
    templateRef: 'artifacts["integration-jira.issue"].issueKey',
    type: "string",
    enumValues: ["OPEN", "DONE"],
  },
  {
    path: "artifact.integration-jira.issue.url",
    templateRef: 'artifacts["integration-jira.issue"].url',
    type: "string",
  },
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

// ─── templateRef (bracket-notation artifact) handling ─────────────────────

describe("templateRef insertion + value-stage lookup", () => {
  const provider = createTemplateCompletionProvider({
    fields: bracketFields,
    filters,
    mode: "template",
  });

  it("field stage: completing `{{ art` inserts the bracket-notation templateRef", () => {
    const value = "{{ art";
    const result = provider({ value, cursor: value.length });
    expect(result).not.toBeNull();
    expect(result!.heading).toBe("Fields");
    const issueKey = result!.items.find((i) =>
      i.label.includes("issueKey"),
    );
    expect(issueKey?.label).toBe('artifacts["integration-jira.issue"].issueKey');
    expect(issueKey?.insertText).toBe(
      'artifacts["integration-jira.issue"].issueKey }}',
    );
    expect(issueKey?.caretOffset).toBe(-2);
  });

  it("field stage: a partial bracket chain still filters by templateRef", () => {
    const value = '{{ artifacts["integration-jira.issue"].iss';
    const result = provider({ value, cursor: value.length });
    expect(result).not.toBeNull();
    const labels = result!.items.map((i) => i.label);
    expect(labels).toContain(
      'artifacts["integration-jira.issue"].issueKey',
    );
    expect(labels).not.toContain(
      'artifacts["integration-jira.issue"].url',
    );
  });

  it("value stage: reconstructed fieldPath equals the templateRef and finds enum values", () => {
    const value = '{{ artifacts["integration-jira.issue"].issueKey == ';
    const result = provider({ value, cursor: value.length });
    expect(result).not.toBeNull();
    expect(result!.heading).toContain(
      'artifacts["integration-jira.issue"].issueKey',
    );
    const inserts = result!.items.map((i) => i.insertText);
    expect(inserts).toContain('"OPEN"');
    expect(inserts).toContain('"DONE"');
  });

  it("value stage: single-quoted user input still reconstructs the double-quoted templateRef", () => {
    // The user typed single quotes inside the bracket; the reconstruction
    // must normalise to the JSON.stringify (double-quoted) templateRef so
    // the lookup matches.
    const value = "{{ artifacts['integration-jira.issue'].issueKey == ";
    const result = provider({ value, cursor: value.length });
    expect(result).not.toBeNull();
    const inserts = result!.items.map((i) => i.insertText);
    expect(inserts).toContain('"OPEN"');
  });
});

// ─── Array element indexing ───────────────────────────────────────────────

describe("array element indexing", () => {
  const arrayFields: CompletionField[] = [
    {
      path: "artifact.integration-jira.issue.comments[0].author",
      templateRef: 'artifacts["integration-jira.issue"].comments[0].author',
      type: "string",
    },
    {
      path: "artifact.integration-jira.issue.tags[0]",
      templateRef: 'artifacts["integration-jira.issue"].tags[0]',
      type: "string",
    },
  ];
  const provider = createTemplateCompletionProvider({
    fields: arrayFields,
    filters,
    mode: "template",
  });

  it("field stage: a partial chain through a numeric index filters by templateRef", () => {
    const value = '{{ artifacts["integration-jira.issue"].comments[0].au';
    const result = provider({ value, cursor: value.length });
    expect(result).not.toBeNull();
    const labels = result!.items.map((i) => i.label);
    expect(labels).toContain(
      'artifacts["integration-jira.issue"].comments[0].author',
    );
    expect(labels).not.toContain('artifacts["integration-jira.issue"].tags[0]');
  });

  it("value stage: reconstructs a fieldPath with a numeric index (bare, no quotes)", () => {
    const value =
      '{{ artifacts["integration-jira.issue"].comments[0].author == ';
    const stage = analyzeExpression(
      value.slice("{{ ".length, value.length),
    );
    expect(stage).toMatchObject({
      kind: "value",
      fieldPath: 'artifacts["integration-jira.issue"].comments[0].author',
    });
  });

  it("reconstructChain inserts no dot before a `[` (it's tags[0], not tags.[0])", () => {
    const stage = analyzeExpression('artifacts["integration-jira.issue"].tags[0] ');
    // Trailing space → operator stage; the chain itself round-trips without
    // a spurious dot. Verify via the value stage instead:
    const valueStage = analyzeExpression(
      'artifacts["integration-jira.issue"].tags[0] == ',
    );
    expect(valueStage).toMatchObject({
      kind: "value",
      fieldPath: 'artifacts["integration-jira.issue"].tags[0]',
    });
    expect(stage).toMatchObject({ kind: "operator" });
  });
});

// ─── Finding 1: double-escape regression ──────────────────────────────────

describe("bracket key with embedded quotes does not double-escape", () => {
  // Stored templateRef uses JSON.stringify, so a key `a"b` is stored as
  // `["a\"b"]`. Reconstruction must round-trip to the same string, not
  // re-escape the backslash.
  const escapedFields: CompletionField[] = [
    {
      path: 'artifact.weird.a"b',
      templateRef: 'artifacts["a\\"b"]',
      type: "string",
      enumValues: ["X"],
    },
  ];
  const provider = createTemplateCompletionProvider({
    fields: escapedFields,
    filters,
    mode: "template",
  });

  it("value stage: an embedded-quote key reconstructs to the stored double-quoted templateRef", () => {
    // User typed the same double-quoted escaped form.
    const value = '{{ artifacts["a\\"b"] == ';
    const result = provider({ value, cursor: value.length });
    expect(result).not.toBeNull();
    expect(result!.heading).toContain('artifacts["a\\"b"]');
    const inserts = result!.items.map((i) => i.insertText);
    expect(inserts).toContain('"X"');
  });
});

describe("plain dotted paths still round-trip", () => {
  const provider = createTemplateCompletionProvider({
    fields,
    filters,
    mode: "template",
  });

  it("field stage filters a plain dotted partial", () => {
    const value = "{{ trigger.payload.sev";
    const result = provider({ value, cursor: value.length });
    const labels = result!.items.map((i) => i.label);
    expect(labels).toContain("trigger.payload.severity");
  });

  it("value stage after a plain dotted field finds its enum values", () => {
    const value = "{{ trigger.payload.severity == ";
    const result = provider({ value, cursor: value.length });
    expect(result!.heading).toContain("trigger.payload.severity");
    const inserts = result!.items.map((i) => i.insertText);
    expect(inserts).toEqual(['"low"', '"high"']);
  });
});
