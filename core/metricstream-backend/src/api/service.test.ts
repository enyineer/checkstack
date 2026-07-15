import { describe, it, expect, mock } from "bun:test";
import type {
  SafeDatabase,
  Logger,
  RpcClient,
} from "@checkstack/backend-api";
import type { TelemetrySourceLifecycle } from "@checkstack/telemetry-backend";
import { metricstreamResourceTypes } from "@checkstack/metricstream-common";
import { createMetricstreamService } from "./service";
import type { Storage } from "../storage";
import * as schema from "../schema";
import { metricStreams } from "../schema";

// =============================================================================
// Test doubles
// =============================================================================

/** A chainable, awaitable stand-in for a drizzle query builder. */
interface Chain<T> extends PromiseLike<T[]> {
  from: () => Chain<T>;
  where: () => Chain<T>;
  limit: () => Chain<T>;
}

function chain<T>(rows: T[]): Chain<T> {
  const c: Chain<T> = {
    from: () => c,
    where: () => c,
    limit: () => c,
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
  };
  return c;
}

function mockLogger(): Logger {
  return {
    info: mock(),
    error: mock(),
    warn: mock(),
    debug: mock(),
    child: mock(() => mockLogger()),
  };
}

const noopStorage = {} as unknown as Storage;

const asDb = (fake: unknown) => fake as unknown as SafeDatabase<typeof schema>;

/** A transaction whose select/delete never touch a real database. */
function emptyDb() {
  const deletedTables: unknown[] = [];
  const tx = {
    select: () => ({ from: () => chain([]) }),
    delete: (table: unknown) => ({
      where: async () => {
        deletedTables.push(table);
      },
    }),
  };
  const db = {
    transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return { db, deletedTables };
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
  it("deletes the stream's team grants via auth after the cascade", async () => {
    const { db } = emptyDb();
    const { rpcClient, relationDeletes } = recordingRpcClient();
    const service = createMetricstreamService({
      db: asDb(db),
      storage: noopStorage,
      logger: mockLogger(),
      rpcClient,
    });

    await service.deleteStream({ id: "stream-1" });

    // The stream's ReBAC grants are cleared under the SAME qualified type the
    // access rule keys grants on (metricstream.stream), for this stream id.
    expect(relationDeletes).toEqual([
      { objectType: metricstreamResourceTypes.stream, objectId: "stream-1" },
    ]);
  });

  it("cascades the deletion to bound telemetry sources with the metrics signal", async () => {
    const { db, deletedTables } = emptyDb();
    const { sourceLifecycle, streamDeletes } = recordingSourceLifecycle();
    const service = createMetricstreamService({
      db: asDb(db),
      storage: noopStorage,
      logger: mockLogger(),
      sourceLifecycle,
    });

    await service.deleteStream({ id: "stream-1" });

    // The stream row itself is deleted, then the platform is told to strip this
    // stream's binding from every source.
    expect(deletedTables).toContain(metricStreams);
    expect(streamDeletes).toEqual([{ signal: "metrics", streamId: "stream-1" }]);
  });

  it("still deletes the stream when the source cascade throws (warns, does not rethrow)", async () => {
    const { db } = emptyDb();
    const logger = mockLogger();
    const sourceLifecycle = {
      handleStreamDeleted: async () => {
        throw new Error("platform unavailable");
      },
    } as unknown as TelemetrySourceLifecycle;
    const service = createMetricstreamService({
      db: asDb(db),
      storage: noopStorage,
      logger,
      sourceLifecycle,
    });

    // The stream deletion already succeeded, so a failing cascade is logged.
    await service.deleteStream({ id: "stream-1" });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("still deletes the stream when no source lifecycle is wired (cascade skipped)", async () => {
    const { db } = emptyDb();
    const logger = mockLogger();
    const service = createMetricstreamService({
      db: asDb(db),
      storage: noopStorage,
      logger,
    });

    // No sourceLifecycle: the delete succeeds and the missing-service is warned.
    await service.deleteStream({ id: "stream-1" });
    expect(logger.warn).toHaveBeenCalled();
  });
});
