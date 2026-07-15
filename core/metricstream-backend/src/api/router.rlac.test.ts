import { describe, it, expect, mock } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createMockRpcContext } from "@checkstack/backend-api";
import type { RpcContext } from "@checkstack/backend-api";
import {
  DEFAULT_METRIC_STREAM_CONFIG,
  type MetricStream,
} from "@checkstack/metricstream-common";
import { createMetricstreamRouter } from "./router";
import type { MetricstreamService } from "./service";
import type { SystemLinksReadableAuthorizer } from "./system-links-auth";

/**
 * RLAC partitioning tests. These exercise the FULL auth middleware (via `call`,
 * which runs the same instanceAccess chain the real transport does), backed by a
 * stub service - so they prove the CONTRACT's `instanceAccess` modes actually
 * gate/filter as `.claude/rules/rlac.md` requires, independent of any DB.
 */

const STREAM_TYPE = "metricstream.stream";
const READ_RULE = "metricstream.stream.read";
const MANAGE_RULE = "metricstream.stream.manage";

const stream = (id: string, name: string): MetricStream => ({
  id,
  name,
  description: null,
  config: DEFAULT_METRIC_STREAM_CONFIG,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const STREAM_1 = stream("stream-1", "Payments metrics");
const STREAM_2 = stream("stream-2", "Checkout metrics");

function stubService(
  overrides: Partial<MetricstreamService> = {},
): MetricstreamService {
  const notImplemented = (name: string) => () => {
    throw new Error(`stub: ${name} not implemented`);
  };
  return {
    createStream: async (input) => ({ ...stream("created-id", input.name) }),
    updateStream: notImplemented("updateStream"),
    deleteStream: async () => {},
    listStreams: async () => ({ streams: [STREAM_1, STREAM_2] }),
    listStreamSummaries: async () => ({
      summaries: [
        {
          id: STREAM_1.id,
          lastReceivedAt: null,
          approxDatapointsPerMinute: 120,
          seriesCount: 42,
          seriesCap: 5000,
          droppedSeriesCount: 0,
        },
        {
          id: STREAM_2.id,
          lastReceivedAt: null,
          approxDatapointsPerMinute: 0,
          seriesCount: 0,
          seriesCap: 5000,
          droppedSeriesCount: 0,
        },
      ],
    }),
    getStream: async ({ id }) => stream(id, "Some stream"),
    listStreamsForPicker: async () => [
      { id: STREAM_1.id, name: STREAM_1.name },
      { id: STREAM_2.id, name: STREAM_2.name },
    ],
    listMetricNames: async () => ({ names: [] }),
    listLabelKeys: async () => ({ keys: [] }),
    listLabelValues: async () => ({ values: [] }),
    listMetricSeries: async () => ({ series: [] }),
    getMetricBuckets: async ({ grain }) => ({ grain: grain ?? "minute", points: [], exemplars: [] }),
    listImportantEvents: async () => ({ events: [], nextCursor: null }),
    getStreamOverview: notImplemented("getStreamOverview"),
    listSystemLinks: async () => ({ systemIds: [] }),
    setSystemLinks: async () => {},
    listStreamsForSystem: async () => ({
      streams: [
        { id: STREAM_1.id, name: STREAM_1.name },
        { id: STREAM_2.id, name: STREAM_2.name },
      ],
    }),
    listLinkedStreamStatuses: async () => ({
      matches: [
        { id: STREAM_1.id, name: STREAM_1.name, systemIds: ["sys-1"], lastImportantEvent: null },
        { id: STREAM_2.id, name: STREAM_2.name, systemIds: ["sys-1"], lastImportantEvent: null },
      ],
    }),
    ...overrides,
  };
}

const buildRouter = (
  overrides?: Partial<MetricstreamService>,
  assertLinkedSystemsReadable: SystemLinksReadableAuthorizer = async () => {},
) =>
  createMetricstreamRouter({
    service: stubService(overrides),
    assertLinkedSystemsReadable,
  });

const teamUser = { type: "user" as const, id: "team-user", accessRules: [] as string[] };

/** Auth stub where the caller may access exactly `grantedIds` at any action. */
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

describe("listStreams (listKey) partitioning", () => {
  it("a global read-rule holder sees every stream", async () => {
    const context = createMockRpcContext({
      user: { type: "user", id: "admin", accessRules: [READ_RULE] },
    });
    const result = await call(buildRouter().listStreams, {}, { context });
    expect(result.streams.map((s) => s.id)).toEqual(["stream-1", "stream-2"]);
  });

  it("a team-scoped caller sees ONLY streams their team is granted", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    const result = await call(buildRouter().listStreams, {}, { context });
    expect(result.streams.map((s) => s.id)).toEqual(["stream-1"]);
  });
});

describe("listStreamSummaries (listKey) partitioning", () => {
  it("a team-scoped caller sees ONLY summaries their team is granted (item id keyed)", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    const result = await call(buildRouter().listStreamSummaries, {}, { context });
    expect(result.summaries.map((s) => s.id)).toEqual(["stream-1"]);
    expect(result.summaries[0]!.seriesCount).toBe(42);
  });
});

