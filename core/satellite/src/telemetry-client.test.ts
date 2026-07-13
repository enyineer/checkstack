import { describe, it, expect, mock } from "bun:test";
import { TelemetryClient } from "./telemetry-client";
import type {
  TelemetryAckMessage,
  TelemetryBatchMessage,
} from "@checkstack/satellite-common";

const estimateBytes = (item: unknown): number =>
  JSON.stringify(item).length + 16;

/** Default loss-attribution key for the generic transport tests (single group). */
const groupKeyOf = () => "g";

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Collect the batches a TelemetryClient sends, and let the test ack them. */
function makeHarness(
  overrides: Partial<ConstructorParameters<typeof TelemetryClient>[0]> = {},
) {
  const sent: TelemetryBatchMessage[] = [];
  const client = new TelemetryClient({
    send: (msg) => sent.push(msg),
    logger: silentLogger,
    // Small caps so tests can hit the boundaries cheaply.
    maxInflight: 2,
    batchMaxItems: 3,
    batchMaxBytes: 1_000_000,
    bufferItemCap: 5,
    bufferByteCap: 1_000_000,
    ...overrides,
  });
  const ack = (batchId: string, over: Partial<TelemetryAckMessage> = {}) =>
    client.handleAck({
      type: "telemetry_ack",
      batchId,
      accepted: over.accepted ?? 0,
      rejected: over.rejected ?? 0,
      retryable: over.retryable ?? false,
    });
  return { client, sent, ack };
}

