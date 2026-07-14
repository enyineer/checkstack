import { describe, it, expect, mock } from "bun:test";
import { call } from "@orpc/server";
import { createMockRpcContext, type RpcContext } from "@checkstack/backend-api";
import type { TelemetrySource } from "@checkstack/telemetry-common";
import { createTelemetryRouter } from "./router";
import type { TelemetryService } from "./service";

/**
 * RLAC partitioning tests: exercise the FULL auth middleware (via `call`) backed
 * by a stub service, proving the contract's `instanceAccess` modes gate/filter
 * as `.claude/rules/rlac.md` requires, independent of any DB.
 */

const SOURCE_TYPE = "telemetry.source";
const MANAGE_RULE = "telemetry.source.manage";

const D = new Date("2026-01-01T00:00:00Z");
const source = (id: string): TelemetrySource => ({
  id,
  sourceTypeId: "p.type",
  name: `source ${id}`,
  description: null,
  config: {},
  storedSecretFields: [],
  bindings: [{ signal: "logs", streamId: "stream-1" }],
  bindingStreamNames: { logs: "stream one" },
  enabled: true,
  intervalSeconds: null,
  satelliteId: null,
  lastRunAt: null,
  lastError: null,
  consecutiveFailures: 0,
  createdAt: D,
  updatedAt: D,
});

function stubService(overrides: Partial<TelemetryService> = {}): TelemetryService {
  const notImplemented = (name: string) => () => {
    throw new Error(`stub: ${name} not implemented`);
  };
  return {
    listSourceTypes: async () => ({ sourceTypes: [] }),
    createSource: async ({ input }) => ({
      ...source("created-id"),
      name: input.name,
    }),
    updateSource: notImplemented("updateSource") as TelemetryService["updateSource"],
    deleteSource: async () => {},
    getSource: async ({ id }) => source(id),
    listSources: async () => ({ sources: [source("src-1"), source("src-2")] }),
    listBindableStreams: async () => ({ streams: [] }),
    rotateWebhookSecret: async ({ id }) => ({
      path: `/api/telemetry/hooks/${id}`,
      secret: "ckwh_secret",
    }),
    resolveRunnableConfig: async () => ({}),
    runConfigTest: async () => ({ supported: true, ok: true }),
    listSatelliteSources: async () => ({ sources: [] }),
    ...overrides,
  };
}

const buildRouter = (overrides?: Partial<TelemetryService>) =>
  createTelemetryRouter({ service: stubService(overrides) });

const teamUser = { type: "user" as const, id: "team-user", accessRules: [] as string[] };

/** Auth stub where the caller may access exactly `grantedIds`. */
function grantAuth(grantedIds: string[]): Partial<RpcContext> {
  const granted = new Set(grantedIds);
  return {
    auth: {
      check: mock(async ({ objectId }: { objectId: string }) => ({
        hasAccess: granted.has(objectId),
      })),
      listAccessibleObjectIds: mock(
        async ({ objectIds }: { objectIds: string[] }) =>
          objectIds.filter((id) => granted.has(id)),
      ),
      hasAnyTypeGrant: mock(async () => ({ hasGrant: granted.size > 0 })),
    } as unknown as RpcContext["auth"],
  };
}

describe("listSourceTypes (typeScoped)", () => {
  it("a team-scoped caller with ANY grant may list the catalog", async () => {
    const context = createMockRpcContext({ user: teamUser, ...grantAuth(["src-1"]) });
    const result = await call(buildRouter().listSourceTypes, {}, { context });
    expect(result.sourceTypes).toEqual([]);
  });

  it("a caller with no grant and no global rule is FORBIDDEN", async () => {
    const context = createMockRpcContext({ user: teamUser, ...grantAuth([]) });
    await expect(
      call(buildRouter().listSourceTypes, {}, { context }),
    ).rejects.toThrow(/FORBIDDEN|Missing access/i);
  });
});

