import { describe, it, expect, mock } from "bun:test";
import { qualifyAccessRuleId } from "@checkstack/common";
import { createMockLogger } from "@checkstack/test-utils-backend";
import type { AuthService } from "@checkstack/backend-api";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  logstreamAccess,
  pluginMetadata,
  normalizeOtlpPayload,
  type IngestedLine,
  type LogStreamConfig,
} from "@checkstack/logstream-common";
import type { NormalizedLogRecord } from "@checkstack/telemetry-common";
import {
  createLogstreamTelemetrySink,
  type ListLogStreams,
  type ResolveLogStream,
  type ResolveLogStreams,
} from "./telemetry-sink";
import type { IngestPipeline, IngestResult } from "./ingest/pipeline";
import type { StreamConfigResolver } from "./ingest/stream-config";

const MANAGE_ID = qualifyAccessRuleId(
  pluginMetadata,
  logstreamAccess.manage,
);
const SOURCE = { sourceId: "src-1", sourceTypeId: "vector.http" };

type SinkAuth = Pick<AuthService, "check"> &
  Partial<Pick<AuthService, "listAccessibleObjectIds">>;

function fakeAuth(hasAccess: boolean): Pick<AuthService, "check"> {
  return { check: async () => ({ hasAccess }) };
}

/** A pipeline that records the lines handed to it and echoes a fixed result. */
function fakePipeline(
  result: IngestResult = {
    accepted: 0,
    rejectedRateLimit: 0,
    rejectedBuffer: 0,
    retryAfterSeconds: 0,
  },
): IngestPipeline & { calls: { streamId: string; lines: IngestedLine[] }[] } {
  const calls: { streamId: string; lines: IngestedLine[] }[] = [];
  return {
    calls,
    ingest({ streamId, lines }) {
      calls.push({ streamId, lines });
      return { ...result, accepted: result.accepted || lines.length };
    },
    flushNow: async () => {},
    start: () => {},
    stop: () => {},
  };
}

function fakeConfigResolver(config: LogStreamConfig): StreamConfigResolver {
  return { resolve: async () => config };
}

const resolveKnown: ResolveLogStream = async (streamId) => ({
  id: streamId,
  name: "Payments logs",
});
const resolveMissing: ResolveLogStream = async () => null;

function makeSink({
  resolveStream = resolveKnown,
  resolveStreams,
  listStreams,
  pipeline = fakePipeline(),
  config = DEFAULT_LOG_STREAM_CONFIG,
  auth = fakeAuth(false),
}: {
  resolveStream?: ResolveLogStream;
  resolveStreams?: ResolveLogStreams;
  listStreams?: ListLogStreams;
  pipeline?: IngestPipeline;
  config?: LogStreamConfig;
  auth?: SinkAuth;
} = {}) {
  return createLogstreamTelemetrySink({
    resolveStream,
    ...(resolveStreams ? { resolveStreams } : {}),
    ...(listStreams ? { listStreams } : {}),
    pipeline,
    configResolver: fakeConfigResolver(config),
    // Default the bulk grant filter to "no team grants" so tests that never
    // exercise the picker still satisfy the widened auth type.
    auth: { listAccessibleObjectIds: async () => [], ...auth },
    logger: createMockLogger(),
  });
}

const now = new Date("2026-07-14T12:00:00.000Z");

function record(overrides: Partial<NormalizedLogRecord> = {}): NormalizedLogRecord {
  return {
    ts: now,
    severityText: "INFO",
    body: "hello world",
    ...overrides,
  };
}

