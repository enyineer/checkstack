import { describe, it, expect } from "bun:test";
import {
  foldStreamSpans,
  capStreamSpans,
  foldAggregates,
  keepPersistedSpans,
} from "./fold";
import type { PreparedSpan } from "./prepare";
import type { InsertedSpanKey } from "../storage";

const T0 = new Date("2026-07-14T12:00:00.000Z");

function prep(over: Partial<PreparedSpan> & { spanId: string }): PreparedSpan {
  const startTs = over.startTs ?? T0;
  const durationMs = over.durationMs ?? 10;
  return {
    traceId: "tr",
    parentSpanId: null,
    name: "op",
    kind: "server",
    serviceName: "svc",
    startTs,
    endTs: new Date(startTs.getTime() + durationMs),
    durationMs,
    statusCode: "ok",
    statusMessage: null,
    attributes: null,
    events: null,
    links: null,
    resourceAttributes: null,
    isRoot: over.parentSpanId === undefined ? true : over.parentSpanId === null,
    isError: over.statusCode === "error",
    bucketStart: new Date(Math.floor(startTs.getTime() / 60_000) * 60_000),
    estimatedBytes: 100,
    ...over,
  };
}

describe("foldStreamSpans", () => {
  it("summarizes a trace: extent, error count, root service/name", () => {
    const plan = foldStreamSpans({
      streamId: "s1",
      maxSpansPerTrace: 100,
      spans: [
        prep({ spanId: "a", parentSpanId: null, name: "GET /", serviceName: "gateway", startTs: T0, durationMs: 200 }),
        prep({ spanId: "b", parentSpanId: "a", startTs: new Date(T0.getTime() + 20), durationMs: 50, statusCode: "error" }),
      ],
    });
    expect(plan.inserts).toHaveLength(2);
    expect(plan.summaries).toHaveLength(1);
    const summary = plan.summaries[0]!;
    expect(summary.spanCount).toBe(2);
    expect(summary.errorSpanCount).toBe(1);
    expect(summary.hasError).toBe(true);
    expect(summary.startTs.getTime()).toBe(T0.getTime());
    expect(summary.lastSpanAt.getTime()).toBe(T0.getTime() + 200);
    expect(summary.rootServiceName).toBe("gateway");
    expect(summary.rootSpanName).toBe("GET /");
  });

  it("folds op buckets per (service, span, minute) with min/max/sum", () => {
    const plan = foldStreamSpans({
      streamId: "s1",
      maxSpansPerTrace: 100,
      spans: [
        prep({ spanId: "a", name: "q", serviceName: "db", durationMs: 10 }),
        prep({ spanId: "b", name: "q", serviceName: "db", durationMs: 30, statusCode: "error" }),
      ],
    });
    expect(plan.buckets).toHaveLength(1);
    const b = plan.buckets[0]!;
    // The store derives sum/min/max/p95 from the raw per-span durations.
    expect(b.durationsMs).toEqual([10, 30]);
    expect(b.errorCount).toBe(1);
    expect(plan.catalogTouches).toHaveLength(1);
    expect(plan.catalogTouches[0]!.serviceName).toBe("db");
  });

  it("enforces maxSpansPerTrace per flush batch and counts drops", () => {
    const spans = Array.from({ length: 5 }, (_, i) =>
      prep({ spanId: `s${i}`, traceId: "big" }),
    );
    const plan = foldStreamSpans({ streamId: "s1", maxSpansPerTrace: 3, spans });
    expect(plan.inserts).toHaveLength(3);
    expect(plan.spanCapDropped).toBe(2);
    expect(plan.persistedSpanCount).toBe(3);
    expect(plan.summaries[0]!.spanCount).toBe(3);
  });

  it("stores + summarizes a service-less span but excludes it from buckets/catalog", () => {
    const plan = foldStreamSpans({
      streamId: "s1",
      maxSpansPerTrace: 100,
      spans: [prep({ spanId: "a", serviceName: null })],
    });
    expect(plan.inserts).toHaveLength(1);
    expect(plan.summaries).toHaveLength(1);
    expect(plan.buckets).toHaveLength(0);
    expect(plan.catalogTouches).toHaveLength(0);
  });

  it("separates two traces into two summaries", () => {
    const plan = foldStreamSpans({
      streamId: "s1",
      maxSpansPerTrace: 100,
      spans: [
        prep({ spanId: "a", traceId: "t1" }),
        prep({ spanId: "b", traceId: "t2" }),
      ],
    });
    expect(plan.summaries.map((s) => s.traceId).sort()).toEqual(["t1", "t2"]);
  });

  it("keeps the root span when a burst exceeds the cap (root arrives last)", () => {
    // A burst of child spans then the root LAST: a naive slice(0, cap) would
    // drop the root and lose the summary's root service/op. Root-priority keeps
    // it (Finding 4).
    const children = Array.from({ length: 4 }, (_, i) =>
      prep({ spanId: `c${i}`, traceId: "big", parentSpanId: "root", serviceName: "svc" }),
    );
    const root = prep({
      spanId: "root",
      traceId: "big",
      parentSpanId: null,
      name: "GET /",
      serviceName: "gateway",
    });
    const plan = foldStreamSpans({
      streamId: "s1",
      maxSpansPerTrace: 3,
      spans: [...children, root],
    });
    const keptIds = plan.inserts.map((s) => s.spanId);
    expect(keptIds).toContain("root");
    expect(plan.inserts).toHaveLength(3);
    expect(plan.spanCapDropped).toBe(2);
    const summary = plan.summaries[0]!;
    expect(summary.rootServiceName).toBe("gateway");
    expect(summary.rootSpanName).toBe("GET /");
  });
});

