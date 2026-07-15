import { describe, it, expect } from "bun:test";
import {
  MAX_EXTRACTED_TRACE_ID_LENGTH,
  TRACE_EXTRACTION_BODY_SLICE,
} from "../schemas";
import {
  applyTraceExtraction,
  compileTraceExtraction,
} from "./trace-extraction";

/** Compile + apply in one step against a bare line (no ids, no attributes). */
function extract({
  rules,
  attributes,
  body = "",
  traceId,
  spanId,
}: {
  rules: Parameters<typeof compileTraceExtraction>[0];
  attributes?: Record<string, unknown>;
  body?: string;
  traceId?: string;
  spanId?: string;
}) {
  return applyTraceExtraction({
    compiled: compileTraceExtraction(rules),
    attributes,
    body,
    traceId,
    spanId,
  });
}

describe("compileTraceExtraction", () => {
  it("returns null when there are no rules", () => {
    expect(compileTraceExtraction(undefined)).toBeNull();
  });

  it("returns null when no field has a usable rule", () => {
    expect(compileTraceExtraction({ traceId: {} })).toBeNull();
    expect(compileTraceExtraction({ traceId: { attributePaths: [] } })).toBeNull();
  });
});

describe("applyTraceExtraction - attribute paths", () => {
  it("extracts from a nested attribute path", () => {
    const result = extract({
      rules: { traceId: { attributePaths: ["ctx.trace_id"] } },
      attributes: { ctx: { trace_id: "abc123" } },
    });
    expect(result.traceId).toBe("abc123");
  });

  it("extracts from a literal (flat) dotted key, as syslog emits", () => {
    const result = extract({
      rules: { traceId: { attributePaths: ["sd.trace.id"] } },
      attributes: { "sd.trace.id": "deadbeef" },
    });
    expect(result.traceId).toBe("deadbeef");
  });

  it("tries paths in order; the first STRING hit wins", () => {
    const result = extract({
      rules: {
        traceId: { attributePaths: ["missing", "ctx.trace_id", "other"] },
      },
      attributes: { ctx: { trace_id: "first-wins" }, other: "later" },
    });
    // dashes are stripped by normalization.
    expect(result.traceId).toBe("firstwins");
  });

  it("skips a non-string value at a path (only string hits count)", () => {
    const result = extract({
      rules: { traceId: { attributePaths: ["n", "s"] } },
      attributes: { n: 42, s: "abc" },
    });
    expect(result.traceId).toBe("abc");
  });
});

describe("applyTraceExtraction - body regex", () => {
  it("extracts capture group 1 from the body", () => {
    const result = extract({
      rules: { traceId: { bodyRegex: "trace=([0-9a-f]+)" } },
      body: "request done trace=abc123 status=200",
    });
    expect(result.traceId).toBe("abc123");
  });

  it("falls back to the body regex when no attribute path matches", () => {
    const result = extract({
      rules: {
        traceId: { attributePaths: ["ctx.trace_id"], bodyRegex: "tid=(\\w+)" },
      },
      attributes: { unrelated: "x" },
      body: "tid=frombody",
    });
    expect(result.traceId).toBe("frombody");
  });

  it("only sees the leading slice of the body", () => {
    // Bury a match just PAST the slice boundary; it must not be found.
    const filler = "x".repeat(TRACE_EXTRACTION_BODY_SLICE);
    const result = extract({
      rules: { traceId: { bodyRegex: "tid=(\\w+)" } },
      body: `${filler}tid=hidden`,
    });
    expect(result.traceId).toBeUndefined();

    // A match INSIDE the slice is still found.
    const inSlice = extract({
      rules: { traceId: { bodyRegex: "tid=(\\w+)" } },
      body: `tid=seen ${filler}`,
    });
    expect(inSlice.traceId).toBe("seen");
  });
});