describe("getStream (idParam) authorization", () => {
  it("allows a granted id, denies an ungranted id", async () => {
    const ctx = () =>
      createMockRpcContext({ user: teamUser, ...grantAuth(["stream-1"]) });
    expect(
      (await call(buildRouter().getStream, { id: "stream-1" }, { context: ctx() })).id,
    ).toBe("stream-1");
    await expect(
      call(buildRouter().getStream, { id: "stream-2" }, { context: ctx() }),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });
});

describe("listStreamsForPicker (typeScoped)", () => {
  it("a team-scoped caller with ANY grant may populate the picker", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    const result = await call(buildRouter().listStreamsForPicker, {}, { context });
    expect(result.map((s) => s.id)).toEqual(["stream-1", "stream-2"]);
  });
});

describe("autocomplete reads gated on read (idParam streamId)", () => {
  it("denies an ungranted streamId with FORBIDDEN", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    await expect(
      call(
        buildRouter().listMetricNames,
        { streamId: "stream-2", limit: 200 },
        { context },
      ),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });

  it("allows a granted streamId", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    const result = await call(
      buildRouter().listMetricNames,
      { streamId: "stream-1", limit: 200 },
      { context },
    );
    expect(result.names).toEqual([]);
  });
});

describe("createStream (create mode)", () => {
  it("a creator grant writes the owning-team grant for the new id", async () => {
    let ownerWrite: { objectType: string; objectId: string; teamId: string } | undefined;
    const setOwner = mock(
      async (arg: { objectType: string; objectId: string; teamId: string }) => {
        ownerWrite = arg;
      },
    );
    const context = createMockRpcContext({
      user: teamUser,
      pluginMetadata: { pluginId: "metricstream" },
      auth: {
        authorizeCreate: mock(async () => ({ ownerTeamId: "team-42", isPrivate: false })),
        setOwner,
      } as unknown as RpcContext["auth"],
    });
    const result = await call(
      buildRouter().createStream,
      { name: "New stream", teamId: "team-42" },
      { context },
    );
    expect(result.id).toBe("created-id");
    expect(setOwner).toHaveBeenCalledTimes(1);
    expect(ownerWrite).toMatchObject({
      objectType: STREAM_TYPE,
      objectId: "created-id",
      teamId: "team-42",
    });
  });

  it("a global manage-rule holder creates without an owning-team write", async () => {
    const setOwner = mock(async () => {});
    const context = createMockRpcContext({
      user: { type: "user", id: "admin", accessRules: [MANAGE_RULE] },
      auth: {
        authorizeCreate: mock(async () => ({ ownerTeamId: null, isPrivate: false })),
        setOwner,
      } as unknown as RpcContext["auth"],
    });
    const result = await call(
      buildRouter().createStream,
      { name: "New stream" },
      { context },
    );
    expect(result.name).toBe("New stream");
    expect(setOwner).not.toHaveBeenCalled();
  });
});

