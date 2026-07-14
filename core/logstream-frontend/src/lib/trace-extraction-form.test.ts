import { describe, expect, it } from "bun:test";
import type { TraceExtractionRules } from "@checkstack/logstream-common";
import {
  formToTraceExtraction,
  traceExtractionToForm,
  type TraceExtractionFormState,
} from "./trace-extraction-form";

describe("traceExtractionToForm", () => {
  it("seeds empty editors from undefined rules", () => {
    const form = traceExtractionToForm(undefined);
    expect(form.traceId.attributePaths).toEqual([]);
    expect(form.traceId.bodyRegex).toBe("");
    expect(form.spanId.attributePaths).toEqual([]);
    expect(form.spanId.bodyRegex).toBe("");
  });

  it("maps stored rules into rows with deterministic ids", () => {
    const rules: TraceExtractionRules = {
      traceId: { attributePaths: ["ctx.trace_id", "trace"], bodyRegex: "trace=(\\w+)" },
      spanId: { attributePaths: ["ctx.span_id"] },
    };
    const form = traceExtractionToForm(rules);
    expect(form.traceId.attributePaths).toEqual([
      { id: "traceId-path-0", path: "ctx.trace_id" },
      { id: "traceId-path-1", path: "trace" },
    ]);
    expect(form.traceId.bodyRegex).toBe("trace=(\\w+)");
    expect(form.spanId.attributePaths).toEqual([
      { id: "spanId-path-0", path: "ctx.span_id" },
    ]);
    expect(form.spanId.bodyRegex).toBe("");
  });
});

describe("formToTraceExtraction", () => {
  const empty: TraceExtractionFormState = {
    traceId: { attributePaths: [], bodyRegex: "" },
    spanId: { attributePaths: [], bodyRegex: "" },
  };

  it("returns undefined when nothing is set", () => {
    expect(formToTraceExtraction(empty)).toBeUndefined();
  });

  it("drops blank paths, trims, and dedupes in order", () => {
    const form: TraceExtractionFormState = {
      traceId: {
        attributePaths: [
          { id: "a", path: "  ctx.trace_id  " },
          { id: "b", path: "" },
          { id: "c", path: "ctx.trace_id" },
          { id: "d", path: "trace" },
        ],
        bodyRegex: "  ",
      },
      spanId: { attributePaths: [], bodyRegex: "" },
    };
    expect(formToTraceExtraction(form)).toEqual({
      traceId: { attributePaths: ["ctx.trace_id", "trace"] },
    });
  });

  it("keeps a body regex without any paths and omits the other field", () => {
    const form: TraceExtractionFormState = {
      traceId: { attributePaths: [], bodyRegex: "trace_id=(\\w+)" },
      spanId: { attributePaths: [], bodyRegex: "" },
    };
    expect(formToTraceExtraction(form)).toEqual({
      traceId: { bodyRegex: "trace_id=(\\w+)" },
    });
  });

  it("folds both fields with paths and regex", () => {
    const form: TraceExtractionFormState = {
      traceId: {
        attributePaths: [{ id: "a", path: "ctx.trace_id" }],
        bodyRegex: "trace=(\\w+)",
      },
      spanId: {
        attributePaths: [{ id: "b", path: "ctx.span_id" }],
        bodyRegex: "",
      },
    };
    expect(formToTraceExtraction(form)).toEqual({
      traceId: { attributePaths: ["ctx.trace_id"], bodyRegex: "trace=(\\w+)" },
      spanId: { attributePaths: ["ctx.span_id"] },
    });
  });

  it("round-trips stored rules through the form unchanged", () => {
    const rules: TraceExtractionRules = {
      traceId: { attributePaths: ["ctx.trace_id"], bodyRegex: "t=(\\w+)" },
      spanId: { attributePaths: ["ctx.span_id", "span"] },
    };
    expect(formToTraceExtraction(traceExtractionToForm(rules))).toEqual(rules);
  });
});
