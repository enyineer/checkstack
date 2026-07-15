import { describe, it, expect } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";
import type {
  NormalizedLogRecord,
  NormalizedMetricPoint,
} from "@checkstack/telemetry-common";
import {
  createLogToMetricSourceType,
  foldLogsToMetric,
  LogToMetricConfigSchema,
  MAX_DERIVED_SERIES_PER_BATCH,
  MAX_LABEL_ATTRIBUTES,
  type LogToMetricConfig,
} from "./log-to-metric";
import type { BoundTelemetrySink } from "../extension-points";

const NOW = new Date("2026-01-01T00:00:10.000Z");

function log(overrides: Partial<NormalizedLogRecord> = {}): NormalizedLogRecord {
  return {
    ts: new Date("2026-01-01T00:00:00.000Z"),
    body: "hello world",
    ...overrides,
  };
}

function config(overrides: Partial<LogToMetricConfig>): LogToMetricConfig {
  return LogToMetricConfigSchema.parse({
    inputStreamId: "stream-1",
    metricName: "log_events",
    mode: "count",
    ...overrides,
  });
}

describe("LogToMetricConfigSchema", () => {
  it("rejects extractNumber without an attributePath", () => {
    const result = LogToMetricConfigSchema.safeParse({
      inputStreamId: "s",
      metricName: "m",
      mode: "extractNumber",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid metric name", () => {
    const result = LogToMetricConfigSchema.safeParse({
      inputStreamId: "s",
      metricName: "1-bad name",
      mode: "count",
    });
    expect(result.success).toBe(false);
  });

  it("caps labelsFromAttributes", () => {
    const result = LogToMetricConfigSchema.safeParse({
      inputStreamId: "s",
      metricName: "m",
      mode: "count",
      labelsFromAttributes: Array.from({ length: MAX_LABEL_ATTRIBUTES + 1 }, (_, i) => `a${i}`),
    });
    expect(result.success).toBe(false);
  });
});

describe("foldLogsToMetric - count mode", () => {
  it("emits one delta point with the match count and the batch max ts", () => {
    const { points } = foldLogsToMetric({
      config: config({ mode: "count" }),
      records: [
        log({ ts: new Date("2026-01-01T00:00:01.000Z") }),
        log({ ts: new Date("2026-01-01T00:00:03.000Z") }),
      ],
      now: NOW,
    });
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      name: "log_events",
      type: "counter",
      counterKind: "delta",
      value: 2,
      labels: {},
    });
    expect(points[0]!.ts.toISOString()).toBe("2026-01-01T00:00:03.000Z");
  });

  it("emits a single 0-delta point when nothing matches (continuity)", () => {
    const { points } = foldLogsToMetric({
      config: config({ mode: "count", filter: { bodyContains: "nope" } }),
      records: [log(), log()],
      now: NOW,
    });
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ value: 0, labels: {} });
  });

  it("groups counts by label tuple", () => {
    const { points } = foldLogsToMetric({
      config: config({ mode: "count", labelsFromAttributes: ["service"] }),
      records: [
        log({ attributes: { service: "api" } }),
        log({ attributes: { service: "api" } }),
        log({ attributes: { service: "web" } }),
      ],
      now: NOW,
    });
    const byService = Object.fromEntries(
      points.map((p) => [p.labels.service, p.value]),
    );
    expect(byService).toEqual({ api: 2, web: 1 });
  });

  it("applies minSeverityNumber and bodyContains filters", () => {
    const { points } = foldLogsToMetric({
      config: config({ mode: "count", filter: { minSeverityNumber: 17, bodyContains: "boom" } }),
      records: [
        log({ severityNumber: 17, body: "boom happened" }), // pass
        log({ severityNumber: 9, body: "boom quiet" }), // below severity
        log({ severityNumber: 21, body: "all good" }), // no substring
        log({ body: "boom no severity" }), // missing severity number
      ],
      now: NOW,
    });
    expect(points[0]!.value).toBe(1);
  });
});

