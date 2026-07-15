import { describe, it, expect } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";
import type { SafeDatabase } from "@checkstack/backend-api";
import type { IngestAuthenticator } from "@checkstack/ingest-utils";
import type { WireDatapoint } from "@checkstack/metricstream-common";
import type * as schema from "../schema";
import type { MetricIngestSink } from "../sources/ingest-sink";
import { createMetricstreamForwardHandler } from "./forward-capability";

const NOW = new Date("2026-06-01T12:00:00.000Z");

/** A wire datapoint (ISO `ts`, as it arrives over the channel). */
function dp(name: string, value: number): WireDatapoint {
  return { name, type: "gauge", labels: {}, value, ts: NOW.toISOString() };
}

/** A no-op db stub; the drop-persistence path is not exercised in unit tests. */
const stubDb = {
  insert: () => ({
    values: () => ({ onConflictDoUpdate: async () => {} }),
  }),
} as unknown as SafeDatabase<typeof schema>;

/** A sink that records ingest calls and accepts everything handed to it. */
function recordingSink() {
  const calls: { streamId: string; count: number; firstTs: unknown }[] = [];
  const sink: MetricIngestSink = {
    ingest: ({ streamId, datapoints }) => {
      calls.push({ streamId, count: datapoints.length, firstTs: datapoints[0]?.ts });
      return { accepted: datapoints.length, rejected: 0 };
    },
  };
  return { sink, calls };
}

/** An authenticator that resolves a single known token to a stream. */
function fakeAuth(
  map: Record<string, { streamId: string } | "revoked">,
): IngestAuthenticator {
  return {
    verify: async (token) => {
      const entry = map[token];
      if (!entry) return { ok: false, reason: "unknown" };
      if (entry === "revoked") return { ok: false, reason: "revoked" };
      return { ok: true, resourceId: entry.streamId, tokenId: `${token}-id` };
    },
  };
}

function build(sink: MetricIngestSink, auth: IngestAuthenticator) {
  return createMetricstreamForwardHandler({
    db: stubDb,
    sink,
    auth,
    logger: createMockLogger(),
    now: () => NOW,
  });
}

describe("metricstream forward capability handler", () => {
  it("verifies each group's token and feeds the sink, coercing ts to a Date", async () => {
    const { sink, calls } = recordingSink();
    const handler = build(sink, fakeAuth({ ckms_good: { streamId: "stream-1" } }));

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-a",
      payload: [{ streamToken: "ckms_good", datapoints: [dp("cpu", 1), dp("cpu", 2)] }],
    });

    expect(outcome).toEqual({ accepted: 2, rejected: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.streamId).toBe("stream-1");
    expect(calls[0]!.count).toBe(2);
    // Wire ts (ISO string) is converted to a Date before the sink.
    expect(calls[0]!.firstTs).toBeInstanceOf(Date);
    expect((calls[0]!.firstTs as Date).toISOString()).toBe(NOW.toISOString());
  });

  it("routes multiple token groups to their own streams", async () => {
    const { sink, calls } = recordingSink();
    const handler = build(
      sink,
      fakeAuth({ ckms_a: { streamId: "stream-a" }, ckms_b: { streamId: "stream-b" } }),
    );

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-a",
      payload: [
        { streamToken: "ckms_a", datapoints: [dp("cpu", 1)] },
        { streamToken: "ckms_b", datapoints: [dp("cpu", 2), dp("cpu", 3)] },
      ],
    });

    expect(outcome).toEqual({ accepted: 3, rejected: 0 });
    expect(calls.map((c) => `${c.streamId}:${c.count}`).toSorted()).toEqual([
      "stream-a:1",
      "stream-b:2",
    ]);
  });

  it("rejects an unknown-token group terminally while accepting a valid one", async () => {
    const { sink, calls } = recordingSink();
    const handler = build(sink, fakeAuth({ ckms_good: { streamId: "stream-1" } }));

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-a",
      payload: [
        { streamToken: "ckms_nope", datapoints: [dp("cpu", 9)] },
        { streamToken: "ckms_good", datapoints: [dp("cpu", 1)] },
      ],
    });

    expect(outcome).toEqual({ accepted: 1, rejected: 1 });
    expect(calls).toEqual([{ streamId: "stream-1", count: 1, firstTs: expect.any(Date) }]);
  });

  it("rejects a revoked token terminally", async () => {
    const { sink, calls } = recordingSink();
    const handler = build(sink, fakeAuth({ ckms_dead: "revoked" }));

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-a",
      payload: [{ streamToken: "ckms_dead", datapoints: [dp("cpu", 1), dp("cpu", 2)] }],
    });

    expect(outcome).toEqual({ accepted: 0, rejected: 2 });
    expect(calls).toEqual([]);
  });

  it("stamps recordPushSeen once per VERIFIED group (never for a rejected one)", async () => {
    const { sink } = recordingSink();
    const seen: string[] = [];
    const handler = createMetricstreamForwardHandler({
      db: stubDb,
      sink,
      auth: fakeAuth({ ckms_good: { streamId: "stream-1" } }),
      recordPushSeen: (tokenId) => seen.push(tokenId),
      logger: createMockLogger(),
      now: () => NOW,
    });

    await handler.handleTelemetryBatch!({
      satelliteId: "sat-a",
      payload: [
        { streamToken: "ckms_good", datapoints: [dp("cpu", 1)] },
        { streamToken: "ckms_nope", datapoints: [dp("cpu", 2)] },
      ],
    });

    // Only the verified group stamps, keyed on the source id (fakeAuth's tokenId).
    expect(seen).toEqual(["ckms_good-id"]);
  });

  it("drops a malformed payload non-retryably without touching the sink", async () => {
    const { sink, calls } = recordingSink();
    const handler = build(sink, fakeAuth({ ckms_good: { streamId: "stream-1" } }));

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-a",
      payload: { nonsense: true },
    });

    expect(outcome).toEqual({ accepted: 0, rejected: 0, retryable: false });
    expect(calls).toEqual([]);
  });
});