describe("applyTraceExtraction - carried id precedence & normalization", () => {
  it("keeps a usable carried id and does not apply the rule", () => {
    const result = extract({
      rules: { traceId: { attributePaths: ["ctx.trace_id"] } },
      attributes: { ctx: { trace_id: "fromrule" } },
      traceId: "nativewins",
    });
    expect(result.traceId).toBe("nativewins");
  });

  it("NORMALIZES a carried uppercase/dashed id (so it matches the stored W3C id)", () => {
    const result = extract({
      rules: undefined,
      traceId: "4BF92F35-7B34-11EE-B962-0242AC120002",
    });
    expect(result.traceId).toBe("4bf92f357b3411eeb9620242ac120002");
  });

  it("passes an already-canonical OTLP lowercase-hex id through unchanged", () => {
    const canonical = "4bf92f3577b34da6a3ce929d0e0e4736";
    const result = extract({
      rules: { traceId: { attributePaths: ["ctx.trace_id"] } },
      attributes: { ctx: { trace_id: "fromrule" } },
      traceId: canonical,
    });
    expect(result.traceId).toBe(canonical);
  });

  it("treats a carried empty-string id as ABSENT and lets the rule fill it", () => {
    const result = extract({
      rules: { traceId: { attributePaths: ["ctx.trace_id"] } },
      attributes: { ctx: { trace_id: "from-rule" } },
      traceId: "",
    });
    // The empty carried id never blocks extraction and never persists as ''.
    expect(result.traceId).toBe("fromrule");
  });

  it("treats a carried whitespace/dashes-only id as ABSENT and lets the rule fill it", () => {
    const result = extract({
      rules: { traceId: { bodyRegex: "tid=(\\w+)" } },
      body: "tid=recovered",
      traceId: "  --  ",
    });
    expect(result.traceId).toBe("recovered");
  });

  it("discards a carried over-long id, then the rule fills it", () => {
    const result = extract({
      rules: { traceId: { attributePaths: ["ctx.trace_id"] } },
      attributes: { ctx: { trace_id: "from-rule" } },
      traceId: "a".repeat(MAX_EXTRACTED_TRACE_ID_LENGTH + 1),
    });
    expect(result.traceId).toBe("fromrule");
  });

  it("discards a carried over-long id with no rule to fill it (never persists it)", () => {
    const result = extract({
      rules: undefined,
      traceId: "a".repeat(MAX_EXTRACTED_TRACE_ID_LENGTH + 1),
    });
    expect(result.traceId).toBeUndefined();
  });
});

describe("applyTraceExtraction - id normalization", () => {
  it("trims, strips dashes and lowercases", () => {
    const result = extract({
      rules: { traceId: { attributePaths: ["t"] } },
      attributes: { t: "  4BF9-2B32-7E13  " },
    });
    expect(result.traceId).toBe("4bf92b327e13");
  });

  it("discards an empty id (whitespace / dashes only)", () => {
    const result = extract({
      rules: { traceId: { attributePaths: ["t"] } },
      attributes: { t: " -- " },
    });
    expect(result.traceId).toBeUndefined();
  });

  it("discards an over-long id", () => {
    const tooLong = "a".repeat(MAX_EXTRACTED_TRACE_ID_LENGTH + 1);
    const result = extract({
      rules: { traceId: { attributePaths: ["t"] } },
      attributes: { t: tooLong },
    });
    expect(result.traceId).toBeUndefined();
  });
});

describe("applyTraceExtraction - independence & robustness", () => {
  it("resolves spanId independently of traceId", () => {
    const result = extract({
      rules: {
        traceId: { attributePaths: ["ctx.trace_id"] },
        spanId: { attributePaths: ["ctx.span_id"] },
      },
      attributes: { ctx: { span_id: "span-1" } },
    });
    expect(result.traceId).toBeUndefined();
    expect(result.spanId).toBe("span1");
  });

  it("is a no-op when the stream declares no extraction rules", () => {
    const result = extract({
      rules: undefined,
      attributes: { ctx: { trace_id: "abc" } },
      body: "tid=abc",
    });
    expect(result.traceId).toBeUndefined();
    expect(result.spanId).toBeUndefined();
  });
});