describe("getSource (idParam)", () => {
  it("allows a granted id, denies an ungranted id", async () => {
    const ctx = () => createMockRpcContext({ user: teamUser, ...grantAuth(["src-1"]) });
    expect((await call(buildRouter().getSource, { id: "src-1" }, { context: ctx() })).id).toBe(
      "src-1",
    );
    await expect(
      call(buildRouter().getSource, { id: "src-2" }, { context: ctx() }),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });
});

describe("listSources (listKey) partitioning", () => {
  it("a team-scoped caller sees ONLY sources their team is granted", async () => {
    const context = createMockRpcContext({ user: teamUser, ...grantAuth(["src-1"]) });
    const result = await call(buildRouter().listSources, {}, { context });
    expect(result.sources.map((s) => s.id)).toEqual(["src-1"]);
  });
});

describe("update / delete / rotate gated on manage (idParam)", () => {
  it("denies an ungranted id", async () => {
    const context = () => createMockRpcContext({ user: teamUser, ...grantAuth([]) });
    await expect(
      call(buildRouter().deleteSource, { id: "src-1" }, { context: context() }),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
    await expect(
      call(buildRouter().rotateWebhookSecret, { id: "src-1" }, { context: context() }),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });

  it("allows a manage grant on the instance", async () => {
    const context = createMockRpcContext({ user: teamUser, ...grantAuth(["src-1"]) });
    const result = await call(
      buildRouter().rotateWebhookSecret,
      { id: "src-1" },
      { context },
    );
    expect(result.secret).toBe("ckwh_secret");
  });
});

describe("testSourceConfig (typeScoped + in-handler manage on sourceId)", () => {
  it("a team manager may run a fresh-editor test (no sourceId)", async () => {
    const context = createMockRpcContext({ user: teamUser, ...grantAuth(["src-1"]) });
    const result = await call(
      buildRouter().testSourceConfig,
      { sourceTypeId: "p.type", config: {} },
      { context },
    );
    expect(result.ok).toBe(true);
  });

  it("denies reusing an ungranted source's stored secrets", async () => {
    const context = createMockRpcContext({ user: teamUser, ...grantAuth(["src-1"]) });
    await expect(
      call(
        buildRouter().testSourceConfig,
        { sourceTypeId: "p.type", config: {}, sourceId: "src-2" },
        { context },
      ),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });

  it("allows reusing a granted source's stored secrets", async () => {
    const context = createMockRpcContext({ user: teamUser, ...grantAuth(["src-1"]) });
    const result = await call(
      buildRouter().testSourceConfig,
      { sourceTypeId: "p.type", config: {}, sourceId: "src-1" },
      { context },
    );
    expect(result.ok).toBe(true);
  });
});

describe("createSource (create mode)", () => {
  it("a creator grant writes the owning-team grant for the new id", async () => {
    let ownerWrite: { objectType: string; objectId: string; teamId: string } | undefined;
    const setOwner = mock(
      async (arg: { objectType: string; objectId: string; teamId: string }) => {
        ownerWrite = arg;
      },
    );
    const context = createMockRpcContext({
      user: teamUser,
      pluginMetadata: { pluginId: "telemetry" },
      auth: {
        authorizeCreate: mock(async () => ({ ownerTeamId: "team-42", isPrivate: false })),
        setOwner,
      } as unknown as RpcContext["auth"],
    });
    const result = await call(
      buildRouter().createSource,
      {
        sourceTypeId: "p.type",
        name: "New source",
        config: {},
        bindings: [{ signal: "logs", streamId: "stream-1" }],
        enabled: true,
        teamId: "team-42",
      },
      { context },
    );
    expect(result.id).toBe("created-id");
    expect(setOwner).toHaveBeenCalledTimes(1);
    expect(ownerWrite).toMatchObject({
      objectType: SOURCE_TYPE,
      objectId: "created-id",
      teamId: "team-42",
    });
  });

  it("a global manage-rule holder creates without an owning-team write", async () => {
    const setOwner = mock(async () => {});
    const context = createMockRpcContext({
      user: { type: "user", id: "admin", accessRules: [MANAGE_RULE] },
      pluginMetadata: { pluginId: "telemetry" },
      auth: {
        authorizeCreate: mock(async () => ({ ownerTeamId: null, isPrivate: false })),
        setOwner,
      } as unknown as RpcContext["auth"],
    });
    const result = await call(
      buildRouter().createSource,
      {
        sourceTypeId: "p.type",
        name: "New source",
        config: {},
        bindings: [{ signal: "logs", streamId: "stream-1" }],
        enabled: true,
      },
      { context },
    );
    expect(result.name).toBe("New source");
    expect(setOwner).not.toHaveBeenCalled();
  });
});