describe("logstream telemetry sink - write mapping", () => {
  it("applies the stream's severityRules.valueMap (WARN -> error)", async () => {
    const pipeline = fakePipeline();
    const config: LogStreamConfig = {
      ...DEFAULT_LOG_STREAM_CONFIG,
      severityRules: { valueMap: { WARN: "error" } },
    };
    const contribution = makeSink({ pipeline, config });

    await contribution.write({
      streamId: "stream-1",
      source: SOURCE,
      records: [record({ severityText: "WARN", body: "disk almost full" })],
    });

    expect(pipeline.calls[0]!.lines[0]!.band).toBe("error");
  });

  it("clamps an out-of-window event timestamp forward", async () => {
    const pipeline = fakePipeline();
    const contribution = makeSink({ pipeline });
    const ancient = new Date("2000-01-01T00:00:00.000Z");

    await contribution.write({
      streamId: "stream-1",
      source: SOURCE,
      now,
      records: [record({ ts: ancient })],
    });

    const line = pipeline.calls[0]!.lines[0]!;
    // Snapped to now - MAX_PAST_LAG_MS (24h), never left at the year-2000 value.
    expect(line.ts.getTime()).toBe(now.getTime() - 24 * 60 * 60_000);
  });

  it("truncates the body to the stream's maxLineBytes", async () => {
    const pipeline = fakePipeline();
    const config: LogStreamConfig = { ...DEFAULT_LOG_STREAM_CONFIG, maxLineBytes: 256 };
    const contribution = makeSink({ pipeline, config });

    await contribution.write({
      streamId: "stream-1",
      source: SOURCE,
      records: [record({ body: "x".repeat(1000) })],
    });

    expect(pipeline.calls[0]!.lines[0]!.body).toHaveLength(256);
  });

  it("carries trace/span ids through", async () => {
    const pipeline = fakePipeline();
    const contribution = makeSink({ pipeline });
    await contribution.write({
      streamId: "stream-1",
      source: SOURCE,
      records: [
        record({
          traceId: "0af7651916cd43dd8448eb211c80319c",
          spanId: "b7ad6b7169203331",
        }),
      ],
    });
    const line = pipeline.calls[0]!.lines[0]!;
    expect(line.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(line.spanId).toBe("b7ad6b7169203331");
  });

  it("folds resource serviceName into the service.name attribute", async () => {
    const pipeline = fakePipeline();
    const contribution = makeSink({ pipeline });
    await contribution.write({
      streamId: "stream-1",
      source: SOURCE,
      records: [record({ resource: { serviceName: "api", attributes: { "host.name": "box" } } })],
    });
    expect(pipeline.calls[0]!.lines[0]!.resource).toEqual({
      "host.name": "box",
      "service.name": "api",
    });
  });

  it("maps the pipeline result (rate-limit + buffer rejects folded into rejected)", async () => {
    const pipeline = fakePipeline({
      accepted: 1,
      rejectedRateLimit: 2,
      rejectedBuffer: 3,
      retryAfterSeconds: 5,
    });
    const contribution = makeSink({ pipeline });
    const result = await contribution.write({
      streamId: "stream-1",
      source: SOURCE,
      records: [record()],
    });
    expect(result).toEqual({ accepted: 1, rejected: 5 });
  });

  it("counts a content-less record (empty body, no attributes) as rejected without ingesting", async () => {
    const pipeline = fakePipeline();
    const contribution = makeSink({ pipeline });
    const result = await contribution.write({
      streamId: "stream-1",
      source: SOURCE,
      records: [record({ body: "" })],
    });
    expect(result).toEqual({ accepted: 0, rejected: 1 });
    expect(pipeline.calls).toHaveLength(0);
  });

  it("rejects all records for a nonexistent stream without ingesting", async () => {
    const pipeline = fakePipeline();
    const contribution = makeSink({ pipeline, resolveStream: resolveMissing });
    const result = await contribution.write({
      streamId: "ghost",
      source: SOURCE,
      records: [record(), record()],
    });
    expect(result).toEqual({ accepted: 0, rejected: 2 });
    expect(pipeline.calls).toHaveLength(0);
  });
});

describe("logstream telemetry sink - assertBindable", () => {
  it("allows a caller with the global manage rule", async () => {
    const check = mock(async () => ({ hasAccess: false }));
    const contribution = makeSink({ auth: { check } });
    await contribution.assertBindable({
      streamId: "stream-1",
      user: { type: "user", id: "u1", accessRules: [MANAGE_ID] },
    });
    expect(check).not.toHaveBeenCalled();
  });

  it("allows a team-grant holder (auth.check true)", async () => {
    const contribution = makeSink({ auth: fakeAuth(true) });
    await contribution.assertBindable({
      streamId: "stream-1",
      user: { type: "user", id: "u1", accessRules: [] },
    });
  });

  it("allows a trusted service call", async () => {
    const contribution = makeSink({ auth: fakeAuth(false) });
    await contribution.assertBindable({
      streamId: "stream-1",
      user: { type: "service", pluginId: "automation" },
    });
  });

  it("denies a caller with neither a global rule nor a team grant", async () => {
    const contribution = makeSink({ auth: fakeAuth(false) });
    await expect(
      contribution.assertBindable({
        streamId: "stream-1",
        user: { type: "user", id: "u1", accessRules: [] },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws NOT_FOUND for a missing stream", async () => {
    const contribution = makeSink({ resolveStream: resolveMissing, auth: fakeAuth(true) });
    await expect(
      contribution.assertBindable({
        streamId: "ghost",
        user: { type: "user", id: "u1", accessRules: [] },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("logstream telemetry sink - describeStream", () => {
  it("returns { id, name } for a known stream, null for a missing one", async () => {
    expect(await makeSink().describeStream({ streamId: "stream-1" })).toEqual({
      id: "stream-1",
      name: "Payments logs",
    });
    expect(
      await makeSink({ resolveStream: resolveMissing }).describeStream({ streamId: "ghost" }),
    ).toBeNull();
  });
});

describe("logstream telemetry sink - describeStreams (batched)", () => {
  const resolveStreams: ResolveLogStreams = async (streamIds) => {
    const known: Record<string, string> = { s1: "App logs", s2: "Payments logs" };
    const out: Record<string, { id: string; name: string } | null> = {};
    for (const id of streamIds) {
      out[id] = known[id] ? { id, name: known[id]! } : null;
    }
    return out;
  };

  it("resolves mixed known/unknown ids, mapping unknowns to null", async () => {
    const contribution = makeSink({ resolveStreams });
    expect(contribution.describeStreams).toBeDefined();
    const result = await contribution.describeStreams!({
      streamIds: ["s1", "gone", "s2"],
    });
    expect(result).toEqual({
      s1: { id: "s1", name: "App logs" },
      gone: null,
      s2: { id: "s2", name: "Payments logs" },
    });
  });

  it("is undefined when no resolveStreams seam is supplied", () => {
    expect(makeSink().describeStreams).toBeUndefined();
  });
});

describe("logstream telemetry sink - listBindableStreams", () => {
  const allStreams = [
    { id: "s1", name: "App logs" },
    { id: "s2", name: "Payments logs" },
    { id: "s3", name: "Ops logs" },
  ];
  const listStreams: ListLogStreams = async () => allStreams;

  it("is undefined when no listStreams seam is supplied", () => {
    expect(makeSink().listBindableStreams).toBeUndefined();
  });

  it("returns every stream for a global-rule caller without a bulk filter", async () => {
    const listAccessibleObjectIds = mock(async () => [] as string[]);
    const contribution = makeSink({
      listStreams,
      auth: { check: async () => ({ hasAccess: false }), listAccessibleObjectIds },
    });
    const streams = await contribution.listBindableStreams!({
      user: { type: "user", id: "u1", accessRules: [MANAGE_ID] },
    });
    expect(streams).toEqual(allStreams);
    expect(listAccessibleObjectIds).not.toHaveBeenCalled();
  });

  it("returns every stream for a trusted service call", async () => {
    const contribution = makeSink({ listStreams });
    const streams = await contribution.listBindableStreams!({
      user: { type: "service", pluginId: "automation" },
    });
    expect(streams).toEqual(allStreams);
  });

  it("filters to the caller's manageable grants for a team-scoped caller", async () => {
    const contribution = makeSink({
      listStreams,
      auth: {
        check: async () => ({ hasAccess: false }),
        listAccessibleObjectIds: async () => ["s2"],
      },
    });
    const streams = await contribution.listBindableStreams!({
      user: { type: "user", id: "u1", accessRules: [] },
    });
    expect(streams).toEqual([{ id: "s2", name: "Payments logs" }]);
  });

  it("returns nothing for a caller with no grants", async () => {
    const contribution = makeSink({
      listStreams,
      auth: {
        check: async () => ({ hasAccess: false }),
        listAccessibleObjectIds: async () => [],
      },
    });
    const streams = await contribution.listBindableStreams!({
      user: { type: "user", id: "u1", accessRules: [] },
    });
    expect(streams).toEqual([]);
  });
});

describe("logstream telemetry sink - normalization parity with OTLP push", () => {
  it("produces the same IngestedLine the OTLP endpoint would for an equivalent record", async () => {
    const pipeline = fakePipeline();
    const config: LogStreamConfig = {
      ...DEFAULT_LOG_STREAM_CONFIG,
      maxLineBytes: 64,
      severityRules: { valueMap: { WARN: "error" } },
    };
    const contribution = makeSink({ pipeline, config });

    const rec: NormalizedLogRecord = {
      ts: new Date("2026-07-14T11:59:00.000Z"),
      severityNumber: 13,
      severityText: "WARN",
      body: "y".repeat(500),
      attributes: { "http.method": "GET" },
      resource: { serviceName: "api", attributes: { "host.name": "box" } },
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
    };

    await contribution.write({ streamId: "stream-1", source: SOURCE, now, records: [rec] });
    const sinkLine = pipeline.calls[0]!.lines[0]!;

    // The reference implementation: the OTLP endpoint's normalizer on the same
    // logical record (resource flattened, service.name folded, nanos ts).
    const { lines } = normalizeOtlpPayload({
      payload: [
        {
          resource: { "service.name": "api", "host.name": "box" },
          records: [
            {
              timeUnixNano: BigInt(rec.ts.getTime()) * 1_000_000n,
              observedTimeUnixNano: 0n,
              severityNumber: 13,
              severityText: "WARN",
              body: "y".repeat(500),
              attributes: { "http.method": "GET" },
              traceId: "0af7651916cd43dd8448eb211c80319c",
              spanId: "b7ad6b7169203331",
            },
          ],
        },
      ],
      config,
      now,
    });

    expect(sinkLine).toEqual(lines[0]!);
  });
});