describe("capStreamSpans root-priority", () => {
  it("orders roots first, then non-roots in arrival order", () => {
    const spans = [
      prep({ spanId: "c0", traceId: "t", parentSpanId: "r1" }),
      prep({ spanId: "r0", traceId: "t", parentSpanId: null }),
      prep({ spanId: "c1", traceId: "t", parentSpanId: "r1" }),
      prep({ spanId: "r1", traceId: "t", parentSpanId: null }),
    ];
    const { kept, spanCapDropped } = capStreamSpans({ spans, maxSpansPerTrace: 3 });
    // Both roots kept first, then the first non-root by arrival (c0); c1 dropped.
    expect(kept.map((s) => s.spanId)).toEqual(["r0", "r1", "c0"]);
    expect(spanCapDropped).toBe(1);
  });
});

describe("keepPersistedSpans + foldAggregates (idempotent fold)", () => {
  it("folds only the store's newly-inserted subset, not re-delivered spans", () => {
    const spans = [
      prep({ spanId: "a", traceId: "tr", parentSpanId: null, serviceName: "svc", durationMs: 10 }),
      prep({ spanId: "b", traceId: "tr", parentSpanId: "a", serviceName: "svc", durationMs: 30, statusCode: "error" }),
    ];
    // The store reports only span "a" as newly inserted (b was already stored).
    const insertedKeys: InsertedSpanKey[] = [{ traceId: "tr", spanId: "a" }];
    const persisted = keepPersistedSpans({ spans, insertedKeys });
    expect(persisted.map((s) => s.spanId)).toEqual(["a"]);

    const agg = foldAggregates({ streamId: "s1", spans: persisted });
    // Only the persisted span contributes: spanCount 1, no error, one 10ms sample.
    expect(agg.summaries[0]!.spanCount).toBe(1);
    expect(agg.summaries[0]!.errorSpanCount).toBe(0);
    expect(agg.buckets[0]!.durationsMs).toEqual([10]);
  });

  it("folds nothing when every span was a duplicate", () => {
    const spans = [prep({ spanId: "a", traceId: "tr", serviceName: "svc" })];
    const persisted = keepPersistedSpans({ spans, insertedKeys: [] });
    expect(persisted).toHaveLength(0);
    const agg = foldAggregates({ streamId: "s1", spans: persisted });
    expect(agg.summaries).toHaveLength(0);
    expect(agg.buckets).toHaveLength(0);
    expect(agg.catalogTouches).toHaveLength(0);
  });
});
