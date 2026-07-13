import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  SatelliteWsHandler,
  type SatelliteResultHandler,
  type SatelliteScriptPackageSink,
} from "./satellite-ws-handler";
import {
  SatelliteCapabilityRegistryImpl,
  type SatelliteCapabilityHandler,
} from "./capability-registry";
import { createMockLogger } from "@checkstack/test-utils-backend";
import type { SatelliteService } from "./service";
import type { ConfigRelay } from "./config-relay";
import type { SatelliteConnectionEvent } from "./entity";
import type { SatelliteWithStatus } from "@checkstack/satellite-common";

const MOCK_SATELLITE: SatelliteWithStatus = {
  id: "sat-1",
  name: "EU West",
  region: "eu-west-1",
  tags: {},
  capabilities: [],
  status: "online",
  createdAt: new Date(),
};

const MOCK_ASSIGNMENTS = [
  {
    configId: "config-1",
    systemId: "system-1",
    strategyId: "http",
    config: { url: "https://example.com" },
    intervalSeconds: 60,
  },
];

function createMockService(
  validSatellite?: SatelliteWithStatus,
): SatelliteService {
  return {
    validateToken: mock(async (props: { clientId: string; token: string }) => {
      if (
        validSatellite &&
        props.clientId === validSatellite.id &&
        props.token === "csat_valid-token"
      ) {
        return validSatellite;
      }
      return undefined;
    }),
    updateHeartbeat: mock(async () => {}),
    updateCapabilities: mock(async () => {}),
  } as unknown as SatelliteService;
}

function createMockConfigRelay(): ConfigRelay {
  return {
    getAssignmentsForSatellite: mock(async () => MOCK_ASSIGNMENTS),
  } as unknown as ConfigRelay;
}

function createMockResultHandler(): SatelliteResultHandler {
  return {
    handleResult: mock(async () => {}),
  };
}

function createMockWs() {
  const messages: string[] = [];
  return {
    send: mock((data: string) => messages.push(data)),
    close: mock(() => {}),
    messages,
  };
}

