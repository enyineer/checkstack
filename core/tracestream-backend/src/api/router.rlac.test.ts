import { describe, it, expect, mock } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createMockRpcContext } from "@checkstack/backend-api";
import type { RpcContext } from "@checkstack/backend-api";
import {
  DEFAULT_TRACE_STREAM_CONFIG,
  type TraceStream,
  type TraceSummary,
} from "@checkstack/tracestream-common";
import { createTracestreamRouter } from "./router";
import type { TracestreamService } from "./service";
import type { SystemLinkAuthorizer } from "./system-links-auth";

/**
 * RLAC partitioning tests. These exercise the FULL auth middleware (via `call`,
 * which runs the same instanceAccess chain the real transport does), backed by a
 * stub service - so they prove the CONTRACT's `instanceAccess` modes actually
 * gate/filter as `.claude/rules/rlac.md` requires, independent of any DB.
 */

const STREAM_TYPE = "tracestream.stream";
const READ_RULE = "tracestream.stream.read";
const MANAGE_RULE = "tracestream.stream.manage";

const stream = (id: string, name: string): TraceStream => ({
  id,
  name,
  description: null,
  config: DEFAULT_TRACE_STREAM_CONFIG,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const STREAM_1 = stream("stream-1", "Payments traces");
const STREAM_2 = stream("stream-2", "Checkout traces");

const summary = (traceId: string): TraceSummary => ({
  traceId,
  rootServiceName: "gateway",
  rootSpanName: "GET /pay",
  startTs: new Date("2026-01-01T00:00:00Z"),
  durationMs: 42,
  spanCount: 3,
  errorSpanCount: 0,
  hasError: false,
  retained: true,
  lastSpanAt: new Date("2026-01-01T00:00:01Z"),
});

function stubService(
  overrides: Partial<TracestreamService> = {},
): TracestreamService {
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
          name: STREAM_1.name,
          lastReceivedAt: null,
          traces24h: 120,
          errorTraces24h: 3,
          serviceCount: 5,
        },
        {
          id: STREAM_2.id,
          name: STREAM_2.name,
          lastReceivedAt: null,
          traces24h: 0,
          errorTraces24h: 0,
          serviceCount: 0,
        },
      ],
    }),
    getStream: async ({ id }) => stream(id, "Some stream"),
    listStreamsForPicker: async () => [
      { id: STREAM_1.id, name: STREAM_1.name },
      { id: STREAM_2.id, name: STREAM_2.name },
    ],
    searchTraces: async () => ({ traces: [], nextCursor: null }),
    getTrace: async () => ({ summary: summary("trace-1"), spans: [] }),
    getOpBuckets: async ({ grain }) => ({ grain: grain ?? "minute", buckets: [] }),
    listServices: async () => ({ services: [] }),
    listOperations: async () => ({ operations: [] }),
    getStreamOverview: notImplemented("getStreamOverview"),
    listImportantEvents: async () => ({ events: [], nextCursor: null }),
    findTraceById: async () => ({
      matches: [
        { id: STREAM_1.id, streamName: STREAM_1.name, summary: summary("trace-x") },
        { id: STREAM_2.id, streamName: STREAM_2.name, summary: summary("trace-x") },
      ],
    }),
    listSystemLinks: async () => ({ systemIds: ["sys-1", "sys-2"] }),
    // Existence gate + persisted set: default stub has sys-1 already linked, so
    // a request adding sys-2 diffs to a single ADDED id.
    getSystemLinksForWrite: async () => ["sys-1"],
    setSystemLinks: async () => {},
    listStreamsForSystem: async () => ({
      streams: [
        { id: STREAM_1.id, name: STREAM_1.name },
        { id: STREAM_2.id, name: STREAM_2.name },
      ],
    }),
    listLinkedStreamStatuses: async () => ({
      matches: [
        {
          id: STREAM_1.id,
          name: STREAM_1.name,
          systemIds: ["sys-1"],
          lastImportantEvent: null,
        },
        {
          id: STREAM_2.id,
          name: STREAM_2.name,
          systemIds: ["sys-1"],
          lastImportantEvent: null,
        },
      ],
    }),
    ...overrides,
  };
}

