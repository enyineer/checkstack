import { describe, it, expect, mock } from "bun:test";
import { call } from "@orpc/server";
import { createMockRpcContext } from "@checkstack/backend-api";
import type { RpcContext } from "@checkstack/backend-api";
import {
  DEFAULT_TRACE_STREAM_CONFIG,
  type TraceStream,
  type TraceStreamToken,
  type TraceSummary,
} from "@checkstack/tracestream-common";
import { createTracestreamRouter } from "./router";
import type { TracestreamService } from "./service";

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

const token = (id: string, streamId: string): TraceStreamToken => ({
  id,
  streamId,
  name: "shipper",
  tokenPrefix: "cktr_abc",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  lastUsedAt: null,
  revokedAt: null,
});

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
    listTokens: async ({ streamId }) => [token("tok-1", streamId)],
    mintToken: async ({ streamId }) => ({
      secret: "cktr_secret_value",
      token: token("tok-1", streamId),
    }),
    revokeToken: async () => {},
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
    ...overrides,
  };
}

const buildRouter = (overrides?: Partial<TracestreamService>) =>
  createTracestreamRouter({ service: stubService(overrides) });

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

describe("token mint/revoke gated on manage (idParam streamId)", () => {
  it("a manage grant on the stream may mint", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    const result = await call(
      buildRouter().mintToken,
      { streamId: "stream-1", name: "shipper" },
      { context },
    );
    expect(result.secret).toBe("cktr_secret_value");
  });

  it("no grant on the stream is FORBIDDEN for mint and revoke", async () => {
    const context = () => createMockRpcContext({ user: teamUser, ...grantAuth([]) });
    await expect(
      call(buildRouter().mintToken, { streamId: "stream-1", name: "s" }, { context: context() }),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
    await expect(
      call(
        buildRouter().revokeToken,
        { streamId: "stream-1", tokenId: "tok-1" },
        { context: context() },
      ),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });

  it("listTokens (manage) never leaks the secret/hash", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    const result = await call(
      buildRouter().listTokens,
      { streamId: "stream-1" },
      { context },
    );
    for (const t of result) {
      expect(t).not.toHaveProperty("secret");
      expect(t).not.toHaveProperty("tokenHash");
    }
  });
});

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
