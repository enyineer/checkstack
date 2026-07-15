import { describe, it, expect } from "bun:test";
import type { NormalizedLogRecord } from "@checkstack/telemetry-common";
import {
  foldLogsToTrace,
  LogToTraceConfigSchema,
  type LogToTraceConfig,
} from "./log-to-trace";

const TRACE_ID = "0123456789abcdef0123456789abcdef";
const SPAN_ID = "0123456789abcdef";

function log(overrides: Partial<NormalizedLogRecord> = {}): NormalizedLogRecord {
  return {
    ts: new Date("2026-01-01T00:00:05.000Z"),
    body: "request handled",
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    ...overrides,
  };
}

function config(overrides: Partial<LogToTraceConfig> = {}): LogToTraceConfig {
  return LogToTraceConfigSchema.parse({ inputStreamId: "stream-1", ...overrides });
}

describe("foldLogsToTrace", () => {
  it("builds an internal span ending at ts with a default name", () => {
    const { spans, skippedNoTrace } = foldLogsToTrace({ config: config(), records: [log()] });
    expect(skippedNoTrace).toBe(0);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      kind: "internal",
      name: "log",
      status: { code: "unset" },
    });
    expect(spans[0]!.endTs.toISOString()).toBe("2026-01-01T00:00:05.000Z");
    // No duration -> zero-width span.
    expect(spans[0]!.startTs.getTime()).toBe(spans[0]!.endTs.getTime());
  });

  it("skips records missing trace or span id (counted)", () => {
    const { spans, skippedNoTrace } = foldLogsToTrace({
      config: config(),
      records: [
        log({ traceId: undefined }),
        log({ spanId: undefined }),
        log({ traceId: "too-short" }),
        log(),
      ],
    });
    expect(spans).toHaveLength(1);
    expect(skippedNoTrace).toBe(3);
  });

  it("derives startTs from a numeric duration attribute (ms)", () => {
    const { spans } = foldLogsToTrace({
      config: config({ durationAttribute: "duration_ms" }),
      records: [log({ attributes: { duration_ms: 2000 } })],
    });
    expect(spans[0]!.startTs.toISOString()).toBe("2026-01-01T00:00:03.000Z");
    expect(spans[0]!.endTs.toISOString()).toBe("2026-01-01T00:00:05.000Z");
  });

  it("ignores a negative or non-numeric duration (zero-width)", () => {
    const { spans } = foldLogsToTrace({
      config: config({ durationAttribute: "d" }),
      records: [log({ attributes: { d: -50 } })],
    });
    expect(spans[0]!.startTs.getTime()).toBe(spans[0]!.endTs.getTime());
  });

  it("marks error status for error-level severity", () => {
    const { spans } = foldLogsToTrace({
      config: config(),
      records: [log({ severityNumber: 17 })],
    });
    expect(spans[0]!.status).toEqual({ code: "error" });
  });

  it("resolves the name from nameAttribute, else fixedName", () => {
    const fromAttr = foldLogsToTrace({
      config: config({ nameAttribute: "op", fixedName: "fallback" }),
      records: [log({ attributes: { op: "GET /users" } })],
    });
    expect(fromAttr.spans[0]!.name).toBe("GET /users");

    const fromFixed = foldLogsToTrace({
      config: config({ nameAttribute: "op", fixedName: "fallback" }),
      records: [log({ attributes: {} })],
    });
    expect(fromFixed.spans[0]!.name).toBe("fallback");
  });

  it("resolves service name from resource by default and from an attribute path when configured", () => {
    const fromResource = foldLogsToTrace({
      config: config(),
      records: [log({ resource: { serviceName: "api" } })],
    });
    expect(fromResource.spans[0]!.resource).toEqual({ serviceName: "api" });

    const fromAttr = foldLogsToTrace({
      config: config({ serviceNameFrom: "svc" }),
      records: [log({ attributes: { svc: "worker" } })],
    });
    expect(fromAttr.spans[0]!.resource).toEqual({ serviceName: "worker" });
  });
});
