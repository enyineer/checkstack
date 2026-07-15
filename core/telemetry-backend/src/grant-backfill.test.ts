import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import path from "node:path";
import type {
  AdvisoryLockService,
  Logger,
  RpcClient,
} from "@checkstack/backend-api";
import type { InternalSecretsService } from "@checkstack/secrets-backend";
import {
  withTestDb,
  isIntegrationEnabled,
  createMockLogger,
  type TestDb,
} from "@checkstack/test-utils-backend";
import { telemetryResourceTypes } from "@checkstack/telemetry-common";
import * as schema from "./schema";
import { telemetrySources } from "./schema";
import {
  createTelemetrySinkRegistry,
  type RegisteredTelemetrySink,
  type TelemetrySinkRegistry,
} from "./extension-points";
import {
  backfillPromotedSourceGrants,
  PROMOTED_GRANTS_BACKFILL_MARKER,
  type GrantBackfillAuthClient,
} from "./grant-backfill";

const MIGRATIONS = path.join(import.meta.dir, "..", "drizzle");

const LOGS_STREAM_TYPE = "logstream.stream";
const SOURCE_TYPE = telemetryResourceTypes.source;

/** In-memory internal-secrets service (marker store). */
function memInternalSecrets(): InternalSecretsService {
  const store = new Map<string, string>();
  const key = (parts: string[]) => parts.join(" ");
  return {
    set: async ({ parts, value }) => void store.set(key(parts), value),
    get: async ({ parts }) => store.get(key(parts)),
    delete: async ({ parts }) => void store.delete(key(parts)),
  };
}

/** Advisory lock that always acquires (single-pod test). */
function fakeLock(acquired = true): AdvisoryLockService {
  return {
    tryAcquire: async () => (acquired ? { release: async () => {} } : null),
    withXactLock: async ({ fn }) => fn(),
  };
}

type Relations = {
  teams: {
    teamId: string;
    teamName: string;
    relation: "viewer" | "editor" | "owner";
  }[];
  isPublic: boolean;
};

/** A recording auth client; `relations` is keyed by `objectType:objectId`. */
function recordingAuth(relations: Record<string, Relations>) {
  const calls = {
    list: [] as { objectType: string; objectId: string }[],
    writeRelation: [] as {
      objectType: string;
      objectId: string;
      teamId: string;
      relation: string;
    }[],
    setOwner: [] as {
      objectType: string;
      objectId: string;
      teamId: string;
      isPrivate?: boolean;
    }[],
    setObjectPublic: [] as { objectId: string; isPublic: boolean }[],
  };
  const client: GrantBackfillAuthClient = {
    listObjectRelations: async ({ objectType, objectId }) => {
      calls.list.push({ objectType, objectId });
      return relations[`${objectType}:${objectId}`] ?? { teams: [], isPublic: false };
    },
    writeRelation: async (input) => void calls.writeRelation.push(input),
    setOwner: async (input) => void calls.setOwner.push(input),
    setObjectPublic: async ({ objectId, isPublic }) =>
      void calls.setObjectPublic.push({ objectId, isPublic }),
  };
  // Structural test fake: RpcClient.forPlugin always yields this auth client.
  const rpcClient = { forPlugin: () => client } as unknown as RpcClient;
  return { rpcClient, calls };
}

function recordingLogger(): { logger: Logger; warns: string[] } {
  const warns: string[] = [];
  const base = createMockLogger();
  return { logger: { ...base, warn: (m: unknown) => warns.push(String(m)) }, warns };
}

function sinkRegistry({
  withStreamType = true,
}: { withStreamType?: boolean } = {}): TelemetrySinkRegistry {
  const registry = createTelemetrySinkRegistry();
  const logsSink: RegisteredTelemetrySink = {
    signal: "logs",
    ownerPluginId: "logstream",
    ...(withStreamType ? { streamResourceType: LOGS_STREAM_TYPE } : {}),
    assertBindable: async () => {},
    describeStream: async () => null,
    write: async () => ({ accepted: 0, rejected: 0 }),
  };
  registry.register(logsSink, { pluginId: "logstream" });
  return registry;
}