describe("TelemetryClient credit window + batching", () => {
  it("delivers a batch and stops holding it once acked", () => {
    const { client, sent, ack } = makeHarness();
    client.onConnected();
    client.enqueue({ kind: "logstream", items: [{ n: 1 }], estimateBytes, groupKeyOf });
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe("logstream");
    expect(sent[0].payload).toEqual([{ n: 1 }]);
    expect(client.inflightCount).toBe(1);

    ack(sent[0].batchId, { accepted: 1 });
    expect(client.inflightCount).toBe(0);
  });

  it("chunks to the item cap and caps concurrency at maxInflight", () => {
    const { client, sent } = makeHarness({ bufferItemCap: 100 });
    client.onConnected();
    // 9 items, batchMaxItems=3 -> up to 3 batches, but maxInflight=2 -> only 2
    // go out until acks free credit.
    client.enqueue({
      kind: "m",
      items: Array.from({ length: 9 }, (_, i) => ({ i })),
      estimateBytes,
      groupKeyOf,
    });
    expect(sent).toHaveLength(2);
    expect(client.inflightCount).toBe(2);
    expect(sent[0].payload).toHaveLength(3);
    expect(sent[1].payload).toHaveLength(3);
  });

  it("monotonic per-connection batchIds; reconnect rebuilds the sequence", () => {
    const { client, sent } = makeHarness();
    client.onConnected();
    client.enqueue({ kind: "m", items: [{ a: 1 }], estimateBytes, groupKeyOf });
    client.enqueue({ kind: "m", items: [{ a: 2 }], estimateBytes, groupKeyOf });
    expect(sent.map((b) => b.batchId)).toEqual(["0", "1"]);

    // Disconnect requeues both in-flight batches' items and resets the batchId
    // counter, so the next connection starts a fresh dedupe space at "0".
    client.onDisconnected();
    client.onConnected();
    expect(sent[2].batchId).toBe("0");
    expect(sent[2].payload).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe("TelemetryClient dedupe / resend / drop", () => {
  it("resends the same batchId on a retryable ack, after a backoff", async () => {
    const { client, sent, ack } = makeHarness({
      retryBackoffBaseMs: 5,
      retryBackoffMaxMs: 50,
    });
    client.onConnected();
    client.enqueue({ kind: "m", items: [{ a: 1 }], estimateBytes, groupKeyOf });
    const firstId = sent[0].batchId;
    expect(client.inflightCount).toBe(1);

    ack(firstId, { accepted: 0, rejected: 1, retryable: true });
    // NOT resent synchronously - the retryable ack only arms a backoff timer.
    expect(sent).toHaveLength(1);
    await wait(25);
    // After the backoff, resent under the SAME batchId (core dedupes).
    expect(sent).toHaveLength(2);
    expect(sent[1].batchId).toBe(firstId);
    expect(client.inflightCount).toBe(1);

    // A terminal ack finally resolves it.
    ack(firstId, { accepted: 1 });
    expect(client.inflightCount).toBe(0);
  });

  it("paces retryable resends with backoff instead of a synchronous burst", async () => {
    const { client, sent, ack } = makeHarness({
      retryBackoffBaseMs: 5,
      retryBackoffMaxMs: 100,
    });
    client.onConnected();
    client.enqueue({ kind: "m", items: [{ a: 1 }], estimateBytes, groupKeyOf });
    const id = sent[0].batchId;
    expect(sent).toHaveLength(1);

    // Four retryable acks arrive back-to-back (the core shedding load). NONE
    // triggers a synchronous resend - they only (re)arm the single backoff
    // timer - so there is no tight RTT-bound resend loop.
    for (let i = 0; i < 4; i++) ack(id, { retryable: true });
    expect(sent).toHaveLength(1);
    expect(client.inflightCount).toBe(1);

    // Once the (now exponentially grown) backoff elapses, exactly ONE paced
    // resend goes out.
    await wait(120);
    expect(sent).toHaveLength(2);
    expect(sent[1].batchId).toBe(id);

    ack(id, { accepted: 1 });
    expect(client.inflightCount).toBe(0);
  });

  it("drops a batch on a non-retryable ack WITHOUT re-counting the loss (core owns it)", () => {
    const { client, sent, ack } = makeHarness();
    client.onConnected();
    client.enqueue({ kind: "m", items: [{ a: 1 }, { a: 2 }], estimateBytes, groupKeyOf });
    const id = sent[0].batchId;
    // Core rejected both items terminally. That is a core-side outcome the core
    // attributes per stream itself - the agent must NOT fold it into its own
    // per-group drop map (which would double-count / misattribute it).
    ack(id, { accepted: 0, rejected: 2, retryable: false });
    expect(client.inflightCount).toBe(0);
    expect(client.droppedSince("m")).toBe(0);
    // The next batch of this kind carries no drop counts.
    client.enqueue({ kind: "m", items: [{ a: 3 }], estimateBytes, groupKeyOf });
    const next = sent[sent.length - 1];
    expect(next.droppedByGroup).toBeUndefined();
  });

  it("preserves a built batch's per-group drop counts across a disconnect requeue", () => {
    // bufferItemCap=3: 6 enqueued while disconnected drops the 3 oldest, so the
    // first built batch snapshots droppedByGroup={g:3} onto its envelope.
    const { client, sent } = makeHarness({ bufferItemCap: 3 });
    client.enqueue({
      kind: "m",
      items: Array.from({ length: 6 }, (_, i) => ({ i })),
      estimateBytes,
      groupKeyOf,
    });
    expect(client.droppedSince("m")).toBe(3);
    client.onConnected();
    expect(sent).toHaveLength(1);
    expect(sent[0].droppedByGroup).toEqual({ g: 3 });
    // The live map was cleared when the counts rode the batch.
    expect(client.droppedSince("m")).toBe(0);

    // Disconnect BEFORE the batch is acked: the unacked batch's snapshotted drop
    // counts must fold back into the live map (else they are lost).
    client.onDisconnected();
    expect(client.droppedSince("m")).toBe(3);

    // The next connection's rebuilt batch re-carries the per-group drop counts.
    client.onConnected();
    expect(sent[1].droppedByGroup).toEqual({ g: 3 });
  });

  it("attributes buffer-pressure drops to the group that lost items, per stream", () => {
    // bufferItemCap=5, NOT connected so nothing drains. Fill with two streams,
    // then overflow: the OLDEST items (stream a's) are evicted, so the loss is
    // charged to `a`, not spread across both streams.
    const { client, sent } = makeHarness();
    const keyByStream = (item: unknown) => (item as { s: string }).s;
    // 4 of stream "a" (oldest) then 4 of stream "b" -> 8 into a cap of 5, the 3
    // oldest (all stream a) are evicted.
    client.enqueue({
      kind: "m",
      items: [
        ...Array.from({ length: 4 }, () => ({ s: "a" })),
        ...Array.from({ length: 4 }, () => ({ s: "b" })),
      ],
      estimateBytes,
      groupKeyOf: keyByStream,
    });
    expect(client.droppedSince("m")).toBe(3);
    // The loss is attributed to stream "a" alone - NOT split across a and b.
    expect(client.droppedByGroup("m")).toEqual(new Map([["a", 3]]));
    // On connect, the surviving 5 flush; the first batch carries the per-group map.
    client.onConnected();
    expect(sent[0].droppedByGroup).toEqual({ a: 3 });
    expect(client.droppedSince("m")).toBe(0);
  });
});
