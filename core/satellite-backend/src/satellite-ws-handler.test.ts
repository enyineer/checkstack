import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  SatelliteWsHandler,
  type SatelliteResultHandler,
  type SatelliteScriptPackageSink,
} from "./satellite-ws-handler";
import { createMockLogger } from "@checkstack/test-utils-backend";
import type { SatelliteService } from "./service";
import type { ConfigRelay } from "./config-relay";
import type { SatelliteWithStatus } from "@checkstack/satellite-common";

const MOCK_SATELLITE: SatelliteWithStatus = {
  id: "sat-1",
  name: "EU West",
  region: "eu-west-1",
  tags: {},
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
  });
});
