import { describe, it, expect, mock } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";
import type { SafeDatabase } from "@checkstack/backend-api";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  LogStreamConfigSchema,
  type SatelliteLogBatchItem,
  type SatelliteLogLine,
} from "@checkstack/logstream-common";
import * as schema from "../schema";
import type { IngestAuthenticator } from "./auth";
import type { StreamConfigResolver } from "./stream-config";
import type { IngestPipeline, IngestResult } from "./pipeline";
import { createLogstreamSatelliteCapabilityHandler } from "./satellite-handler";

const GOOD = "ckls_s1_secret";
const GOOD2 = "ckls_s2_secret";
const REVOKED = "ckls_s1_revoked";

/**
 * A minimal fake `db` that records the `addInTransitDrops` upserts the handler
 * issues (`insert(...).values(...).onConflictDoUpdate(...)`), so a unit test can
 * assert the in-transit drop bookkeeping without a real database.
 */
function recordingDb(): {
  db: SafeDatabase<typeof schema>;
  drops: Array<{ streamId: string; dropped: number }>;
} {
  const drops: Array<{ streamId: string; dropped: number }> = [];
  const db = {
    insert: () => ({
      values: (v: { streamId: string; droppedInTransitCount: number }) => {
        drops.push({ streamId: v.streamId, dropped: v.droppedInTransitCount });
        return { onConflictDoUpdate: async () => {} };
      },
    }),
    // The handler only ever calls `insert` for in-transit drops; a real
    // SafeDatabase has many more members, hence the cast (test-only stub).
  } as unknown as SafeDatabase<typeof schema>;
  return { db, drops };
}

/** A db stub for tests that don't exercise the in-transit drop path. */
function stubDb(): SafeDatabase<typeof schema> {
  return recordingDb().db;
}

function auth(): IngestAuthenticator {
  return {
    verify: async (token) => {
      if (token === GOOD) return { ok: true, streamId: "s1", tokenId: "t1" };
      if (token === GOOD2) return { ok: true, streamId: "s2", tokenId: "t2" };
      if (token === REVOKED) return { ok: false, reason: "revoked" };
      return { ok: false, reason: "unknown" };
    },
  };
}

function configResolver(
  config = DEFAULT_LOG_STREAM_CONFIG,
): StreamConfigResolver {
  return { resolve: async () => config };
}

const accepted = (n: number): IngestResult => ({
  accepted: n,
  rejectedRateLimit: 0,
  rejectedBuffer: 0,
  retryAfterSeconds: 0,
});

const saturated = (rateLimit = 0, buffer = 0): IngestResult => ({
  accepted: 0,
  rejectedRateLimit: rateLimit,
  rejectedBuffer: buffer,
  retryAfterSeconds: 1,
});

function pipelineReturning(...results: IngestResult[]): {
  pipeline: IngestPipeline;
  ingest: ReturnType<typeof mock>;
} {
  let call = 0;
  const ingest = mock(() => results[Math.min(call++, results.length - 1)]!);
  return {
    pipeline: {
      ingest,
      flushNow: async () => {},
      start: () => {},
      stop: () => {},
    } as unknown as IngestPipeline,
    ingest,
  };
}

const line = (over: Partial<SatelliteLogLine> = {}): SatelliteLogLine => ({
  ts: "2026-07-13T00:00:00.000Z",
  observedAt: "2026-07-13T00:00:00.000Z",
  severityNumber: 9,
  band: "info",
  body: "hello",
  ...over,
});

const item = (
  streamToken: string,
  lines: SatelliteLogLine[],
): SatelliteLogBatchItem => ({ streamToken, lines });