describe("SatelliteWsHandler", () => {
  let handler: SatelliteWsHandler;
  let service: ReturnType<typeof createMockService>;
  let configRelay: ReturnType<typeof createMockConfigRelay>;
  let resultHandler: SatelliteResultHandler;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    service = createMockService(MOCK_SATELLITE);
    configRelay = createMockConfigRelay();
    resultHandler = createMockResultHandler();
    logger = createMockLogger();
    handler = new SatelliteWsHandler(
      service,
      configRelay,
      resultHandler,
      logger,
    );
  });

  describe("authentication", () => {
    it("should authenticate with valid clientId and token", async () => {
      const ws = createMockWs();
      const { onMessage } = handler.onConnection(ws);

      await onMessage(
        JSON.stringify({
          type: "authenticate",
          clientId: "sat-1",
          token: "csat_valid-token",
        }),
      );

      expect(ws.close).not.toHaveBeenCalled();
      expect(ws.messages).toHaveLength(1);

      const response = JSON.parse(ws.messages[0]);
      expect(response.type).toBe("authenticated");
      expect(response.satelliteId).toBe("sat-1");
      expect(response.assignments).toEqual(MOCK_ASSIGNMENTS);
    });

    it("should reject invalid credentials", async () => {
      const ws = createMockWs();
      const { onMessage } = handler.onConnection(ws);

      await onMessage(
        JSON.stringify({
          type: "authenticate",
          clientId: "sat-1",
          token: "csat_invalid-token",
        }),
      );

      expect(ws.close).toHaveBeenCalled();
      expect(ws.messages).toHaveLength(1);
      const response = JSON.parse(ws.messages[0]);
      expect(response.type).toBe("auth_failed");
    });

    it("should reject non-authenticate messages before auth", async () => {
      const ws = createMockWs();
      const { onMessage } = handler.onConnection(ws);

      await onMessage(
        JSON.stringify({
          type: "heartbeat",
          version: "1.0.0",
          uptimeSeconds: 60,
        }),
      );

      expect(ws.close).toHaveBeenCalled();
      const response = JSON.parse(ws.messages[0]);
      expect(response.type).toBe("auth_failed");
      expect(response.reason).toBe("Must authenticate first");
    });
  });

  describe("post-authentication", () => {
    async function authenticateWs() {
      const ws = createMockWs();
      const { onMessage, onClose } = handler.onConnection(ws);
      await onMessage(
        JSON.stringify({
          type: "authenticate",
          clientId: "sat-1",
          token: "csat_valid-token",
        }),
      );
      // Clear the authenticated message from history
      ws.messages.length = 0;
      return { ws, onMessage, onClose };
    }

    it("should handle heartbeat messages", async () => {
      const { onMessage } = await authenticateWs();

      await onMessage(
        JSON.stringify({
          type: "heartbeat",
          version: "1.2.3",
          uptimeSeconds: 120,
        }),
      );

      expect(service.updateHeartbeat).toHaveBeenCalledWith("sat-1", {
        version: "1.2.3",
      });
    });

    it("should handle result messages", async () => {
      const { onMessage } = await authenticateWs();

      const resultMsg = {
        type: "result",
        configId: "config-1",
        systemId: "system-1",
        status: "healthy",
        latencyMs: 42,
        result: {
          status: "healthy",
          latencyMs: 42,
          metadata: {
            connected: true,
            connectionTimeMs: 40,
          },
        },
        executedAt: new Date().toISOString(),
      };

      await onMessage(JSON.stringify(resultMsg));

      expect(resultHandler.handleResult).toHaveBeenCalledWith({
        satelliteId: "sat-1",
        sourceLabel: "EU West (eu-west-1)",
        result: expect.objectContaining({
          type: "result",
          configId: "config-1",
          systemId: "system-1",
          status: "healthy",
        }),
      });
    });

    it("should reject a result for an unassigned configId/systemId", async () => {
      const { onMessage } = await authenticateWs();

      // config-1/system-1 is the ONLY assignment (MOCK_ASSIGNMENTS). A result
      // for a different config/system must be dropped (authorization gap fix).
      await onMessage(
        JSON.stringify({
          type: "result",
          configId: "config-999",
          systemId: "system-999",
          status: "healthy",
          executedAt: new Date().toISOString(),
        }),
      );

      expect(resultHandler.handleResult).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should reject a result that claims an assigned config but a foreign system", async () => {
      const { onMessage } = await authenticateWs();

      // configId is assigned, but paired with a system the satellite is NOT
      // assigned to: the pair must match, not just the config.
      await onMessage(
        JSON.stringify({
          type: "result",
          configId: "config-1",
          systemId: "system-999",
          status: "down",
          executedAt: new Date().toISOString(),
        }),
      );

      expect(resultHandler.handleResult).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should ingest a result for an assigned configId/systemId pair", async () => {
      const { onMessage } = await authenticateWs();

      await onMessage(
        JSON.stringify({
          type: "result",
          configId: "config-1",
          systemId: "system-1",
          status: "healthy",
          executedAt: new Date().toISOString(),
        }),
      );

      expect(resultHandler.handleResult).toHaveBeenCalledTimes(1);
    });

    it("refreshes the result-authorization cache when assignments change via pushConfigUpdate", async () => {
      const { onMessage } = await authenticateWs();

      // Reassign the satellite: it loses config-1/system-1 and gains
      // config-2/system-2. The push must update what it may report for.
      (
        configRelay.getAssignmentsForSatellite as ReturnType<typeof mock>
      ).mockImplementation(async () => [
        {
          configId: "config-2",
          systemId: "system-2",
          strategyId: "http",
          config: { url: "https://example.com" },
          intervalSeconds: 60,
        },
      ]);
      await handler.pushConfigUpdate("sat-1");

      // The OLD assignment is now unauthorized...
      await onMessage(
        JSON.stringify({
          type: "result",
          configId: "config-1",
          systemId: "system-1",
          status: "healthy",
          executedAt: new Date().toISOString(),
        }),
      );
      expect(resultHandler.handleResult).not.toHaveBeenCalled();

      // ...and the NEW assignment is authorized.
      await onMessage(
        JSON.stringify({
          type: "result",
          configId: "config-2",
          systemId: "system-2",
          status: "healthy",
          executedAt: new Date().toISOString(),
        }),
      );
      expect(resultHandler.handleResult).toHaveBeenCalledTimes(1);
    });

    it("should log strategy errors", async () => {
      const { onMessage } = await authenticateWs();

      await onMessage(
        JSON.stringify({
          type: "strategy_error",
          strategyId: "grpc",
          message: "Strategy not available",
        }),
      );

      expect(logger.warn).toHaveBeenCalled();
    });

    it("should clean up connection on close", async () => {
      const { onClose } = await authenticateWs();
      onClose();

      expect(handler.getConnectedSatelliteIds()).not.toContain("sat-1");
    });
  });

  describe("pushConfigUpdate", () => {
    it("should send config update to connected satellites", async () => {
      const ws = createMockWs();
      const { onMessage } = handler.onConnection(ws);

      // Authenticate
      await onMessage(
        JSON.stringify({
          type: "authenticate",
          clientId: "sat-1",
          token: "csat_valid-token",
        }),
      );
      ws.messages.length = 0;

      // Push config update
      await handler.pushConfigUpdate("sat-1");

      expect(ws.messages).toHaveLength(1);
      const update = JSON.parse(ws.messages[0]);
      expect(update.type).toBe("config_updated");
      expect(update.assignments).toEqual(MOCK_ASSIGNMENTS);
    });

    it("should silently skip disconnected satellites", async () => {
      // No satellite connected — should not throw
      await handler.pushConfigUpdate("non-existent");
    });
  });

  describe("script-package distribution", () => {
    function makeSink(
      lockfileHash: string | null,
    ): {
      sink: SatelliteScriptPackageSink;
      reports: Parameters<SatelliteScriptPackageSink["reportSyncState"]>[0][];
    } {
      const reports: Parameters<
        SatelliteScriptPackageSink["reportSyncState"]
      >[0][] = [];
      return {
        reports,
        sink: {
          getDesiredLockfileHash: mock(async () => lockfileHash),
          reportSyncState: mock(async (input) => {
            reports.push(input);
          }),
          getManifest: mock(async () => [
            { name: "leftpad", version: "0.0.1", integrity: "sha-1" },
          ]),
          getBlobBase64: mock(async () => "YmxvYg=="),
        },
      };
    }

    async function authedHandlerWithSink(lockfileHash: string | null) {
      const { sink, reports } = makeSink(lockfileHash);
      const h = new SatelliteWsHandler(
        service,
        configRelay,
        resultHandler,
        logger,
        undefined,
        sink,
      );
      const ws = createMockWs();
      const { onMessage } = h.onConnection(ws);
      await onMessage(
        JSON.stringify({
          type: "authenticate",
          clientId: "sat-1",
          token: "csat_valid-token",
        }),
      );
      return { h, ws, onMessage, reports };
    }

    it("carries the desired lockfile hash in the authenticated payload", async () => {
      const { ws } = await authedHandlerWithSink("hash-123");
      const auth = JSON.parse(ws.messages[0]);
      expect(auth.type).toBe("authenticated");
      expect(auth.scriptPackagesLockfileHash).toBe("hash-123");
    });

    it("omits the hash entirely when no sink is wired (version-skew safe)", async () => {
      // Default `handler` has no script-package sink.
      const ws = createMockWs();
      const { onMessage } = handler.onConnection(ws);
      await onMessage(
        JSON.stringify({
          type: "authenticate",
          clientId: "sat-1",
          token: "csat_valid-token",
        }),
      );
      const auth = JSON.parse(ws.messages[0]);
      expect("scriptPackagesLockfileHash" in auth).toBe(false);
    });

    it("fans refresh_script_packages out to every connected satellite", async () => {
      const { h, ws } = await authedHandlerWithSink("hash-123");
      ws.messages.length = 0;

      h.pushRefreshScriptPackagesToAll("hash-456");

      expect(ws.messages).toHaveLength(1);
      const msg = JSON.parse(ws.messages[0]);
      expect(msg.type).toBe("refresh_script_packages");
      expect(msg.lockfileHash).toBe("hash-456");
    });

    it("persists a satellite's reported sync state", async () => {
      const { onMessage, reports } = await authedHandlerWithSink("hash-123");
      await onMessage(
        JSON.stringify({
          type: "script_package_sync_state",
          lockfileHash: "hash-123",
          status: "ready",
        }),
      );
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        satelliteId: "sat-1",
        lockfileHash: "hash-123",
        status: "ready",
      });
    });

    it("answers a manifest request over the WS channel", async () => {
      const { ws, onMessage } = await authedHandlerWithSink("hash-123");
      ws.messages.length = 0;
      await onMessage(
        JSON.stringify({
          type: "request_script_package_manifest",
          lockfileHash: "hash-123",
        }),
      );
      const reply = JSON.parse(ws.messages[0]);
      expect(reply.type).toBe("script_package_manifest");
      expect(reply.entries[0].name).toBe("leftpad");
    });

    it("answers a blob request over the WS channel", async () => {
      const { ws, onMessage } = await authedHandlerWithSink("hash-123");
      ws.messages.length = 0;
      await onMessage(
        JSON.stringify({
          type: "request_script_package_blob",
          integrity: "sha-1",
        }),
      );
      const reply = JSON.parse(ws.messages[0]);
      expect(reply.type).toBe("script_package_blob");
      expect(reply.data).toBe("YmxvYg==");
    });
  });

  describe("connection-state entity mirror", () => {
    function makeEntitySink() {
      const mirrors: Array<{
        satelliteId: string;
        lastEvent: SatelliteConnectionEvent;
        lastHeartbeatAt: Date | null;
      }> = [];
      return {
        sink: {
          mirror: mock(
            async (input: {
              satelliteId: string;
              lastEvent: SatelliteConnectionEvent;
              lastHeartbeatAt: Date | null;
            }) => {
              mirrors.push(input);
            },
          ),
        },
        mirrors,
      };
    }

    it("drives the connected edge with lastHeartbeatAt=now on successful authentication", async () => {
      const { sink, mirrors } = makeEntitySink();
      const h = new SatelliteWsHandler(
        service,
        configRelay,
        resultHandler,
        logger,
        sink,
      );
      const ws = createMockWs();
      const { onMessage } = h.onConnection(ws);
      await onMessage(
        JSON.stringify({
          type: "authenticate",
          clientId: "sat-1",
          token: "csat_valid-token",
        }),
      );

      expect(mirrors).toHaveLength(1);
      expect(mirrors[0]!.satelliteId).toBe("sat-1");
      expect(mirrors[0]!.lastEvent).toBe("connected");
      // lastHeartbeatAt = now (non-null) so the computed status reads online.
      expect(mirrors[0]!.lastHeartbeatAt).toBeInstanceOf(Date);
    });

    it("does NOT also call updateHeartbeat on connect when a sink is wired (the mirror writes the heartbeat)", async () => {
      const { sink } = makeEntitySink();
      const h = new SatelliteWsHandler(
        service,
        configRelay,
        resultHandler,
        logger,
        sink,
      );
      const ws = createMockWs();
      const { onMessage } = h.onConnection(ws);
      await onMessage(
        JSON.stringify({
          type: "authenticate",
          clientId: "sat-1",
          token: "csat_valid-token",
        }),
      );
      // The connect-time heartbeat is written by the mirror's apply, not by a
      // separate updateHeartbeat call.
      expect(service.updateHeartbeat).not.toHaveBeenCalled();
    });

    it("writes the connect heartbeat directly when NO sink is wired", async () => {
      // The default `handler` has no sink: it must still record the heartbeat.
      const ws = createMockWs();
      const { onMessage } = handler.onConnection(ws);
      await onMessage(
        JSON.stringify({
          type: "authenticate",
          clientId: "sat-1",
          token: "csat_valid-token",
        }),
      );
      expect(service.updateHeartbeat).toHaveBeenCalledWith("sat-1", {});
    });

    it("drives the disconnected edge with lastHeartbeatAt=null (immediate offline) when the socket closes", async () => {
      const { sink, mirrors } = makeEntitySink();
      const h = new SatelliteWsHandler(
        service,
        configRelay,
        resultHandler,
        logger,
        sink,
      );
      const ws = createMockWs();
      const { onMessage, onClose } = h.onConnection(ws);
      await onMessage(
        JSON.stringify({
          type: "authenticate",
          clientId: "sat-1",
          token: "csat_valid-token",
        }),
      );
      onClose?.();
      // onClose fires the mirror fire-and-forget; flush the microtask queue.
      await Promise.resolve();
      await Promise.resolve();

      const disconnected = mirrors.find((m) => m.lastEvent === "disconnected");
      expect(disconnected).toBeDefined();
      // Clearing lastHeartbeatAt makes the computed status flip offline at once.
      expect(disconnected!.lastHeartbeatAt).toBeNull();
      expect(disconnected!.satelliteId).toBe("sat-1");
    });

    it("does not mirror on a failed authentication", async () => {
      const { sink, mirrors } = makeEntitySink();
      const h = new SatelliteWsHandler(
        service,
        configRelay,
        resultHandler,
        logger,
        sink,
      );
      const ws = createMockWs();
      const { onMessage } = h.onConnection(ws);
      await onMessage(
        JSON.stringify({
          type: "authenticate",
          clientId: "sat-1",
          token: "csat_invalid-token",
        }),
      );
      expect(mirrors).toHaveLength(0);
    });
  });

  describe("global sandbox-policy relay", () => {
    const POLICY = {
      enabled: true,
      onUnavailable: "degrade" as const,
      resources: { cpuSeconds: 33 },
      filesystem: { mode: "scratch-plus-ro" as const },
      network: {
        mode: "deny" as const,
        allow: [] as string[],
        denyLinkLocalAndMetadata: true,
      },
      privilege: { mode: "drop-to-uid" as const },
    };

    function makeSandboxSink() {
      return {
        sink: {
          getCurrentPolicy: mock(async () => POLICY),
        },
      };
    }

    async function authedHandlerWithSandboxSink() {
      const { sink } = makeSandboxSink();
      const h = new SatelliteWsHandler(
        service,
        configRelay,
        resultHandler,
        logger,
        undefined,
        undefined,
        undefined,
        sink,
      );
      const ws = createMockWs();
      const { onMessage } = h.onConnection(ws);
      await onMessage(
        JSON.stringify({
          type: "authenticate",
          clientId: "sat-1",
          token: "csat_valid-token",
        }),
      );
      return { h, ws };
    }

    it("carries the resolved policy in the authenticated payload", async () => {
      const { ws } = await authedHandlerWithSandboxSink();
      const auth = JSON.parse(ws.messages[0]);
      expect(auth.type).toBe("authenticated");
      expect(auth.sandboxPolicy.network.mode).toBe("deny");
      expect(auth.sandboxPolicy.resources.cpuSeconds).toBe(33);
    });

    it("omits sandboxPolicy entirely when no sink is wired (version-skew safe)", async () => {
      const ws = createMockWs();
      const { onMessage } = handler.onConnection(ws);
      await onMessage(
        JSON.stringify({
          type: "authenticate",
          clientId: "sat-1",
          token: "csat_valid-token",
        }),
      );
      const auth = JSON.parse(ws.messages[0]);
      expect("sandboxPolicy" in auth).toBe(false);
    });

    it("pushes sandbox_policy to every connected satellite on change", async () => {
      const { h, ws } = await authedHandlerWithSandboxSink();
      ws.messages.length = 0;

      h.pushSandboxPolicyToAll({
        ...POLICY,
        network: { mode: "allowlist", allow: ["10.0.0.1"], denyLinkLocalAndMetadata: true },
      });

      expect(ws.messages).toHaveLength(1);
      const msg = JSON.parse(ws.messages[0]);
      expect(msg.type).toBe("sandbox_policy");
      expect(msg.policy.network.mode).toBe("allowlist");
      expect(msg.policy.network.allow).toEqual(["10.0.0.1"]);
    });
  });

  describe("telemetry + capability routing", () => {
    async function authedWithRouter(
      handlerDef: Partial<SatelliteCapabilityHandler> & { kind: string },
    ) {
      const registry = new SatelliteCapabilityRegistryImpl();
      registry.registerCapability(handlerDef, {
        pluginId: "test",
      } as unknown as Parameters<typeof registry.registerCapability>[1]);
      const h = new SatelliteWsHandler(
        service,
        configRelay,
        resultHandler,
        logger,
        undefined,
        undefined,
        undefined,
        undefined,
        registry,
      );
      const ws = createMockWs();
      const { onMessage } = h.onConnection(ws);
      await onMessage(
        JSON.stringify({
          type: "authenticate",
          clientId: "sat-1",
          token: "csat_valid-token",
          capabilities: ["telemetry"],
        }),
      );
      return { h, ws, onMessage, registry };
    }

    function lastMessageOfType(ws: ReturnType<typeof createMockWs>, type: string) {
      const found = [...ws.messages]
        .reverse()
        .map((m) => JSON.parse(m))
        .find((m) => m.type === type);
      return found;
    }

    it("persists advertised capabilities on authenticate", async () => {
      await authedWithRouter({ kind: "telemetry" });
      expect(service.updateCapabilities).toHaveBeenCalledWith("sat-1", [
        "telemetry",
      ]);
    });

    it("routes a telemetry_batch to its handler and acks the handler's counts", async () => {
      const handleTelemetryBatch = mock(async () => ({
        accepted: 4,
        rejected: 1,
      }));
      const { ws, onMessage } = await authedWithRouter({
        kind: "logstream",
        handleTelemetryBatch,
      });
      ws.messages.length = 0;
      await onMessage(
        JSON.stringify({
          type: "telemetry_batch",
          batchId: "0",
          kind: "logstream",
          payload: [{ line: "a" }],
        }),
      );
      expect(handleTelemetryBatch).toHaveBeenCalledTimes(1);
      const ack = lastMessageOfType(ws, "telemetry_ack");
      expect(ack).toMatchObject({
        batchId: "0",
        accepted: 4,
        rejected: 1,
        retryable: false,
      });
    });

    it("dedupes a resent batchId: re-acks the same counts, handler runs once", async () => {
      const handleTelemetryBatch = mock(async () => ({
        accepted: 2,
        rejected: 0,
      }));
      const { ws, onMessage } = await authedWithRouter({
        kind: "logstream",
        handleTelemetryBatch,
      });
      const send = () =>
        onMessage(
          JSON.stringify({
            type: "telemetry_batch",
            batchId: "7",
            kind: "logstream",
            payload: [{ line: "a" }],
          }),
        );
      await send();
      await send();
      expect(handleTelemetryBatch).toHaveBeenCalledTimes(1);
      const acks = ws.messages
        .map((m) => JSON.parse(m))
        .filter((m) => m.type === "telemetry_ack");
      expect(acks).toHaveLength(2);
      expect(acks[0]).toMatchObject({ batchId: "7", accepted: 2 });
      expect(acks[1]).toMatchObject({ batchId: "7", accepted: 2 });
    });

    it("drops a resend that RACES an in-flight batch: handler runs once, one ack", async () => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((r) => {
        release = () => r();
      });
      const handleTelemetryBatch = mock(async () => {
        await gate;
        return { accepted: 3, rejected: 0 };
      });
      const { ws, onMessage } = await authedWithRouter({
        kind: "logstream",
        handleTelemetryBatch,
      });
      ws.messages.length = 0;
      const batch = {
        type: "telemetry_batch",
        batchId: "9",
        kind: "logstream",
        payload: [{ line: "a" }],
      };
      // Start the first batch (suspends inside the handler on `gate`), then send
      // a resend of the SAME batchId while it is still in flight.
      const first = onMessage(JSON.stringify(batch));
      await onMessage(JSON.stringify(batch));
      release?.();
      await first;
      expect(handleTelemetryBatch).toHaveBeenCalledTimes(1);
      const acks = ws.messages
        .map((m) => JSON.parse(m))
        .filter((m) => m.type === "telemetry_ack");
      expect(acks).toHaveLength(1);
      expect(acks[0]).toMatchObject({ batchId: "9", accepted: 3, retryable: false });
    });

    it("re-processes a retryable batch on resend (transient outcome not remembered)", async () => {
      let call = 0;
      const handleTelemetryBatch = mock(async () => {
        call += 1;
        return call === 1
          ? { accepted: 0, rejected: 0, retryable: true }
          : { accepted: 2, rejected: 0 };
      });
      const { ws, onMessage } = await authedWithRouter({
        kind: "logstream",
        handleTelemetryBatch,
      });
      ws.messages.length = 0;
      const batch = {
        type: "telemetry_batch",
        batchId: "11",
        kind: "logstream",
        payload: [{ line: "a" }],
      };
      await onMessage(JSON.stringify(batch));
      await onMessage(JSON.stringify(batch));
      expect(handleTelemetryBatch).toHaveBeenCalledTimes(2);
      const acks = ws.messages
        .map((m) => JSON.parse(m))
        .filter((m) => m.type === "telemetry_ack");
      expect(acks[0]).toMatchObject({ batchId: "11", retryable: true });
      expect(acks[1]).toMatchObject({ batchId: "11", accepted: 2, retryable: false });
    });

    it("acks a non-retryable drop when no handler is registered for the kind", async () => {
      const { ws, onMessage } = await authedWithRouter({ kind: "logstream" });
      ws.messages.length = 0;
      await onMessage(
        JSON.stringify({
          type: "telemetry_batch",
          batchId: "1",
          kind: "unknown-kind",
          payload: [],
        }),
      );
      const ack = lastMessageOfType(ws, "telemetry_ack");
      expect(ack).toMatchObject({ batchId: "1", retryable: false });
    });

    it("acks retryable when the handler throws (transient failure)", async () => {
      const { ws, onMessage } = await authedWithRouter({
        kind: "logstream",
        handleTelemetryBatch: mock(async () => {
          throw new Error("sink down");
        }),
      });
      ws.messages.length = 0;
      await onMessage(
        JSON.stringify({
          type: "telemetry_batch",
          batchId: "2",
          kind: "logstream",
          payload: [],
        }),
      );
      const ack = lastMessageOfType(ws, "telemetry_ack");
      expect(ack).toMatchObject({ batchId: "2", retryable: true });
    });

    it("routes a capability_status to its handler (no ack)", async () => {
      const handleCapabilityStatus = mock(async () => {});
      const { ws, onMessage } = await authedWithRouter({
        kind: "metric-scrape",
        handleCapabilityStatus,
      });
      ws.messages.length = 0;
      await onMessage(
        JSON.stringify({
          type: "capability_status",
          kind: "metric-scrape",
          payload: { targetId: "t1" },
        }),
      );
      expect(handleCapabilityStatus).toHaveBeenCalledWith({
        satelliteId: "sat-1",
        payload: { targetId: "t1" },
      });
      expect(lastMessageOfType(ws, "telemetry_ack")).toBeUndefined();
    });

    it("pushes capability_config right after authenticated", async () => {
      const { ws } = await authedWithRouter({
        kind: "metric-scrape",
        buildCapabilityConfig: mock(async () => ({ targets: ["t1"] })),
      });
      const cfg = lastMessageOfType(ws, "capability_config");
      expect(cfg).toMatchObject({
        kind: "metric-scrape",
        payload: { targets: ["t1"] },
      });
    });

    it("re-pushes capability_config via pushCapabilityConfig", async () => {
      const build = mock(async () => ({ targets: ["t2"] }));
      const { h, ws } = await authedWithRouter({
        kind: "metric-scrape",
        buildCapabilityConfig: build,
      });
      ws.messages.length = 0;
      await h.pushCapabilityConfig({ kind: "metric-scrape", satelliteId: "sat-1" });
      const cfg = lastMessageOfType(ws, "capability_config");
      expect(cfg).toMatchObject({ kind: "metric-scrape", payload: { targets: ["t2"] } });
    });

    it("routes a capability_secret_request to resolveSecret and replies with its payload", async () => {
      const resolveSecret = mock(async () => ({
        payload: { bearerToken: "tok-123" },
      }));
      const { ws, onMessage } = await authedWithRouter({
        kind: "metric-scrape",
        resolveSecret,
      });
      ws.messages.length = 0;
      await onMessage(
        JSON.stringify({
          type: "capability_secret_request",
          requestId: "r1",
          kind: "metric-scrape",
          payload: { targetId: "t1" },
        }),
      );
      expect(resolveSecret).toHaveBeenCalledWith({
        satelliteId: "sat-1",
        payload: { targetId: "t1" },
      });
      const reply = lastMessageOfType(ws, "capability_secret_response");
      expect(reply).toMatchObject({
        requestId: "r1",
        payload: { bearerToken: "tok-123" },
      });
      expect(reply.error).toBeUndefined();
    });

    it("replies with the resolver's error (e.g. binding mismatch) and no payload", async () => {
      const { ws, onMessage } = await authedWithRouter({
        kind: "metric-scrape",
        resolveSecret: mock(async () => ({ error: "not bound to this satellite" })),
      });
      ws.messages.length = 0;
      await onMessage(
        JSON.stringify({
          type: "capability_secret_request",
          requestId: "r2",
          kind: "metric-scrape",
          payload: { targetId: "other" },
        }),
      );
      const reply = lastMessageOfType(ws, "capability_secret_response");
      expect(reply).toMatchObject({ requestId: "r2", error: "not bound to this satellite" });
      expect(reply.payload).toBeUndefined();
    });

    it("errors a capability_secret_request when the kind has no resolveSecret", async () => {
      const { ws, onMessage } = await authedWithRouter({ kind: "metric-scrape" });
      ws.messages.length = 0;
      await onMessage(
        JSON.stringify({
          type: "capability_secret_request",
          requestId: "r3",
          kind: "metric-scrape",
          payload: { targetId: "t1" },
        }),
      );
      const reply = lastMessageOfType(ws, "capability_secret_response");
      expect(reply).toMatchObject({ requestId: "r3" });
      expect(reply.error).toContain("No secret resolver");
      expect(reply.payload).toBeUndefined();
    });

    it("replies with an error when resolveSecret throws (never leaks the throw)", async () => {
      const { ws, onMessage } = await authedWithRouter({
        kind: "metric-scrape",
        resolveSecret: mock(async () => {
          throw new Error("resolver exploded");
        }),
      });
      ws.messages.length = 0;
      await onMessage(
        JSON.stringify({
          type: "capability_secret_request",
          requestId: "r4",
          kind: "metric-scrape",
          payload: { targetId: "t1" },
        }),
      );
      const reply = lastMessageOfType(ws, "capability_secret_response");
      expect(reply).toMatchObject({ requestId: "r4" });
      expect(reply.error).toContain("resolver exploded");
    });
  });
});
