import { describe, it, expect, mock } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";
import { SatelliteWsHandler } from "./satellite-ws-handler";
import {
  SatelliteCapabilityRegistryImpl,
  type SatelliteCapabilityHandler,
} from "./capability-registry";
import type { SatelliteService } from "./service";
import type { ConfigRelay } from "./config-relay";
import type { SatelliteResultHandler } from "./satellite-ws-handler";
import type {
  SatelliteWithStatus,
  TelemetryBatchMessage,
  TelemetryAckMessage,
} from "@checkstack/satellite-common";
// The REAL agent-side telemetry client + capability registry, wired against the
// REAL core WS handler over an in-memory relay (no sockets). This proves the
// full loop end to end; unit specs cover each half in isolation.
import { TelemetryClient } from "@checkstack/satellite/src/telemetry-client";
import { AgentCapabilityRegistry } from "@checkstack/satellite/src/capability-config-registry";

const MOCK_SATELLITE: SatelliteWithStatus = {
  id: "sat-1",
  name: "EU West",
  region: "eu-west-1",
  tags: {},
  capabilities: [],
  status: "online",
  createdAt: new Date(),
};

const estimateBytes = (item: unknown): number =>
  JSON.stringify(item).length + 16;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Build an in-memory loopback: the REAL core WS handler + a stub capability
 * handler on one side, the REAL agent TelemetryClient + AgentCapabilityRegistry
 * on the other, connected by relaying JSON both ways. `deliver()` drains all
 * queued agent->core batches (and the acks they provoke) to a fixed point.
 */
function makeLoopback(
  handlerDef: Partial<SatelliteCapabilityHandler> & { kind: string },
  clientOpts: Partial<ConstructorParameters<typeof TelemetryClient>[0]> = {},
) {
  const logger = createMockLogger();

  const service = {
    validateToken: mock(async () => MOCK_SATELLITE),
    updateHeartbeat: mock(async () => {}),
    updateCapabilities: mock(async () => {}),
  } as unknown as SatelliteService;

  const configRelay = {
    getAssignmentsForSatellite: mock(async () => []),
  } as unknown as ConfigRelay;

  const resultHandler: SatelliteResultHandler = {
    handleResult: mock(async () => {}),
  };

  const coreRegistry = new SatelliteCapabilityRegistryImpl();
  coreRegistry.registerCapability(handlerDef, {
    pluginId: "test",
  } as unknown as Parameters<typeof coreRegistry.registerCapability>[1]);

  const coreHandler = new SatelliteWsHandler(
    service,
    configRelay,
    resultHandler,
    logger,
    undefined,
    undefined,
    undefined,
    undefined,
    coreRegistry,
  );

  // Agent side.
  const receivedConfigs: unknown[] = [];
  const agentCapReg = new AgentCapabilityRegistry({
    sendStatus: () => {},
    logger,
  });
  agentCapReg.register({
    kind: handlerDef.kind,
    onCapabilityConfig: ({ payload }) => {
      receivedConfigs.push(payload);
    },
  });

  const pending: TelemetryBatchMessage[] = [];
  const sentBatches: TelemetryBatchMessage[] = [];
  const acks: TelemetryAckMessage[] = [];
  const telemetryClient = new TelemetryClient({
    send: (msg) => {
      pending.push(msg);
      sentBatches.push(msg);
    },
    logger,
    maxInflight: 2,
    batchMaxItems: 3,
    bufferItemCap: 5,
    ...clientOpts,
  });

  // Route core -> agent messages.
  const coreToAgent = (raw: string) => {
    const msg = JSON.parse(raw) as { type: string } & Record<string, unknown>;
    switch (msg.type) {
      case "authenticated":
        telemetryClient.onConnected();
        break;
      case "telemetry_ack":
        acks.push(msg as unknown as TelemetryAckMessage);
        telemetryClient.handleAck(msg as unknown as TelemetryAckMessage);
        break;
      case "capability_config":
        agentCapReg.handleCapabilityConfig({
          kind: msg.kind as string,
          payload: msg.payload,
        });
        break;
      default:
        break;
    }
  };

  const fakeWs = { send: (raw: string) => coreToAgent(raw), close: () => {} };
  const { onMessage } = coreHandler.onConnection(fakeWs);

  async function authenticate(capabilities: string[] = ["telemetry"]) {
    await onMessage(
      JSON.stringify({
        type: "authenticate",
        clientId: "sat-1",
        token: "csat_valid-token",
        capabilities,
      }),
    );
  }

  /** Drain every queued agent->core batch and the acks they provoke. */
  async function deliver() {
    let guard = 0;
    while (pending.length > 0) {
      if (guard++ > 1000) throw new Error("deliver did not converge");
      const msg = pending.shift() as TelemetryBatchMessage;
      await onMessage(JSON.stringify(msg));
    }
  }

  return {
    service,
    telemetryClient,
    coreHandler,
    coreRegistry,
    receivedConfigs,
    pending,
    sentBatches,
    acks,
    onMessage,
    authenticate,
    deliver,
  };
}

