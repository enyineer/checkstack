import { describe, it, expect, mock } from "bun:test";
import { ORPCError } from "@orpc/server";
import { qualifyAccessRuleId } from "@checkstack/common";
import { createMockLogger } from "@checkstack/test-utils-backend";
import type { AuthService } from "@checkstack/backend-api";
import {
  metricstreamAccess,
  pluginMetadata,
  normalizeOtlpMetrics,
  type NormalizedDatapoint,
} from "@checkstack/metricstream-common";
import type { NormalizedMetricPoint } from "@checkstack/telemetry-common";
import {
  createMetricstreamTelemetrySink,
  type ListMetricStreams,
  type ResolveMetricStream,
  type ResolveMetricStreams,
} from "./telemetry-sink";
import type { MetricIngestSink } from "./sources/extension-point";

const MANAGE_ID = qualifyAccessRuleId(
  pluginMetadata,
  metricstreamAccess.manage,
);
const SOURCE = { sourceId: "src-1", sourceTypeId: "prometheus.remote" };

type SinkAuth = Pick<AuthService, "check"> &
  Partial<Pick<AuthService, "listAccessibleObjectIds">>;

/** Auth stub whose `check` returns a fixed verdict. */
function fakeAuth(hasAccess: boolean): Pick<AuthService, "check"> {
  return { check: async () => ({ hasAccess }) };
}

/** A sink that records the datapoints handed to it and echoes accept/reject. */
function fakeSink(): MetricIngestSink & {
  calls: { streamId: string; datapoints: NormalizedDatapoint[] }[];
} {
  const calls: { streamId: string; datapoints: NormalizedDatapoint[] }[] = [];
  return {
    calls,
    ingest({ streamId, datapoints }) {
      calls.push({ streamId, datapoints });
      return { accepted: datapoints.length, rejected: 0 };
    },
  };
}

const resolveKnown: ResolveMetricStream = async (streamId) => ({
  id: streamId,
  name: "Payments metrics",
});
const resolveMissing: ResolveMetricStream = async () => null;

function makeSink({
  resolveStream = resolveKnown,
  resolveStreams,
  listStreams,
  sink = fakeSink(),
  auth = fakeAuth(false),
}: {
  resolveStream?: ResolveMetricStream;
  resolveStreams?: ResolveMetricStreams;
  listStreams?: ListMetricStreams;
  sink?: MetricIngestSink;
  auth?: SinkAuth;
} = {}) {
  return createMetricstreamTelemetrySink({
    resolveStream,
    ...(resolveStreams ? { resolveStreams } : {}),
    ...(listStreams ? { listStreams } : {}),
    sink,
    // Default the bulk grant filter to "no team grants" so tests that never
    // exercise the picker still satisfy the widened auth type.
    auth: { listAccessibleObjectIds: async () => [], ...auth },
    logger: createMockLogger(),
  });
}

const ts = new Date("2026-07-14T12:00:00.000Z");

function point(overrides: Partial<NormalizedMetricPoint> = {}): NormalizedMetricPoint {
  return {
    name: "http_requests",
    type: "counter",
    counterKind: "cumulative",
    labels: { route: "/pay" },
    value: 42,
    ts,
    ...overrides,
  };
}

