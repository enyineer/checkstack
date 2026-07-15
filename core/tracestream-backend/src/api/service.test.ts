import { describe, it, expect, mock } from "bun:test";
import type { Logger, RpcClient } from "@checkstack/backend-api";
import type { TelemetrySourceLifecycle } from "@checkstack/telemetry-backend";
import { createTracestreamService } from "./service";
import type { Storage } from "../storage";

// =============================================================================
// Test doubles
// =============================================================================

function mockLogger(): Logger {
  return {
    info: mock(),
    error: mock(),
    warn: mock(),
    debug: mock(),
    child: mock(() => mockLogger()),
  };
}

/** Minimal storage stub: `deleteStream` only touches these two ports. */
function fakeStorage(): Storage {
  return {
    streams: { delete: async () => {} },
    deleteStreamData: async () => {},
  } as unknown as Storage;
}

/** An rpcClient whose auth `deleteObjectRelations` records its input. */
function recordingRpcClient(): {
  rpcClient: RpcClient;
  relationDeletes: Array<{ objectType: string; objectId: string }>;
} {
  const relationDeletes: Array<{ objectType: string; objectId: string }> = [];
  const rpcClient = {
    forPlugin: () => ({
      deleteObjectRelations: async (input: {
        objectType: string;
        objectId: string;
      }) => {
        relationDeletes.push(input);
      },
    }),
  } as unknown as RpcClient;
  return { rpcClient, relationDeletes };
}

/** A telemetry source lifecycle that records `handleStreamDeleted` inputs. */
function recordingSourceLifecycle(): {
  sourceLifecycle: TelemetrySourceLifecycle;
  streamDeletes: Array<{ signal: string; streamId: string }>;
} {
  const streamDeletes: Array<{ signal: string; streamId: string }> = [];
  const sourceLifecycle = {
    handleStreamDeleted: async (input: { signal: string; streamId: string }) => {
      streamDeletes.push(input);
    },
  } as unknown as TelemetrySourceLifecycle;
  return { sourceLifecycle, streamDeletes };
}

// =============================================================================
// Delete cascade
// =============================================================================

describe("deleteStream", () => {
  it("deletes the stream's team grants via auth after the data cascade", async () => {
    const { rpcClient, relationDeletes } = recordingRpcClient();
    const service = createTracestreamService({
      storage: fakeStorage(),
      logger: mockLogger(),
      rpcClient,
    });

    await service.deleteStream({ id: "stream-1" });

    expect(relationDeletes).toEqual([
      { objectType: "tracestream.stream", objectId: "stream-1" },
    ]);
  });

  it("cascades the deletion to bound telemetry sources with the traces signal", async () => {
    const { sourceLifecycle, streamDeletes } = recordingSourceLifecycle();
    const service = createTracestreamService({
      storage: fakeStorage(),
      logger: mockLogger(),
      sourceLifecycle,
    });

    await service.deleteStream({ id: "stream-1" });

    expect(streamDeletes).toEqual([{ signal: "traces", streamId: "stream-1" }]);
  });

  it("still deletes the stream when the source cascade throws (warns, does not rethrow)", async () => {
    const logger = mockLogger();
    const sourceLifecycle = {
      handleStreamDeleted: async () => {
        throw new Error("platform unavailable");
      },
    } as unknown as TelemetrySourceLifecycle;
    const service = createTracestreamService({
      storage: fakeStorage(),
      logger,
      sourceLifecycle,
    });

    await service.deleteStream({ id: "stream-1" });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("still deletes the stream when no source lifecycle is wired (cascade skipped)", async () => {
    const logger = mockLogger();
    const service = createTracestreamService({
      storage: fakeStorage(),
      logger,
    });

    await service.deleteStream({ id: "stream-1" });
    expect(logger.warn).toHaveBeenCalled();
  });
});