describe("satellite telemetry loopback (agent client <-> core WS handler)", () => {
  it("advertises capabilities and pushes capability_config to the agent consumer", async () => {
    const lb = makeLoopback({
      kind: "metric-scrape",
      buildCapabilityConfig: mock(async () => ({ targets: ["t1"] })),
    });
    await lb.authenticate(["telemetry", "scrape"]);
    expect(lb.service.updateCapabilities).toHaveBeenCalledWith("sat-1", [
      "telemetry",
      "scrape",
    ]);
    expect(lb.receivedConfigs).toEqual([{ targets: ["t1"] }]);
  });

  it("delivers a batch end to end and acks it", async () => {
    const received: unknown[][] = [];
    const lb = makeLoopback({
      kind: "logstream",
      handleTelemetryBatch: mock(async ({ payload }) => {
        received.push(payload as unknown[]);
        return { accepted: (payload as unknown[]).length, rejected: 0 };
      }),
    });
    await lb.authenticate();
    lb.telemetryClient.enqueue({
      kind: "logstream",
      items: [{ line: "a" }, { line: "b" }],
      estimateBytes,
      groupKeyOf: () => "g",
    });
    await lb.deliver();
    expect(received).toEqual([[{ line: "a" }, { line: "b" }]]);
    expect(lb.telemetryClient.inflightCount).toBe(0);
    expect(lb.acks.at(-1)).toMatchObject({ accepted: 2, retryable: false });
  });

  it("caps in-flight batches at the credit window before acks return", async () => {
    const lb = makeLoopback(
      {
        kind: "logstream",
        handleTelemetryBatch: mock(async () => ({ accepted: 3, rejected: 0 })),
      },
      { bufferItemCap: 100 },
    );
    await lb.authenticate();
    // 9 items, batchMaxItems=3, maxInflight=2 -> only 2 batches sent until acked.
    lb.telemetryClient.enqueue({
      kind: "logstream",
      items: Array.from({ length: 9 }, (_, i) => ({ i })),
      estimateBytes,
      groupKeyOf: () => "g",
    });
    expect(lb.telemetryClient.inflightCount).toBe(2);
    expect(lb.pending).toHaveLength(2);
    await lb.deliver();
    expect(lb.telemetryClient.inflightCount).toBe(0);
  });

  it("dedupes a resent batchId on the core (handler runs once, re-acks same counts)", async () => {
    const handle = mock(async ({ payload }: { payload: unknown }) => ({
      accepted: (payload as unknown[]).length,
      rejected: 0,
    }));
    const lb = makeLoopback({ kind: "logstream", handleTelemetryBatch: handle });
    await lb.authenticate();
    lb.telemetryClient.enqueue({
      kind: "logstream",
      items: [{ line: "a" }],
      estimateBytes,
      groupKeyOf: () => "g",
    });
    // Grab the batch the agent produced and feed the SAME frame to the core
    // twice, directly (simulating a resend that races an in-flight ack).
    const batch = lb.pending[0];
    const raw = JSON.stringify(batch);
    await lb.onMessage(raw);
    await lb.onMessage(raw);
    expect(handle).toHaveBeenCalledTimes(1);
    // Two acks, both carrying the remembered counts.
    const batchAcks = lb.acks.filter((a) => a.batchId === batch.batchId);
    expect(batchAcks).toHaveLength(2);
    expect(batchAcks[0]).toMatchObject({ accepted: 1, retryable: false });
    expect(batchAcks[1]).toMatchObject({ accepted: 1, retryable: false });
  });

  it("paces a retryable-ack resend on a backoff, then resolves on a terminal ack", async () => {
    let call = 0;
    const handle = mock(async () => {
      call += 1;
      return call === 1
        ? { accepted: 0, rejected: 1, retryable: true }
        : { accepted: 1, rejected: 0, retryable: false };
    });
    const lb = makeLoopback(
      { kind: "logstream", handleTelemetryBatch: handle },
      // Small backoff so the paced resend lands quickly in the test.
      { retryBackoffBaseMs: 5, retryBackoffMaxMs: 50 },
    );
    await lb.authenticate();
    lb.telemetryClient.enqueue({
      kind: "logstream",
      items: [{ line: "a" }],
      estimateBytes,
      groupKeyOf: () => "g",
    });

    // First delivery: the core returns a retryable ack. The agent no longer
    // resends synchronously - it arms a backoff timer - so after this fixed
    // point the handler has run exactly once, the batch is still in flight, and
    // nothing is queued to send yet.
    await lb.deliver();
    expect(handle).toHaveBeenCalledTimes(1);
    expect(lb.telemetryClient.inflightCount).toBe(1);
    expect(lb.pending).toHaveLength(0);

    // Once the backoff elapses the paced resend is queued; deliver it and the
    // core resolves it terminally.
    await wait(25);
    expect(lb.pending).toHaveLength(1);
    await lb.deliver();
    expect(handle).toHaveBeenCalledTimes(2);
    expect(lb.telemetryClient.inflightCount).toBe(0);
  });

  it("does NOT re-count a core non-retryable rejection as a satellite drop", async () => {
    const lb = makeLoopback({
      kind: "logstream",
      handleTelemetryBatch: mock(async ({ payload }) => ({
        accepted: 0,
        rejected: (payload as unknown[]).length,
        retryable: false,
      })),
    });
    await lb.authenticate();
    lb.telemetryClient.enqueue({
      kind: "logstream",
      items: [{ a: 1 }, { a: 2 }],
      estimateBytes,
      groupKeyOf: () => "g",
    });
    await lb.deliver();
    // Core-side rejection is the core's to attribute per stream; the agent must
    // not fold it into its own per-group drop map.
    expect(lb.telemetryClient.droppedSince("logstream")).toBe(0);
    // The next batch carries no drop counts.
    lb.telemetryClient.enqueue({
      kind: "logstream",
      items: [{ a: 3 }],
      estimateBytes,
      groupKeyOf: () => "g",
    });
    expect(lb.sentBatches.at(-1)?.droppedByGroup).toBeUndefined();
  });

  it("drops oldest under buffer load and reports droppedByGroup to core", async () => {
    const lb = makeLoopback({
      kind: "logstream",
      handleTelemetryBatch: mock(async ({ payload }) => ({
        accepted: (payload as unknown[]).length,
        rejected: 0,
      })),
    });
    await lb.authenticate();
    // Burst of 20 into a buffer capped at 5 -> 15 evicted at push time, before
    // any drain; the first outgoing batch carries droppedByGroup={g:15}.
    lb.telemetryClient.enqueue({
      kind: "logstream",
      items: Array.from({ length: 20 }, (_, i) => ({ i })),
      estimateBytes,
      groupKeyOf: () => "g",
    });
    expect(lb.sentBatches[0]?.droppedByGroup).toEqual({ g: 15 });
    await lb.deliver();
    expect(lb.telemetryClient.droppedSince("logstream")).toBe(0);
  });
});