describe("metricstream telemetry sink - write mapping", () => {
  it("folds resource serviceName + allowlisted attrs into labels, point wins on clash", async () => {
    const sink = fakeSink();
    const contribution = makeSink({ sink });

    const result = await contribution.write({
      streamId: "stream-1",
      source: SOURCE,
      records: [
        point({
          labels: { route: "/pay", "service.namespace": "point-wins" },
          resource: {
            serviceName: "payments",
            attributes: {
              "service.namespace": "prod",
              "service.instance.id": "i-1",
              // NOT allowlisted - must be dropped from labels.
              "host.name": "box-9",
            },
          },
        }),
      ],
    });

    expect(result).toEqual({ accepted: 1, rejected: 0 });
    const [call] = sink.calls;
    expect(call?.streamId).toBe("stream-1");
    const dp = call!.datapoints[0]!;
    expect(dp.labels).toEqual({
      "service.name": "payments",
      // point label overrides the folded resource label on clash
      "service.namespace": "point-wins",
      "service.instance.id": "i-1",
      route: "/pay",
    });
    expect(dp.labels["host.name"]).toBeUndefined();
  });

  it("preserves type, counterKind, unit and passes ts through untouched", async () => {
    const sink = fakeSink();
    const contribution = makeSink({ sink });

    await contribution.write({
      streamId: "stream-1",
      source: SOURCE,
      records: [
        point({ name: "cpu", type: "gauge", counterKind: undefined, unit: "s", value: 1.5 }),
        point({ name: "reqs", type: "counter", counterKind: "delta", value: 7 }),
      ],
    });

    const dps = sink.calls[0]!.datapoints;
    expect(dps[0]).toMatchObject({ name: "cpu", type: "gauge", unit: "s", value: 1.5, ts });
    expect(dps[0]!.counterKind).toBeUndefined();
    expect(dps[1]).toMatchObject({ name: "reqs", type: "counter", counterKind: "delta", ts });
  });

  it("maps the sink result to { accepted, rejected }", async () => {
    const sink: MetricIngestSink = {
      ingest: () => ({ accepted: 3, rejected: 2 }),
    };
    const contribution = makeSink({ sink });
    const result = await contribution.write({
      streamId: "stream-1",
      source: SOURCE,
      records: [point(), point(), point(), point(), point()],
    });
    expect(result).toEqual({ accepted: 3, rejected: 2 });
  });

  it("defaults now to a valid Date when the caller omits it (regression)", async () => {
    // A source path may call write without `now`; the sink must still hand the
    // shared ingest a real receive time so ts clamping works (not undefined).
    let seenNow: unknown = "unset";
    const sink: MetricIngestSink = {
      ingest: ({ now, datapoints }) => {
        seenNow = now;
        return { accepted: datapoints.length, rejected: 0 };
      },
    };
    const contribution = makeSink({ sink });
    const before = Date.now();
    await contribution.write({
      streamId: "stream-1",
      source: SOURCE,
      records: [point()],
    });
    expect(seenNow).toBeInstanceOf(Date);
    expect((seenNow as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("rejects all records for a nonexistent stream without calling the sink", async () => {
    const sink = fakeSink();
    const contribution = makeSink({ sink, resolveStream: resolveMissing });
    const result = await contribution.write({
      streamId: "ghost",
      source: SOURCE,
      records: [point(), point()],
    });
    expect(result).toEqual({ accepted: 0, rejected: 2 });
    expect(sink.calls).toHaveLength(0);
  });
});

describe("metricstream telemetry sink - assertBindable", () => {
  it("allows a caller with the global manage rule", async () => {
    const check = mock(async () => ({ hasAccess: false }));
    const contribution = makeSink({ auth: { check } });
    await contribution.assertBindable({
      streamId: "stream-1",
      user: { type: "user", id: "u1", accessRules: [MANAGE_ID] },
    });
    // Global rule short-circuits before any team-grant check.
    expect(check).not.toHaveBeenCalled();
  });

  it("allows the wildcard rule", async () => {
    const contribution = makeSink();
    await contribution.assertBindable({
      streamId: "stream-1",
      user: { type: "user", id: "u1", accessRules: ["*"] },
    });
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

  it("throws NOT_FOUND for a missing stream (before authorizing)", async () => {
    const check = mock(async () => ({ hasAccess: true }));
    const contribution = makeSink({ resolveStream: resolveMissing, auth: { check } });
    await expect(
      contribution.assertBindable({
        streamId: "ghost",
        user: { type: "user", id: "u1", accessRules: [] },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(check).not.toHaveBeenCalled();
  });
});

describe("metricstream telemetry sink - describeStream", () => {
  it("returns { id, name } for a known stream", async () => {
    const contribution = makeSink();
    expect(await contribution.describeStream({ streamId: "stream-1" })).toEqual({
      id: "stream-1",
      name: "Payments metrics",
    });
  });
  it("returns null for a missing stream", async () => {
    const contribution = makeSink({ resolveStream: resolveMissing });
    expect(await contribution.describeStream({ streamId: "ghost" })).toBeNull();
  });
});

describe("metricstream telemetry sink - describeStreams (batched)", () => {
  const resolveStreams: ResolveMetricStreams = async (streamIds) => {
    const known: Record<string, string> = {
      s1: "Payments metrics",
      s2: "Checkout metrics",
    };
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
      s1: { id: "s1", name: "Payments metrics" },
      gone: null,
      s2: { id: "s2", name: "Checkout metrics" },
    });
  });

  it("is undefined when no resolveStreams seam is supplied", () => {
    expect(makeSink().describeStreams).toBeUndefined();
  });
});

describe("metricstream telemetry sink - listBindableStreams", () => {
  const allStreams = [
    { id: "s1", name: "Payments metrics" },
    { id: "s2", name: "Checkout metrics" },
    { id: "s3", name: "Ops metrics" },
  ];
  const listStreams: ListMetricStreams = async () => allStreams;

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
    expect(streams).toEqual([{ id: "s2", name: "Checkout metrics" }]);
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

  it("skips the bulk filter when there are no streams at all", async () => {
    const listAccessibleObjectIds = mock(async () => [] as string[]);
    const contribution = makeSink({
      listStreams: async () => [],
      auth: { check: async () => ({ hasAccess: false }), listAccessibleObjectIds },
    });
    const streams = await contribution.listBindableStreams!({
      user: { type: "user", id: "u1", accessRules: [] },
    });
    expect(streams).toEqual([]);
    expect(listAccessibleObjectIds).not.toHaveBeenCalled();
  });
});

describe("metricstream telemetry sink - normalization parity with OTLP push", () => {
  it("folds resource labels identically to the OTLP metrics normalizer", async () => {
    const sink = fakeSink();
    const contribution = makeSink({ sink });

    const record: NormalizedMetricPoint = {
      name: "http_requests",
      type: "gauge",
      labels: { route: "/pay", method: "GET" },
      value: 3,
      ts,
      resource: {
        serviceName: "payments",
        attributes: {
          "service.namespace": "prod",
          "service.instance.id": "i-1",
          "host.name": "box-9",
        },
      },
    };

    await contribution.write({ streamId: "stream-1", source: SOURCE, records: [record] });
    const sinkLabels = sink.calls[0]!.datapoints[0]!.labels;

    // The equivalent OTLP payload: same resource attrs (with service.name), same
    // point attrs. The OTLP normalizer is the reference implementation.
    const { datapoints } = normalizeOtlpMetrics({
      payload: [
        {
          resource: {
            "service.name": "payments",
            "service.namespace": "prod",
            "service.instance.id": "i-1",
            "host.name": "box-9",
          },
          metrics: [
            {
              name: "http_requests",
              data: {
                kind: "gauge",
                points: [
                  {
                    attributes: { route: "/pay", method: "GET" },
                    timeUnixNano: BigInt(ts.getTime()) * 1_000_000n,
                    value: 3,
                  },
                ],
              },
            },
          ],
        },
      ],
      now: ts,
    });

    expect(sinkLabels).toEqual(datapoints[0]!.labels);
  });
});