describe("foldLogsToMetric - extractNumber mode", () => {
  it("emits one gauge point per matching record with the extracted value", () => {
    const { points } = foldLogsToMetric({
      config: config({ mode: "extractNumber", attributePath: "duration_ms" }),
      records: [
        log({ attributes: { duration_ms: 12.5 }, ts: new Date("2026-01-01T00:00:02.000Z") }),
        log({ attributes: { duration_ms: "30" } }),
      ],
      now: NOW,
    });
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ type: "gauge", value: 12.5 });
    expect(points[0]!.ts.toISOString()).toBe("2026-01-01T00:00:02.000Z");
    expect(points[1]!.value).toBe(30);
  });

  it("skips records with a missing or non-numeric value at the path", () => {
    const { points } = foldLogsToMetric({
      config: config({ mode: "extractNumber", attributePath: "n" }),
      records: [
        log({ attributes: { n: 5 } }),
        log({ attributes: { n: "not-a-number" } }),
        log({ attributes: {} }),
      ],
      now: NOW,
    });
    expect(points).toHaveLength(1);
    expect(points[0]!.value).toBe(5);
  });

  it("reads nested attribute paths and carries resource", () => {
    const { points } = foldLogsToMetric({
      config: config({ mode: "extractNumber", attributePath: "http.duration" }),
      records: [
        log({
          attributes: { http: { duration: 42 } },
          resource: { serviceName: "api" },
        }),
      ],
      now: NOW,
    });
    expect(points[0]).toMatchObject({ value: 42, resource: { serviceName: "api" } });
  });
});

describe("foldLogsToMetric - per-batch series cardinality cap", () => {
  it("caps count mode at MAX_DERIVED_SERIES_PER_BATCH distinct tuples", () => {
    // 150 records, each a DISTINCT label value -> 150 distinct tuples.
    const records = Array.from({ length: 150 }, (_, i) =>
      log({ attributes: { rid: `req-${i}` } }),
    );
    const { points, droppedTupleCount } = foldLogsToMetric({
      config: config({ mode: "count", labelsFromAttributes: ["rid"] }),
      records,
      now: NOW,
    });
    expect(points).toHaveLength(MAX_DERIVED_SERIES_PER_BATCH);
    expect(droppedTupleCount).toBe(150 - MAX_DERIVED_SERIES_PER_BATCH);
  });

  it("keeps accumulating already-seen tuples after the cap is hit", () => {
    // 100 distinct tuples fill the cap; a 101st NEW tuple is dropped, but a
    // REPEAT of an admitted tuple still increments its count.
    const records = [
      ...Array.from({ length: MAX_DERIVED_SERIES_PER_BATCH }, (_, i) =>
        log({ attributes: { rid: `req-${i}` } }),
      ),
      log({ attributes: { rid: "req-0" } }), // repeat of an admitted tuple
      log({ attributes: { rid: "overflow" } }), // new tuple beyond the cap
    ];
    const { points, droppedTupleCount } = foldLogsToMetric({
      config: config({ mode: "count", labelsFromAttributes: ["rid"] }),
      records,
      now: NOW,
    });
    expect(points).toHaveLength(MAX_DERIVED_SERIES_PER_BATCH);
    expect(droppedTupleCount).toBe(1);
    const req0 = points.find((p) => p.labels.rid === "req-0");
    expect(req0!.value).toBe(2);
  });

  it("caps extractNumber mode distinct series, still emitting repeats", () => {
    const records = Array.from({ length: 150 }, (_, i) =>
      log({ attributes: { rid: `req-${i}`, n: i } }),
    );
    const { points, droppedTupleCount } = foldLogsToMetric({
      config: config({
        mode: "extractNumber",
        attributePath: "n",
        labelsFromAttributes: ["rid"],
      }),
      records,
      now: NOW,
    });
    expect(points).toHaveLength(MAX_DERIVED_SERIES_PER_BATCH);
    expect(droppedTupleCount).toBe(150 - MAX_DERIVED_SERIES_PER_BATCH);
  });

  it("logs exactly one warn and emits 100 points when a batch overflows (process seam)", async () => {
    const emitted: NormalizedMetricPoint[][] = [];
    const sink: BoundTelemetrySink = {
      boundSignals: ["metrics"],
      emit: async (_signal, records) => {
        // The seam narrows to metric points; capture them for the count assert.
        emitted.push(records as NormalizedMetricPoint[]);
        return { bound: true, accepted: records.length, rejected: 0 };
      },
    };
    const logger = createMockLogger();
    const type = createLogToMetricSourceType();
    const records = Array.from({ length: 150 }, (_, i) => ({
      ts: new Date(0),
      body: "x",
      attributes: { rid: `req-${i}` },
    }));
    await type.derive!.process({
      config: config({ mode: "count", labelsFromAttributes: ["rid"] }),
      streamId: "logs-1",
      records,
      sink,
      logger,
    });
    expect(logger.warn.mock.calls).toHaveLength(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toHaveLength(MAX_DERIVED_SERIES_PER_BATCH);
  });
});
