import { describe, expect, it } from "bun:test";
import type { TemplateProperty } from "@checkstack/ui/code-editor";
import {
  detectRawTemplateContext,
  filterTemplatePropertiesByQuery,
  splitTemplateLabel,
} from "./templateAutocomplete";

const PROPS: TemplateProperty[] = [
  { path: "trigger.payload.systemName", type: "string" },
  {
    path: "artifact.find_existing.issue_search.found",
    templateRef: "artifacts.find_existing.issue_search.found",
    type: "boolean",
  },
  {
    path: "artifact.triage.analysis.data.title",
    templateRef: "artifacts.triage.analysis.data.title",
    type: "string",
  },
];

describe("filterTemplatePropertiesByQuery", () => {
  it("matches artifacts when the query carries the leading space after `{{ `", () => {
    // Regression: typing `{{ arti` yields query " arti"; without trimming this
    // matched nothing and the popup hid all upstream artifacts.
    const matches = filterTemplatePropertiesByQuery(PROPS, " arti");
    expect(matches.map((p) => p.path)).toEqual([
      "artifact.find_existing.issue_search.found",
      "artifact.triage.analysis.data.title",
    ]);
  });

  it("matches against templateRef (plural `artifacts.`) too", () => {
    const matches = filterTemplatePropertiesByQuery(PROPS, "  artifacts.find");
    expect(matches.map((p) => p.path)).toEqual([
      "artifact.find_existing.issue_search.found",
    ]);
  });

  it("returns every property for an empty / whitespace-only query", () => {
    expect(filterTemplatePropertiesByQuery(PROPS, "")).toHaveLength(3);
    expect(filterTemplatePropertiesByQuery(PROPS, "   ")).toHaveLength(3);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterTemplatePropertiesByQuery(PROPS, "nope")).toEqual([]);
  });
});

describe("splitTemplateLabel", () => {
  it("splits a deep path so the leaf is isolated from the shared prefix", () => {
    expect(splitTemplateLabel("artifacts.triage.analysis.summary")).toEqual({
      prefix: "artifacts.triage.analysis.",
      leaf: "summary",
    });
    expect(
      splitTemplateLabel("artifacts.triage.analysis.data.title"),
    ).toEqual({ prefix: "artifacts.triage.analysis.data.", leaf: "title" });
  });

  it("returns the whole label as the leaf when there is no dot", () => {
    expect(splitTemplateLabel("trigger")).toEqual({ prefix: "", leaf: "trigger" });
  });

  it("does not split on a dot inside bracket-quoted segments", () => {
    expect(splitTemplateLabel('artifacts["a.b"].found')).toEqual({
      prefix: 'artifacts["a.b"].',
      leaf: "found",
    });
  });
});

describe("detectRawTemplateContext", () => {
  it("detects an open `{{` span and returns the (space-prefixed) query", () => {
    const text = "Summary: {{ arti";
    const ctx = detectRawTemplateContext(text, text.length);
    expect(ctx.isInTemplate).toBe(true);
    expect(ctx.query).toBe(" arti");
    expect(ctx.startPos).toBe(text.indexOf("{{"));
  });

  it("is not in a template after the span closes", () => {
    const text = "{{ x }} rest";
    expect(detectRawTemplateContext(text, text.length).isInTemplate).toBe(false);
  });

  it("ignores a span that spilled across a newline", () => {
    const text = "{{ x\nmore";
    expect(detectRawTemplateContext(text, text.length).isInTemplate).toBe(false);
  });
});