describe("system links: listStreamsForSystem (listKey) partitioning", () => {
  it("a global read-rule holder sees every linked stream", async () => {
    const context = createMockRpcContext({
      user: { type: "user", id: "admin", accessRules: [READ_RULE] },
    });
    const result = await call(
      buildRouter().listStreamsForSystem,
      { systemId: "sys-1" },
      { context },
    );
    expect(result.streams.map((s) => s.id)).toEqual(["stream-1", "stream-2"]);
  });

  it("a team-scoped caller sees ONLY linked streams they can read (item id keyed)", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    const result = await call(
      buildRouter().listStreamsForSystem,
      { systemId: "sys-1" },
      { context },
    );
    expect(result.streams.map((s) => s.id)).toEqual(["stream-1"]);
  });
});

describe("system links: listLinkedStreamStatuses (listKey) partitioning", () => {
  it("a team-scoped caller sees ONLY statuses for streams they can read (matches keyed on id)", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-2"]),
    });
    const result = await call(
      buildRouter().listLinkedStreamStatuses,
      { systemIds: ["sys-1"] },
      { context },
    );
    expect(result.matches.map((m) => m.id)).toEqual(["stream-2"]);
  });
});

/** Stub `setSystemLinks` that invokes the router-built added-gate callback over
 * a caller-supplied "added" set (as the real service does over its computed
 * diff), so router-level tests can prove the callback wiring without a DB. */
type SetLinksInput = {
  streamId: string;
  systemIds: string[];
  assertAddedReadable: (addedSystemIds: string[]) => Promise<void>;
};

describe("system links: setSystemLinks (manage idParam) + readable gate wiring", () => {
  it("denies an ungranted stream with FORBIDDEN (manage gate, before any service call)", async () => {
    const setLinks = mock(async (_input: SetLinksInput) => {});
    const context = createMockRpcContext({ user: teamUser, ...grantAuth([]) });
    await expect(
      call(
        buildRouter({ setSystemLinks: setLinks }).setSystemLinks,
        { streamId: "stream-1", systemIds: ["sys-1"] },
        { context },
      ),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
    expect(setLinks).not.toHaveBeenCalled();
  });

  it("threads the injected authorizer + request headers into the service's added-gate callback", async () => {
    const assertReadable = mock<SystemLinksReadableAuthorizer>(async () => {});
    // The stub invokes the callback the router built (as the real service does
    // over its computed `added` set), proving the wiring.
    const setLinks = mock(async (input: SetLinksInput) => {
      await input.assertAddedReadable(input.systemIds);
    });
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    await call(
      buildRouter({ setSystemLinks: setLinks }, assertReadable)
        .setSystemLinks,
      { streamId: "stream-1", systemIds: ["sys-a", "sys-b"] },
      { context },
    );
    expect(assertReadable).toHaveBeenCalledTimes(1);
    expect(assertReadable.mock.calls[0]![0]!.addedSystemIds).toEqual([
      "sys-a",
      "sys-b",
    ]);
  });

  it("propagates a FORBIDDEN from the added-gate callback (never persists)", async () => {
    const assertReadable = mock<SystemLinksReadableAuthorizer>(async () => {
      throw new ORPCError("FORBIDDEN", {
        message: "You can only link systems you can access.",
      });
    });
    let persisted = false;
    const setLinks = mock(async (input: SetLinksInput) => {
      await input.assertAddedReadable(input.systemIds);
      persisted = true;
    });
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    await expect(
      call(
        buildRouter({ setSystemLinks: setLinks }, assertReadable)
          .setSystemLinks,
        { streamId: "stream-1", systemIds: ["sys-secret"] },
        { context },
      ),
    ).rejects.toThrow(/FORBIDDEN|can only link/i);
    expect(persisted).toBe(false);
  });
});