describe("logstream satellite capability handler", () => {
  it("verifies the token, feeds the pipeline sink, and reports accepted", async () => {
    const { pipeline, ingest } = pipelineReturning(accepted(2));
    const handler = createLogstreamSatelliteCapabilityHandler({
      db: stubDb(),
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      logger: createMockLogger(),
    });

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [line(), line({ body: "world" })])],
    });

    expect(outcome).toEqual({ accepted: 2, rejected: 0, retryable: false });
    expect(ingest).toHaveBeenCalledTimes(1);
    const call = ingest.mock.calls[0]![0] as Parameters<
      IngestPipeline["ingest"]
    >[0];
    expect(call.streamId).toBe("s1");
    expect(call.tokenId).toBe("t1");
    expect(call.lines).toHaveLength(2);
    // Timestamps were rehydrated to Dates before feeding the pipeline.
    expect(call.lines[0]!.ts).toBeInstanceOf(Date);
    expect(call.lines[0]!.observedAt).toBeInstanceOf(Date);
  });

  it("rejects lines authorized by a revoked token WITHOUT feeding the pipeline", async () => {
    const { pipeline, ingest } = pipelineReturning(accepted(0));
    const handler = createLogstreamSatelliteCapabilityHandler({
      db: stubDb(),
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      logger: createMockLogger(),
    });

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(REVOKED, [line(), line()])],
    });

    expect(outcome).toEqual({ accepted: 0, rejected: 2, retryable: false });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("treats an unknown token the same as revoked (drop + count)", async () => {
    const { pipeline, ingest } = pipelineReturning(accepted(0));
    const handler = createLogstreamSatelliteCapabilityHandler({
      db: stubDb(),
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      logger: createMockLogger(),
    });

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item("ckls_s1_bogus", [line()])],
    });

    expect(outcome).toEqual({ accepted: 0, rejected: 1, retryable: false });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("re-clamps a future satellite timestamp against the core clock", async () => {
    const { pipeline, ingest } = pipelineReturning(accepted(1));
    const coreNow = new Date("2026-07-13T12:00:00.000Z");
    const handler = createLogstreamSatelliteCapabilityHandler({
      db: stubDb(),
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      logger: createMockLogger(),
      now: () => coreNow,
    });

    // 1h in the future per the satellite -> clamped back to core now + 2min skew.
    await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [line({ ts: "2026-07-13T13:00:00.000Z" })])],
    });

    const call = ingest.mock.calls[0]![0] as Parameters<
      IngestPipeline["ingest"]
    >[0];
    const ts = call.lines[0]!.ts.getTime();
    expect(ts).toBeLessThanOrEqual(coreNow.getTime() + 2 * 60_000);
    expect(ts).toBeGreaterThan(coreNow.getTime());
  });

  it("re-applies the stream's severity valueMap using the retained severityText", async () => {
    const config = LogStreamConfigSchema.parse({
      severityRules: { valueMap: { WARNING: "error" } },
    });
    const { pipeline, ingest } = pipelineReturning(accepted(1));
    const handler = createLogstreamSatelliteCapabilityHandler({
      db: stubDb(),
      auth: auth(),
      configResolver: configResolver(config),
      pipeline,
      logger: createMockLogger(),
    });

    await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [
        item(GOOD, [line({ band: "warn", severityText: "WARNING" })]),
      ],
    });

    const call = ingest.mock.calls[0]![0] as Parameters<
      IngestPipeline["ingest"]
    >[0];
    expect(call.lines[0]!.band).toBe("error");
  });

  it("verifies each distinct token only once across items of the same batch", async () => {
    const verify = mock(async (token: string) =>
      token === GOOD
        ? ({ ok: true, streamId: "s1", tokenId: "t1" } as const)
        : ({ ok: false, reason: "unknown" } as const),
    );
    const { pipeline } = pipelineReturning(accepted(2));
    const handler = createLogstreamSatelliteCapabilityHandler({
      db: stubDb(),
      auth: { verify },
      configResolver: configResolver(),
      pipeline,
      logger: createMockLogger(),
    });

    await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [line()]), item(GOOD, [line()])],
    });

    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("is retryable when nothing was written and the only failure was saturation", async () => {
    const { pipeline } = pipelineReturning(saturated(3, 0));
    const handler = createLogstreamSatelliteCapabilityHandler({
      db: stubDb(),
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      logger: createMockLogger(),
    });

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [line(), line(), line()])],
    });

    expect(outcome).toEqual({ accepted: 0, rejected: 3, retryable: true });
  });

  it("stays terminal on a PARTIAL accept so a resend cannot double-write", async () => {
    // One stream accepts, another is fully buffer-shed -> some progress made,
    // so the whole batch must be terminal (retryable=false).
    const { pipeline } = pipelineReturning(accepted(1), saturated(0, 2));
    const handler = createLogstreamSatelliteCapabilityHandler({
      db: stubDb(),
      auth: {
        verify: async (token) =>
          token === "ckls_a"
            ? { ok: true, streamId: "s1", tokenId: "t1" }
            : { ok: true, streamId: "s2", tokenId: "t2" },
      },
      configResolver: configResolver(),
      pipeline,
      logger: createMockLogger(),
    });

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item("ckls_a", [line()]), item("ckls_b", [line(), line()])],
    });

    expect(outcome).toEqual({ accepted: 1, rejected: 2, retryable: false });
  });

  it("drops a malformed payload terminally", async () => {
    const { pipeline, ingest } = pipelineReturning(accepted(0));
    const handler = createLogstreamSatelliteCapabilityHandler({
      db: stubDb(),
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      logger: createMockLogger(),
    });

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: { not: "an array" },
    });

    expect(outcome).toEqual({ accepted: 0, rejected: 0, retryable: false });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("records a group's in-transit drops against its resolved stream", async () => {
    const { pipeline } = pipelineReturning(accepted(1));
    const { db, drops } = recordingDb();
    const handler = createLogstreamSatelliteCapabilityHandler({
      db,
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      logger: createMockLogger(),
    });

    await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [line()])],
      droppedByGroup: { [GOOD]: 4 },
    });

    // The GOOD token resolves to s1 -> that stream's row is incremented by 4.
    expect(drops).toEqual([{ streamId: "s1", dropped: 4 }]);
  });

  it("attributes each group's drops to ITS OWN stream, not spread across the batch", async () => {
    const { pipeline } = pipelineReturning(accepted(1));
    const { db, drops } = recordingDb();
    const handler = createLogstreamSatelliteCapabilityHandler({
      db,
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      logger: createMockLogger(),
    });

    // A batch spanning two streams with DIFFERENT per-group drop counts: each
    // stream must be charged its own count (3 and 7), never the sum on both.
    await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [line()]), item(GOOD2, [line()])],
      droppedByGroup: { [GOOD]: 3, [GOOD2]: 7 },
    });

    expect(drops).toContainEqual({ streamId: "s1", dropped: 3 });
    expect(drops).toContainEqual({ streamId: "s2", dropped: 7 });
    expect(drops).toHaveLength(2);
  });

  it("attributes a drop for a group NOT present in the payload (drop-only token)", async () => {
    const { pipeline } = pipelineReturning(accepted(1));
    const { db, drops } = recordingDb();
    const handler = createLogstreamSatelliteCapabilityHandler({
      db,
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      logger: createMockLogger(),
    });

    // GOOD2 lost lines in transit but has no items in THIS batch; it must still
    // be resolved and charged to its stream.
    await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [line()])],
      droppedByGroup: { [GOOD2]: 5 },
    });

    expect(drops).toEqual([{ streamId: "s2", dropped: 5 }]);
  });

  it("does not record in-transit drops when the count is absent or zero", async () => {
    const { pipeline } = pipelineReturning(accepted(1));
    const { db, drops } = recordingDb();
    const handler = createLogstreamSatelliteCapabilityHandler({
      db,
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      logger: createMockLogger(),
    });

    await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [line()])],
      droppedByGroup: { [GOOD]: 0 },
    });

    expect(drops).toEqual([]);
  });

  it("does not attribute a drop whose token is unresolvable (revoked/unknown)", async () => {
    const { pipeline } = pipelineReturning(accepted(0));
    const { db, drops } = recordingDb();
    const handler = createLogstreamSatelliteCapabilityHandler({
      db,
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      logger: createMockLogger(),
    });

    await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(REVOKED, [line()])],
      droppedByGroup: { [REVOKED]: 4 },
    });

    expect(drops).toEqual([]);
  });
});
