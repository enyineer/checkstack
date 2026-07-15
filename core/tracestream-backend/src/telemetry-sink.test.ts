import { describe, it, expect } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";
import { qualifyAccessRuleId } from "@checkstack/common";
import {
  DEFAULT_TRACE_STREAM_CONFIG,
  parseOtlpTracesJson,
  pluginMetadata,
  tracestreamAccess,
} from "@checkstack/tracestream-common";
import type { AuthService, AuthUser } from "@checkstack/backend-api";
import type { NormalizedSpan } from "@checkstack/telemetry-common";
import type { IngestPipeline, IngestResult } from "./ingest/pipeline";
import type { StreamConfigResolver } from "./ingest/stream-config";
import { createTracestreamTelemetrySink } from "./telemetry-sink";

const MANAGE_RULE = qualifyAccessRuleId(pluginMetadata, tracestreamAccess.manage);
const TRACE_ID = "5b8aa5a2d2c872e8321cf37308d69df2";
const SPAN_ID = "051581bf3cb55c13";

const configResolver: StreamConfigResolver = {
  resolve: async () => DEFAULT_TRACE_STREAM_CONFIG,
};

function capturingPipeline(result: IngestResult): {
  pipeline: IngestPipeline;
  captured: NormalizedSpan[][];
} {
  const captured: NormalizedSpan[][] = [];
  const pipeline: IngestPipeline = {
    ingest: ({ spans }) => {
      captured.push(spans);
      return result;
    },
    flushNow: async () => {},
    start: () => {},
    stop: () => {},
  };
  return { pipeline, captured };
}

function fakeAuth(hasAccess: boolean): Pick<AuthService, "check" | "listAccessibleObjectIds"> {
  return {
    check: async () => ({ hasAccess }) as never,
    listAccessibleObjectIds: async () => [],
  };
}

const RESULT: IngestResult = {
  accepted: 1,
  rejectedRateLimit: 0,
  rejectedBuffer: 0,
  retryAfterSeconds: 0,
};

describe("createTracestreamTelemetrySink", () => {
  it("declares the traces signal", () => {
    const sink = createTracestreamTelemetrySink({
      resolveStream: async () => ({ id: "s1", name: "S" }),
      pipeline: capturingPipeline(RESULT).pipeline,
      configResolver,
      auth: fakeAuth(true),
      logger: createMockLogger(),
    });
    expect(sink.signal).toBe("traces");
  });

  it("feeds records to the SAME pipeline the endpoints use, unchanged (parity)", async () => {
    // The exact records a source hands the sink are what the OTLP decoder
    // produces - so decode a payload and route those records through the sink.
    const { spans: records } = parseOtlpTracesJson({
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "api" } }] },
          scopeSpans: [{ spans: [{ traceId: TRACE_ID, spanId: SPAN_ID, name: "op", kind: 2 }] }],
        },
      ],
    });
    const { pipeline, captured } = capturingPipeline({ ...RESULT, accepted: records.length });
    const sink = createTracestreamTelemetrySink({
      resolveStream: async () => ({ id: "s1", name: "S" }),
      pipeline,
      configResolver,
      auth: fakeAuth(true),
      logger: createMockLogger(),
    });
    const out = await sink.write({
      streamId: "s1",
      records,
      source: { sourceId: "src", sourceTypeId: "type" },
    });
    expect(out.accepted).toBe(records.length);
    // No mapping/normalization in the sink: the pipeline receives the SAME array.
    expect(captured[0]).toBe(records);
  });

  it("rejects every record for an unknown stream", async () => {
    const { spans: records } = parseOtlpTracesJson({
      resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: TRACE_ID, spanId: SPAN_ID, name: "op", kind: 1 }] }] }],
    });
    const sink = createTracestreamTelemetrySink({
      resolveStream: async () => null,
      pipeline: capturingPipeline(RESULT).pipeline,
      configResolver,
      auth: fakeAuth(true),
      logger: createMockLogger(),
    });
    const out = await sink.write({
      streamId: "gone",
      records,
      source: { sourceId: "src", sourceTypeId: "type" },
    });
    expect(out).toEqual({ accepted: 0, rejected: records.length });
  });

  describe("assertBindable", () => {
    function makeSink(hasAccess: boolean, exists = true) {
      return createTracestreamTelemetrySink({
        resolveStream: async () => (exists ? { id: "s1", name: "S" } : null),
        pipeline: capturingPipeline(RESULT).pipeline,
        configResolver,
        auth: fakeAuth(hasAccess),
        logger: createMockLogger(),
      });
    }

    it("allows a service user", async () => {
      const sink = makeSink(false);
      const user: AuthUser = { type: "service", pluginId: "telemetry" };
      await expect(sink.assertBindable({ streamId: "s1", user })).resolves.toBeUndefined();
    });

    it("allows a caller holding the global manage rule", async () => {
      const sink = makeSink(false);
      const user: AuthUser = { type: "user", id: "u1", accessRules: [MANAGE_RULE] };
      await expect(sink.assertBindable({ streamId: "s1", user })).resolves.toBeUndefined();
    });

    it("allows a team-grant holder via auth.check", async () => {
      const sink = makeSink(true);
      const user: AuthUser = { type: "user", id: "u1", accessRules: [] };
      await expect(sink.assertBindable({ streamId: "s1", user })).resolves.toBeUndefined();
    });

    it("forbids a caller with no grant", async () => {
      const sink = makeSink(false);
      const user: AuthUser = { type: "user", id: "u1", accessRules: [] };
      await expect(sink.assertBindable({ streamId: "s1", user })).rejects.toThrow();
    });

    it("404s an unknown stream", async () => {
      const sink = makeSink(true, false);
      const user: AuthUser = { type: "user", id: "u1", accessRules: [] };
      await expect(sink.assertBindable({ streamId: "gone", user })).rejects.toThrow();
    });
  });
});
