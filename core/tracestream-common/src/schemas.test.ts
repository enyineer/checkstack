import { describe, it, expect } from "bun:test";
import {
  TraceStreamConfigSchema,
  DEFAULT_TRACE_STREAM_CONFIG,
  TraceSamplingConfigSchema,
  SearchTracesSchema,
  TraceSummarySchema,
  TraceSearchCursorSchema,
  TraceStreamSummarySchema,
  FindTraceByIdMatchSchema,
} from "./schemas";

describe("TraceStreamConfigSchema", () => {
  it("applies the plan's defaults for an empty object", () => {
    expect(DEFAULT_TRACE_STREAM_CONFIG).toEqual({
      hotRetentionHours: 6,
      retainedTraceRetentionDays: 7,
      summaryRetentionDays: 30,
      minuteRetentionHours: 48,
      hourlyRetentionDays: 90,
      completionGraceSeconds: 30,
      sampling: {
        keepErrorTraces: true,
        slowTraceThresholdMs: 1000,
        baselineSampleRate: 0.01,
        maxRetainedTracesPerHour: null,
      },
      serviceCap: 100,
      operationCapPerService: 500,
      maxSpansPerTrace: 2000,
      maxSpanBytes: 32_768,
      softRateLimitPerMinute: 60_000,
    });
  });

  it("fills the nested sampling policy when sampling is omitted", () => {
    const parsed = TraceStreamConfigSchema.parse({ serviceCap: 250 });
    expect(parsed.serviceCap).toBe(250);
    expect(parsed.sampling.baselineSampleRate).toBe(0.01);
  });

  it("rejects a completionGraceSeconds below the floor", () => {
    expect(
      TraceStreamConfigSchema.safeParse({ completionGraceSeconds: 1 }).success,
    ).toBe(false);
  });
});

describe("TraceSamplingConfigSchema", () => {
  it("allows null slowTraceThresholdMs (no slow rule) and null hourly ceiling", () => {
    const parsed = TraceSamplingConfigSchema.parse({
      slowTraceThresholdMs: null,
      maxRetainedTracesPerHour: null,
    });
    expect(parsed.slowTraceThresholdMs).toBeNull();
    expect(parsed.maxRetainedTracesPerHour).toBeNull();
  });

  it("rejects a baselineSampleRate above 1", () => {
    expect(
      TraceSamplingConfigSchema.safeParse({ baselineSampleRate: 1.5 }).success,
    ).toBe(false);
  });
});

describe("SearchTracesSchema", () => {
  it("defaults limit to 50", () => {
    const parsed = SearchTracesSchema.parse({
      streamId: "s1",
      from: new Date("2026-07-14T00:00:00Z"),
      to: new Date("2026-07-14T01:00:00Z"),
    });
    expect(parsed.limit).toBe(50);
  });

  it("rejects a limit above 100", () => {
    expect(
      SearchTracesSchema.safeParse({
        streamId: "s1",
        from: new Date(),
        to: new Date(),
        limit: 101,
      }).success,
    ).toBe(false);
  });

  it("round-trips a keyset cursor", () => {
    const cursor = { startTs: new Date("2026-07-14T00:30:00Z"), traceId: "abc" };
    const parsed = SearchTracesSchema.parse({
      streamId: "s1",
      from: new Date(),
      to: new Date(),
      cursor,
    });
    expect(parsed.cursor).toEqual(cursor);
    // The standalone cursor schema accepts the same shape.
    expect(TraceSearchCursorSchema.parse(cursor)).toEqual(cursor);
  });
});

describe("TraceSummarySchema", () => {
  it("treats `retained` as a nullable tri-state (null = undecided)", () => {
    const base = {
      traceId: "t1",
      rootServiceName: null,
      rootSpanName: null,
      startTs: new Date(),
      durationMs: 12,
      spanCount: 3,
      errorSpanCount: 0,
      hasError: false,
      lastSpanAt: new Date(),
    };
    expect(TraceSummarySchema.parse({ ...base, retained: null }).retained).toBeNull();
    expect(TraceSummarySchema.parse({ ...base, retained: true }).retained).toBe(
      true,
    );
    expect(TraceSummarySchema.parse({ ...base, retained: false }).retained).toBe(
      false,
    );
  });
});

describe("listKey identifier fields", () => {
  it("keys the stream summary row on `id` (the RLAC listKey lesson)", () => {
    const parsed = TraceStreamSummarySchema.parse({
      id: "stream-1",
      name: "prod",
      lastReceivedAt: null,
      traces24h: 0,
      errorTraces24h: 0,
      serviceCount: 0,
    });
    expect(parsed.id).toBe("stream-1");
  });

  it("keys the cross-stream match on `id` (the STREAM id)", () => {
    const parsed = FindTraceByIdMatchSchema.parse({
      id: "stream-9",
      streamName: "prod",
      summary: {
        traceId: "t1",
        rootServiceName: "api",
        rootSpanName: "GET /",
        startTs: new Date(),
        durationMs: 5,
        spanCount: 1,
        errorSpanCount: 0,
        hasError: false,
        retained: true,
        lastSpanAt: new Date(),
      },
    });
    expect(parsed.id).toBe("stream-9");
  });
});