const buildRouter = (
  overrides?: Partial<TracestreamService>,
  authorizeSystemLinks: SystemLinkAuthorizer = async () => {},
) =>
  createTracestreamRouter({
    service: stubService(overrides),
    authorizeSystemLinks,
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
    expect(result.summaries[0]!.traces24h).toBe(120);
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

describe("viewer reads gated on read (idParam streamId)", () => {
  // Each thunk is a concretely-typed `call` for one read proc, closing over the
  // stream id + context so the loop stays type-safe (no procedure-union cast).
  const from = new Date("2026-01-01T00:00:00Z");
  const to = new Date("2026-01-01T01:00:00Z");
  const READ_CALLS: {
    name: string;
    run: (streamId: string, context: RpcContext) => Promise<unknown>;
  }[] = [
    {
      name: "searchTraces",
      run: (streamId, context) =>
        call(buildRouter().searchTraces, { streamId, from, to, limit: 50 }, { context }),
    },
    {
      name: "getTrace",
      run: (streamId, context) =>
        call(buildRouter().getTrace, { streamId, traceId: "t-1" }, { context }),
    },
    {
      name: "getOpBuckets",
      run: (streamId, context) =>
        call(buildRouter().getOpBuckets, { streamId, from, to }, { context }),
    },
    {
      name: "listServices",
      run: (streamId, context) =>
        call(buildRouter().listServices, { streamId }, { context }),
    },
    {
      name: "listOperations",
      run: (streamId, context) =>
        call(buildRouter().listOperations, { streamId, serviceName: "svc" }, { context }),
    },
    {
      name: "listImportantEvents",
      run: (streamId, context) =>
        call(buildRouter().listImportantEvents, { streamId, limit: 50 }, { context }),
    },
    {
      name: "getStreamOverview",
      run: (streamId, context) =>
        call(buildRouter({ getStreamOverview: async () => ({
          totals24h: { spans: 0, traces: 0, errorTraces: 0, retainedTraces: 0 },
          lastReceivedAt: null,
          droppedSpansCount: 0,
          droppedTracesCount: 0,
          droppedInTransitCount: 0,
          slowestRetained: [],
          topServices: [],
        }) }).getStreamOverview, { streamId }, { context }),
    },
  ];

  for (const { name, run } of READ_CALLS) {
    it(`${name}: denies an ungranted streamId with FORBIDDEN`, async () => {
      const context = createMockRpcContext({
        user: teamUser,
        ...grantAuth(["stream-1"]),
      });
      await expect(run("stream-2", context)).rejects.toThrow(
        /FORBIDDEN|Access denied/i,
      );
    });

    it(`${name}: allows a granted streamId`, async () => {
      const context = createMockRpcContext({
        user: teamUser,
        ...grantAuth(["stream-1"]),
      });
      await expect(run("stream-1", context)).resolves.toBeDefined();
    });
  }
});

// Push-token mint/revoke/list moved to the telemetry platform
// (`tracestream.push` source instances), so the tracestream contract no longer
// exposes token procedures - nothing to gate here anymore.

describe("findTraceById (listKey 'matches') post-filter", () => {
  it("a team-scoped caller sees only matches on granted streams (keyed on item id)", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-2"]),
    });
    const result = await call(
      buildRouter().findTraceById,
      { traceId: "trace-x" },
      { context },
    );
    expect(result.matches.map((m) => m.id)).toEqual(["stream-2"]);
  });

  it("a global read-rule holder sees every stream the trace appears in", async () => {
    const context = createMockRpcContext({
      user: { type: "user", id: "admin", accessRules: [READ_RULE] },
    });
    const result = await call(
      buildRouter().findTraceById,
      { traceId: "trace-x" },
      { context },
    );
    expect(result.matches.map((m) => m.id)).toEqual(["stream-1", "stream-2"]);
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
      pluginMetadata: { pluginId: "tracestream" },
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

describe("listSystemLinks / setSystemLinks (idParam streamId)", () => {
  it("listSystemLinks allows a granted stream, denies an ungranted one", async () => {
    const ctx = () =>
      createMockRpcContext({ user: teamUser, ...grantAuth(["stream-1"]) });
    expect(
      (
        await call(
          buildRouter().listSystemLinks,
          { streamId: "stream-1" },
          { context: ctx() },
        )
      ).systemIds,
    ).toEqual(["sys-1", "sys-2"]);
    await expect(
      call(
        buildRouter().listSystemLinks,
        { streamId: "stream-2" },
        { context: ctx() },
      ),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });

  it("setSystemLinks (manage) denies an ungranted stream BEFORE any gate work", async () => {
    const authorize = mock<SystemLinkAuthorizer>(async () => {});
    const getForWrite = mock(async () => ["sys-1"]);
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth([]),
    });
    await expect(
      call(
        buildRouter({ getSystemLinksForWrite: getForWrite }, authorize)
          .setSystemLinks,
        { streamId: "stream-1", systemIds: ["sys-1"] },
        { context },
      ),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
    // The stream manage-gate rejects first: neither the existence read nor the
    // catalog authorizer runs.
    expect(getForWrite).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it("setSystemLinks (manage) authorizes ONLY the newly ADDED systems (diff vs persisted)", async () => {
    const authorize = mock<SystemLinkAuthorizer>(async () => {});
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    // Persisted = [sys-1] (default stub); request keeps sys-1, adds sys-2.
    await call(
      buildRouter(undefined, authorize).setSystemLinks,
      { streamId: "stream-1", systemIds: ["sys-1", "sys-2"] },
      { context },
    );
    expect(authorize).toHaveBeenCalledTimes(1);
    // Only sys-2 is added; sys-1 is retained and needs no readability check.
    expect(authorize.mock.calls[0]![0]!.addedSystemIds).toEqual(["sys-2"]);
  });

  it("setSystemLinks (manage) skips the authorizer when nothing is added (removal only)", async () => {
    const authorize = mock<SystemLinkAuthorizer>(async () => {});
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    // Persisted = [sys-1, sys-2]; request removes sys-2 (adds nothing).
    await call(
      buildRouter(
        { getSystemLinksForWrite: async () => ["sys-1", "sys-2"] },
        authorize,
      ).setSystemLinks,
      { streamId: "stream-1", systemIds: ["sys-1"] },
      { context },
    );
    // Empty added set: the authorizer still runs but with no ids (it no-ops).
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize.mock.calls[0]![0]!.addedSystemIds).toEqual([]);
  });

  it("setSystemLinks propagates a catalog-authorizer rejection (unreadable added system)", async () => {
    const authorize = mock<SystemLinkAuthorizer>(async () => {
      throw new Error("You can only link systems you can read.");
    });
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    await expect(
      call(
        buildRouter(undefined, authorize).setSystemLinks,
        { streamId: "stream-1", systemIds: ["sys-1", "sys-forbidden"] },
        { context },
      ),
    ).rejects.toThrow(/only link systems you can read/i);
  });

  it("setSystemLinks surfaces NOT_FOUND (existence-first) before authorizing", async () => {
    const authorize = mock<SystemLinkAuthorizer>(async () => {});
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    await expect(
      call(
        buildRouter(
          {
            getSystemLinksForWrite: async () => {
              throw new ORPCError("NOT_FOUND", { message: "Trace stream not found" });
            },
          },
          authorize,
        ).setSystemLinks,
        { streamId: "stream-1", systemIds: ["sys-1"] },
        { context },
      ),
    ).rejects.toThrow(/NOT_FOUND|not found/i);
    // Existence-first: the catalog authorizer never runs when the stream is gone.
    expect(authorize).not.toHaveBeenCalled();
  });
});

describe("listStreamsForSystem (listKey 'streams') post-filter", () => {
  it("a team-scoped caller sees only streams on granted ids (keyed on item id)", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-2"]),
    });
    const result = await call(
      buildRouter().listStreamsForSystem,
      { systemId: "sys-1" },
      { context },
    );
    expect(result.streams.map((s) => s.id)).toEqual(["stream-2"]);
  });

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
});

describe("listLinkedStreamStatuses (listKey 'matches') post-filter", () => {
  it("a team-scoped caller sees only matches on granted streams (keyed on item id)", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    const result = await call(
      buildRouter().listLinkedStreamStatuses,
      { systemIds: ["sys-1"] },
      { context },
    );
    expect(result.matches.map((m) => m.id)).toEqual(["stream-1"]);
  });

  it("a global read-rule holder sees every linked stream's status", async () => {
    const context = createMockRpcContext({
      user: { type: "user", id: "admin", accessRules: [READ_RULE] },
    });
    const result = await call(
      buildRouter().listLinkedStreamStatuses,
      { systemIds: ["sys-1"] },
      { context },
    );
    expect(result.matches.map((m) => m.id)).toEqual(["stream-1", "stream-2"]);
  });
});