describe.skipIf(!isIntegrationEnabled())("backfillPromotedSourceGrants (integration)", () => {
  let testDb: TestDb<typeof schema>;

  beforeAll(async () => {
    testDb = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
  });
  afterAll(async () => {
    await testDb?.dispose();
  });
  beforeEach(async () => {
    await testDb.db.delete(telemetrySources);
  });

  async function insertSource(input: {
    id: string;
    sourceTypeId: string;
    streamId?: string;
  }): Promise<void> {
    await testDb.db.insert(telemetrySources).values({
      id: input.id,
      sourceTypeId: input.sourceTypeId,
      name: input.id,
      config: {},
      bindings: [{ signal: "logs", streamId: input.streamId ?? "stream-1" }],
      enabled: true,
    });
  }

  it("backfills owner/editor relations for a grantless promoted-type source from its bound stream", async () => {
    await insertSource({ id: "s1", sourceTypeId: "metricstream.push", streamId: "stream-A" });
    const internalSecrets = memInternalSecrets();
    const { rpcClient, calls } = recordingAuth({
      // The source itself has NO relations (grantless) -> proceed.
      [`${SOURCE_TYPE}:s1`]: { teams: [], isPublic: false },
      // The bound stream carries an owner + an editor team.
      [`${LOGS_STREAM_TYPE}:stream-A`]: {
        teams: [
          { teamId: "t-own", teamName: "Owners", relation: "owner" },
          { teamId: "t-ed", teamName: "Eds", relation: "editor" },
        ],
        isPublic: false,
      },
    });

    await backfillPromotedSourceGrants({
      db: testDb.db,
      sinkRegistry: sinkRegistry(),
      rpcClient,
      internalSecrets,
      advisoryLock: fakeLock(),
      logger: createMockLogger(),
    });

    // Owner copied via setOwner, editor via writeRelation - both onto the source.
    expect(calls.setOwner).toEqual([
      { objectType: SOURCE_TYPE, objectId: "s1", teamId: "t-own", isPrivate: true },
    ]);
    expect(calls.writeRelation).toEqual([
      { objectType: SOURCE_TYPE, objectId: "s1", teamId: "t-ed", relation: "editor" },
    ]);
    // Private stream -> source not marked public.
    expect(calls.setObjectPublic).toEqual([]);
    // Marker recorded.
    expect(await internalSecrets.get({ parts: PROMOTED_GRANTS_BACKFILL_MARKER })).toBe("done");
  });

  it("mirrors a public stream by marking the source public", async () => {
    await insertSource({ id: "s1", sourceTypeId: "logstream.push", streamId: "stream-A" });
    const { rpcClient, calls } = recordingAuth({
      [`${SOURCE_TYPE}:s1`]: { teams: [], isPublic: false },
      [`${LOGS_STREAM_TYPE}:stream-A`]: {
        teams: [{ teamId: "t-ed", teamName: "Eds", relation: "editor" }],
        isPublic: true,
      },
    });
    await backfillPromotedSourceGrants({
      db: testDb.db,
      sinkRegistry: sinkRegistry(),
      rpcClient,
      internalSecrets: memInternalSecrets(),
      advisoryLock: fakeLock(),
      logger: createMockLogger(),
    });
    expect(calls.setObjectPublic).toEqual([{ objectId: "s1", isPublic: true }]);
  });

  it("skips a source that already has team relations", async () => {
    await insertSource({ id: "s1", sourceTypeId: "metricstream.push" });
    const { rpcClient, calls } = recordingAuth({
      // Already granted -> must not write anything.
      [`${SOURCE_TYPE}:s1`]: {
        teams: [{ teamId: "t", teamName: "T", relation: "owner" }],
        isPublic: false,
      },
    });
    await backfillPromotedSourceGrants({
      db: testDb.db,
      sinkRegistry: sinkRegistry(),
      rpcClient,
      internalSecrets: memInternalSecrets(),
      advisoryLock: fakeLock(),
      logger: createMockLogger(),
    });
    expect(calls.writeRelation).toEqual([]);
    expect(calls.setOwner).toEqual([]);
    // It looked at the source, but never read the stream (short-circuited).
    expect(calls.list).toEqual([{ objectType: SOURCE_TYPE, objectId: "s1" }]);
  });

  it("skips non-promoted source types (never queried)", async () => {
    await insertSource({ id: "s1", sourceTypeId: "metricstream.some-other-type" });
    const { rpcClient, calls } = recordingAuth({});
    await backfillPromotedSourceGrants({
      db: testDb.db,
      sinkRegistry: sinkRegistry(),
      rpcClient,
      internalSecrets: memInternalSecrets(),
      advisoryLock: fakeLock(),
      logger: createMockLogger(),
    });
    // The non-promoted row is filtered out of the scan entirely.
    expect(calls.list).toEqual([]);
    expect(calls.writeRelation).toEqual([]);
    expect(calls.setOwner).toEqual([]);
  });

  it("marker short-circuits a second run", async () => {
    await insertSource({ id: "s1", sourceTypeId: "metricstream.push", streamId: "stream-A" });
    const internalSecrets = memInternalSecrets();
    const relations = {
      [`${SOURCE_TYPE}:s1`]: { teams: [], isPublic: false } as Relations,
      [`${LOGS_STREAM_TYPE}:stream-A`]: {
        teams: [{ teamId: "t", teamName: "T", relation: "editor" as const }],
        isPublic: false,
      },
    };
    const first = recordingAuth(relations);
    await backfillPromotedSourceGrants({
      db: testDb.db,
      sinkRegistry: sinkRegistry(),
      rpcClient: first.rpcClient,
      internalSecrets,
      advisoryLock: fakeLock(),
      logger: createMockLogger(),
    });
    expect(first.calls.writeRelation).toHaveLength(1);

    // Second run with the SAME marker store makes no auth calls at all.
    const second = recordingAuth(relations);
    await backfillPromotedSourceGrants({
      db: testDb.db,
      sinkRegistry: sinkRegistry(),
      rpcClient: second.rpcClient,
      internalSecrets,
      advisoryLock: fakeLock(),
      logger: createMockLogger(),
    });
    expect(second.calls.list).toEqual([]);
    expect(second.calls.writeRelation).toEqual([]);
  });

  it("skips a binding whose sink lacks streamResourceType, with a warn", async () => {
    await insertSource({ id: "s1", sourceTypeId: "metricstream.push", streamId: "stream-A" });
    const { rpcClient, calls } = recordingAuth({
      [`${SOURCE_TYPE}:s1`]: { teams: [], isPublic: false },
    });
    const { logger, warns } = recordingLogger();
    await backfillPromotedSourceGrants({
      db: testDb.db,
      sinkRegistry: sinkRegistry({ withStreamType: false }),
      rpcClient,
      internalSecrets: memInternalSecrets(),
      advisoryLock: fakeLock(),
      logger,
    });
    expect(calls.writeRelation).toEqual([]);
    expect(calls.setOwner).toEqual([]);
    expect(warns.some((w) => w.includes("streamResourceType"))).toBe(true);
  });

  it("does nothing (no auth calls) when the advisory lock is held by another pod", async () => {
    await insertSource({ id: "s1", sourceTypeId: "metricstream.push" });
    const { rpcClient, calls } = recordingAuth({});
    await backfillPromotedSourceGrants({
      db: testDb.db,
      sinkRegistry: sinkRegistry(),
      rpcClient,
      internalSecrets: memInternalSecrets(),
      advisoryLock: fakeLock(false),
      logger: createMockLogger(),
    });
    expect(calls.list).toEqual([]);
  });
});
