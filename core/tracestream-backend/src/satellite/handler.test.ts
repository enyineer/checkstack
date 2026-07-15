import { describe, it, expect, mock } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";
import type { IngestAuthenticator } from "@checkstack/ingest-utils";
import {
  DEFAULT_TRACE_STREAM_CONFIG,
  type SatelliteSpan,
  type SatelliteTraceBatchItem,
} from "@checkstack/tracestream-common";
import type { StreamConfigResolver } from "../ingest/stream-config";
import type { IngestPipeline, IngestResult } from "../ingest/pipeline";
import { createTracestreamSatelliteCapabilityHandler } from "./handler";

const GOOD = "cktr_s1_secret";
const GOOD2 = "cktr_s2_secret";
const REVOKED = "cktr_s1_revoked";

function auth(): IngestAuthenticator {
  return {
    verify: async (token) => {
      if (token === GOOD) return { ok: true, resourceId: "s1", tokenId: "t1" };
      if (token === GOOD2) return { ok: true, resourceId: "s2", tokenId: "t2" };
      if (token === REVOKED) return { ok: false, reason: "revoked" };
      return { ok: false, reason: "unknown" };
    },
  };
}

function configResolver(
  config = DEFAULT_TRACE_STREAM_CONFIG,
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

/** A capturing (optionally throwing) stub for the activity in-transit-drop port. */
function activityStub(
  impl: (a: { streamId: string; dropped: number }) => Promise<void> = async () => {},
): { addInTransitDrops: ReturnType<typeof mock> } {
  return { addInTransitDrops: mock(impl) };
}

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

const span = (over: Partial<SatelliteSpan> = {}): SatelliteSpan => ({
  traceId: "5b8aa5a2d2c872e8321cf37308d69df2",
  spanId: "051581bf3cb55c13",
  name: "op",
  kind: "server",
  startTs: "2026-07-13T00:00:00.000Z",
  endTs: "2026-07-13T00:00:00.010Z",
  ...over,
});

const item = (
  streamToken: string,
  spans: SatelliteSpan[],
): SatelliteTraceBatchItem => ({ streamToken, spans });

describe("tracestream satellite capability handler", () => {
  it("verifies the token, feeds the pipeline, and reports accepted", async () => {
    const { pipeline, ingest } = pipelineReturning(accepted(2));
    const seen: string[] = [];
    const handler = createTracestreamSatelliteCapabilityHandler({
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      activity: activityStub(),
      recordSeen: (tokenId) => seen.push(tokenId),
      logger: createMockLogger(),
    });

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [span(), span({ spanId: "051581bf3cb55c14" })])],
    });

    expect(outcome).toEqual({ accepted: 2, rejected: 0, retryable: false });
    expect(ingest).toHaveBeenCalledTimes(1);
    const call = ingest.mock.calls[0]![0] as Parameters<
      IngestPipeline["ingest"]
    >[0];
    expect(call.streamId).toBe("s1");
    expect(call.spans).toHaveLength(2);
    // Timestamps were rehydrated to Dates before feeding the pipeline.
    expect(call.spans[0]!.startTs).toBeInstanceOf(Date);
    expect(call.spans[0]!.endTs).toBeInstanceOf(Date);
    // The verified source instance was stamped last-seen once.
    expect(seen).toEqual(["t1"]);
  });

  it("passes the CORE clock as `now` so the pipeline re-clamps against it", async () => {
    const { pipeline, ingest } = pipelineReturning(accepted(1));
    const coreNow = new Date("2026-07-13T12:00:00.000Z");
    const handler = createTracestreamSatelliteCapabilityHandler({
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      activity: activityStub(),
      logger: createMockLogger(),
      now: () => coreNow,
    });

    // A span 1h in the future per the satellite. The handler does not clamp; it
    // hands the core clock to the pipeline, whose `prepareSpan` clamps it.
    await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [span({ startTs: "2026-07-13T13:00:00.000Z" })])],
    });

    const call = ingest.mock.calls[0]![0] as Parameters<
      IngestPipeline["ingest"]
    >[0];
    expect(call.now).toBe(coreNow);
  });

  it("rejects spans authorized by a revoked token WITHOUT feeding the pipeline", async () => {
    const { pipeline, ingest } = pipelineReturning(accepted(0));
    const seen: string[] = [];
    const handler = createTracestreamSatelliteCapabilityHandler({
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      activity: activityStub(),
      recordSeen: (tokenId) => seen.push(tokenId),
      logger: createMockLogger(),
    });

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(REVOKED, [span(), span()])],
    });

    expect(outcome).toEqual({ accepted: 0, rejected: 2, retryable: false });
    expect(ingest).not.toHaveBeenCalled();
    expect(seen).toEqual([]); // a revoked token is never stamped last-seen
  });

  it("treats an unknown token the same as revoked (drop + count)", async () => {
    const { pipeline, ingest } = pipelineReturning(accepted(0));
    const handler = createTracestreamSatelliteCapabilityHandler({
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      activity: activityStub(),
      logger: createMockLogger(),
    });

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item("cktr_s1_bogus", [span()])],
    });

    expect(outcome).toEqual({ accepted: 0, rejected: 1, retryable: false });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("verifies each distinct token only once across items of the same batch", async () => {
    const verify = mock(async (token: string) =>
      token === GOOD
        ? ({ ok: true, resourceId: "s1", tokenId: "t1" } as const)
        : ({ ok: false, reason: "unknown" } as const),
    );
    const { pipeline } = pipelineReturning(accepted(2));
    const handler = createTracestreamSatelliteCapabilityHandler({
      auth: { verify },
      configResolver: configResolver(),
      pipeline,
      activity: activityStub(),
      logger: createMockLogger(),
    });

    await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [span()]), item(GOOD, [span()])],
    });

    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("is retryable when nothing was written and the only failure was saturation", async () => {
    const { pipeline } = pipelineReturning(saturated(3, 0));
    const handler = createTracestreamSatelliteCapabilityHandler({
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      activity: activityStub(),
      logger: createMockLogger(),
    });

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [span(), span(), span()])],
    });

    expect(outcome).toEqual({ accepted: 0, rejected: 3, retryable: true });
  });

  it("stays terminal on a PARTIAL accept so a resend cannot double-write", async () => {
    // One stream accepts, another is fully buffer-shed -> some progress made, so
    // the whole batch must be terminal (retryable=false).
    const { pipeline } = pipelineReturning(accepted(1), saturated(0, 2));
    const handler = createTracestreamSatelliteCapabilityHandler({
      auth: {
        verify: async (token) =>
          token === "cktr_a"
            ? { ok: true, resourceId: "s1", tokenId: "t1" }
            : { ok: true, resourceId: "s2", tokenId: "t2" },
      },
      configResolver: configResolver(),
      pipeline,
      activity: activityStub(),
      logger: createMockLogger(),
    });

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item("cktr_a", [span()]), item("cktr_b", [span(), span()])],
    });

    expect(outcome).toEqual({ accepted: 1, rejected: 2, retryable: false });
  });

  it("drops a malformed payload terminally", async () => {
    const { pipeline, ingest } = pipelineReturning(accepted(0));
    const handler = createTracestreamSatelliteCapabilityHandler({
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      activity: activityStub(),
      logger: createMockLogger(),
    });

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: { not: "an array" },
    });

    expect(outcome).toEqual({ accepted: 0, rejected: 0, retryable: false });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("groups spans per resolved stream so each stream is fed once", async () => {
    const { pipeline, ingest } = pipelineReturning(accepted(1), accepted(2));
    const handler = createTracestreamSatelliteCapabilityHandler({
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      activity: activityStub(),
      logger: createMockLogger(),
    });

    await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [
        item(GOOD, [span()]),
        item(GOOD2, [span(), span()]),
        item(GOOD, [span()]),
      ],
    });

    // Two distinct streams -> two ingest calls even though GOOD appears twice.
    expect(ingest).toHaveBeenCalledTimes(2);
    const streamIds = ingest.mock.calls.map(
      (c) =>
        (c[0] as Parameters<IngestPipeline["ingest"]>[0]).streamId,
    );
    expect(new Set(streamIds)).toEqual(new Set(["s1", "s2"]));
  });

  it("records a group's in-transit drops durably against its resolved stream", async () => {
    const { pipeline } = pipelineReturning(accepted(1));
    const activity = activityStub();
    const handler = createTracestreamSatelliteCapabilityHandler({
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      activity,
      logger: createMockLogger(),
    });

    await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [span()])],
      droppedByGroup: { [GOOD]: 4 },
    });

    // The GOOD token resolves to s1 -> that stream's counter is incremented by 4.
    expect(activity.addInTransitDrops).toHaveBeenCalledTimes(1);
    expect(activity.addInTransitDrops.mock.calls[0]![0]).toEqual({
      streamId: "s1",
      dropped: 4,
    });
  });

  it("attributes each group's drops to ITS OWN stream, not spread across the batch", async () => {
    const { pipeline } = pipelineReturning(accepted(1));
    const activity = activityStub();
    const handler = createTracestreamSatelliteCapabilityHandler({
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      activity,
      logger: createMockLogger(),
    });

    await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [span()]), item(GOOD2, [span()])],
      droppedByGroup: { [GOOD]: 3, [GOOD2]: 7 },
    });

    const calls = activity.addInTransitDrops.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ streamId: "s1", dropped: 3 });
    expect(calls).toContainEqual({ streamId: "s2", dropped: 7 });
    expect(calls).toHaveLength(2);
  });

  it("attributes a drop for a group NOT present in the payload (drop-only token)", async () => {
    const { pipeline } = pipelineReturning(accepted(1));
    const activity = activityStub();
    const handler = createTracestreamSatelliteCapabilityHandler({
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      activity,
      logger: createMockLogger(),
    });

    // GOOD2 lost spans in transit but has no items in THIS batch; it must still
    // be resolved (via its token) and charged to its stream.
    await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [span()])],
      droppedByGroup: { [GOOD2]: 5 },
    });

    expect(activity.addInTransitDrops.mock.calls.map((c) => c[0])).toEqual([
      { streamId: "s2", dropped: 5 },
    ]);
  });

  it("keeps an accepted batch's ack when the durable drop write fails", async () => {
    // A storage hiccup while persisting the in-transit counter must NOT flip an
    // already-accepted batch's ack (best-effort bookkeeping, caught per stream).
    const { pipeline } = pipelineReturning(accepted(1));
    const activity = activityStub(async () => {
      throw new Error("activity table unavailable");
    });
    const handler = createTracestreamSatelliteCapabilityHandler({
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      activity,
      logger: createMockLogger(),
    });

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [span()])],
      droppedByGroup: { [GOOD]: 4 },
    });

    expect(activity.addInTransitDrops).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ accepted: 1, rejected: 0, retryable: false });
  });

  it("keeps an accepted batch's ack when verify throws during drop attribution", async () => {
    // The spans were ingested and accepted; a transient verify throw while
    // attributing droppedByGroup (a token-cache blip) must NOT flip the ack to
    // retryable, or the agent resends and double-charges an already-accepted batch.
    const { pipeline } = pipelineReturning(accepted(1));
    let call = 0;
    const verify = mock(async (token: string) => {
      call += 1;
      // First call (the payload item) resolves; the later drop-attribution call
      // throws to simulate a Redis hiccup on the shared token cache.
      if (call === 1) return { ok: true, resourceId: "s1", tokenId: "t1" } as const;
      throw new Error("token cache unavailable");
    });
    const handler = createTracestreamSatelliteCapabilityHandler({
      auth: { verify },
      configResolver: configResolver(),
      pipeline,
      activity: activityStub(),
      logger: createMockLogger(),
    });

    const outcome = await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [span()])],
      droppedByGroup: { [GOOD]: 4 },
    });

    // Terminal accept preserved despite the drop-attribution throw.
    expect(outcome).toEqual({ accepted: 1, rejected: 0, retryable: false });
  });

  it("does not record a drop for an unresolvable token or a zero count", async () => {
    const { pipeline } = pipelineReturning(accepted(1));
    const activity = activityStub();
    const handler = createTracestreamSatelliteCapabilityHandler({
      auth: auth(),
      configResolver: configResolver(),
      pipeline,
      activity,
      logger: createMockLogger(),
    });

    // REVOKED has no stream to charge; GOOD:0 is a non-positive count.
    await handler.handleTelemetryBatch!({
      satelliteId: "sat-1",
      payload: [item(GOOD, [span()])],
      droppedByGroup: { [REVOKED]: 4, [GOOD]: 0 },
    });

    expect(activity.addInTransitDrops).not.toHaveBeenCalled();
  });
});
