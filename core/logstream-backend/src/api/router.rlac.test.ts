import { describe, it, expect, mock } from "bun:test";
import { call } from "@orpc/server";
import { createMockRpcContext } from "@checkstack/backend-api";
import type { RpcContext } from "@checkstack/backend-api";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  bandFromSeverityNumber,
  FindEventsByTraceIdSchema,
  type LogStream,
  type LogStreamToken,
  type LogPattern,
  type LogEvent,
} from "@checkstack/logstream-common";
import { createLogstreamRouter } from "./router";
import type { LogstreamService } from "./service";

/**
 * RLAC partitioning tests. These exercise the FULL auth middleware (via `call`,
 * which runs the same instanceAccess chain the real transport does), backed by a
 * stub service - so they prove the CONTRACT's `instanceAccess` modes actually
 * gate/filter as `.claude/rules/rlac.md` requires, independent of any DB.
 */

const STREAM_TYPE = "logstream.stream";
const READ_RULE = "logstream.stream.read";
const MANAGE_RULE = "logstream.stream.manage";

const stream = (id: string, name: string): LogStream => ({
  id,
  name,
  description: null,
  config: DEFAULT_LOG_STREAM_CONFIG,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const STREAM_1 = stream("stream-1", "Payments logs");
const STREAM_2 = stream("stream-2", "Checkout logs");

const userPattern = (id: string, streamId: string): LogPattern => ({
  id,
  streamId,
  template: "user <*>",
  tokenCount: 2,
  firstSeenAt: new Date("2026-01-01T00:00:00Z"),
  lastSeenAt: new Date("2026-01-01T00:00:00Z"),
  sampleBody: "user <*>",
  totalCount: 0,
  severityMax: 0,
  band: bandFromSeverityNumber(0),
  origin: "user",
  hidden: false,
});

const event = (id: string, streamId: string): LogEvent => ({
  id,
  streamId,
  ts: new Date("2026-01-01T00:00:00Z"),
  observedAt: new Date("2026-01-01T00:00:00Z"),
  severityNumber: 9,
  severityText: null,
  band: "info",
  body: "correlated line",
  attributes: null,
  resource: null,
  patternId: null,
  traceId: "trace-x",
  spanId: null,
});

const token = (id: string, streamId: string): LogStreamToken => ({
  id,
  streamId,
  name: "shipper",
  tokenPrefix: "ckls_abc",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  lastUsedAt: null,
  revokedAt: null,
});

/** A LogstreamService stub: canned reads, overridable per test. */
function stubService(overrides: Partial<LogstreamService> = {}): LogstreamService {
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
          last24hErrorCount: 3,
          last24hWarnCount: 1,
          patternCount: 5,
        },
        {
          id: STREAM_2.id,
          lastReceivedAt: null,
          last24hErrorCount: 0,
          last24hWarnCount: 0,
          patternCount: 0,
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
      secret: "ckls_secret_value",
      token: token("tok-1", streamId),
    }),
    revokeToken: async () => {},
    searchEvents: async () => ({ events: [], nextCursor: null }),
    findEventsByTraceId: async () => ({
      matches: [
        {
          id: STREAM_1.id,
          streamName: STREAM_1.name,
          events: [event("1", STREAM_1.id)],
        },
        {
          id: STREAM_2.id,
          streamName: STREAM_2.name,
          events: [event("2", STREAM_2.id)],
        },
      ],
    }),
    getSeverityBuckets: notImplemented("getSeverityBuckets"),
    getPatternBuckets: notImplemented("getPatternBuckets"),
    listPatterns: async () => [],
    createPattern: async ({ streamId, template }) => ({
      ...userPattern("created-pattern", streamId),
      template,
    }),
    deletePattern: async () => {},
    setPatternHidden: async ({ streamId, patternId, hidden }) => ({
      ...userPattern(patternId, streamId),
      hidden,
    }),
    testPattern: async () => ({ matchCount: 0, samples: [] }),
    maskLine: async ({ body }) => ({ template: body }),
    listPatternVariables: async () => ({
      variables: [],
      summaryWindowSeconds: 86_400,
    }),
    listImportantEvents: async () => ({ events: [], nextCursor: null }),
    getStreamOverview: notImplemented("getStreamOverview"),
    ...overrides,
  };
}

const buildRouter = (overrides?: Partial<LogstreamService>) =>
  createLogstreamRouter({ service: stubService(overrides) });

/** A team-scoped principal holding only the grants an override resolves. */
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
  it("a global read-rule holder sees every summary", async () => {
    const context = createMockRpcContext({
      user: { type: "user", id: "admin", accessRules: [READ_RULE] },
    });
    const result = await call(
      buildRouter().listStreamSummaries,
      {},
      { context },
    );
    expect(result.summaries.map((s) => s.id)).toEqual(["stream-1", "stream-2"]);
  });

  it("a team-scoped caller sees ONLY summaries their team is granted", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    const result = await call(
      buildRouter().listStreamSummaries,
      {},
      { context },
    );
    expect(result.summaries.map((s) => s.id)).toEqual(["stream-1"]);
    expect(result.summaries[0]!.last24hErrorCount).toBe(3);
  });
});

describe("getStream (idParam) authorization", () => {
  it("allows a granted id", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    const result = await call(
      buildRouter().getStream,
      { id: "stream-1" },
      { context },
    );
    expect(result.id).toBe("stream-1");
  });

  it("denies an ungranted id with FORBIDDEN", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    await expect(
      call(buildRouter().getStream, { id: "stream-2" }, { context }),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });
});

describe("searchEvents (idParam read) authorization", () => {
  it("denies an ungranted streamId with FORBIDDEN", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    await expect(
      call(
        buildRouter().searchEvents,
        { streamId: "stream-2", limit: 100 },
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
      buildRouter().searchEvents,
      { streamId: "stream-1", limit: 100 },
      { context },
    );
    expect(result.events).toEqual([]);
  });
});

describe("findEventsByTraceId (listKey 'matches') post-filter", () => {
  // from/to are REQUIRED by the contract; the stub ignores them but they must
  // be present for the input to validate.
  const WINDOW = {
    from: new Date("2026-01-01T00:00:00Z"),
    to: new Date("2026-01-01T01:00:00Z"),
  };

  it("a team-scoped caller sees only matches on granted streams (keyed on item id)", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-2"]),
    });
    const result = await call(
      buildRouter().findEventsByTraceId,
      { traceId: "trace-x", ...WINDOW, limitPerStream: 50 },
      { context },
    );
    expect(result.matches.map((m) => m.id)).toEqual(["stream-2"]);
  });

  it("a global read-rule holder sees every stream the trace appears in", async () => {
    const context = createMockRpcContext({
      user: { type: "user", id: "admin", accessRules: [READ_RULE] },
    });
    const result = await call(
      buildRouter().findEventsByTraceId,
      { traceId: "trace-x", ...WINDOW, limitPerStream: 50 },
      { context },
    );
    expect(result.matches.map((m) => m.id)).toEqual(["stream-1", "stream-2"]);
  });

  it("the contract REQUIRES the time window (from/to) - a missing window is rejected", () => {
    // The required window is what keeps every scan ts-bounded (DoS guard); the
    // schema must reject an input without it.
    expect(
      FindEventsByTraceIdSchema.safeParse({ traceId: "trace-x" }).success,
    ).toBe(false);
    expect(
      FindEventsByTraceIdSchema.safeParse({
        traceId: "trace-x",
        from: new Date(),
        to: new Date(),
      }).success,
    ).toBe(true);
  });
});

describe("token mint/revoke gated on manage", () => {
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
    expect(result.secret).toBe("ckls_secret_value");
  });

  it("no grant on the stream is FORBIDDEN for mint", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth([]),
    });
    await expect(
      call(
        buildRouter().mintToken,
        { streamId: "stream-1", name: "shipper" },
        { context },
      ),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });

  it("no grant on the stream is FORBIDDEN for revoke", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth([]),
    });
    await expect(
      call(
        buildRouter().revokeToken,
        { streamId: "stream-1", tokenId: "tok-1" },
        { context },
      ),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });
});

describe("listTokens never leaks the secret/hash", () => {
  it("a manage grant lists tokens without any secret material", async () => {
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
      pluginMetadata: { pluginId: "logstream" },
      auth: {
        authorizeCreate: mock(async () => ({
          ownerTeamId: "team-42",
          isPrivate: false,
        })),
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
        authorizeCreate: mock(async () => ({
          ownerTeamId: null,
          isPrivate: false,
        })),
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

describe("createPattern/deletePattern gated on manage (idParam streamId)", () => {
  it("a manage grant on the stream may create a pattern", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    const result = await call(
      buildRouter().createPattern,
      { streamId: "stream-1", template: "user <*>" },
      { context },
    );
    expect(result.id).toBe("created-pattern");
    expect(result.origin).toBe("user");
  });

  it("no grant on the stream is FORBIDDEN for createPattern", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth([]),
    });
    await expect(
      call(
        buildRouter().createPattern,
        { streamId: "stream-1", template: "user <*>" },
        { context },
      ),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });

  it("a grant on another stream cannot create on this stream (cross-stream denial)", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-2"]),
    });
    await expect(
      call(
        buildRouter().createPattern,
        { streamId: "stream-1", template: "user <*>" },
        { context },
      ),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });

  it("a manage grant on the stream may delete a pattern", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    await expect(
      call(
        buildRouter().deletePattern,
        { streamId: "stream-1", patternId: "p-1" },
        { context },
      ),
    ).resolves.toBeUndefined();
  });

  it("no grant on the stream is FORBIDDEN for deletePattern", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth([]),
    });
    await expect(
      call(
        buildRouter().deletePattern,
        { streamId: "stream-1", patternId: "p-1" },
        { context },
      ),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });

  it("a manage grant on the stream may hide a pattern", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    const result = await call(
      buildRouter().setPatternHidden,
      { streamId: "stream-1", patternId: "p-1", hidden: true },
      { context },
    );
    expect(result.hidden).toBe(true);
  });

  it("no grant on the stream is FORBIDDEN for setPatternHidden", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth([]),
    });
    await expect(
      call(
        buildRouter().setPatternHidden,
        { streamId: "stream-1", patternId: "p-1", hidden: true },
        { context },
      ),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });
});

describe("testPattern/listPatternVariables gated on read (idParam streamId)", () => {
  it("a read grant on the stream may dry-run a pattern", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    const result = await call(
      buildRouter().testPattern,
      { streamId: "stream-1", template: "user <*>", sampleLimit: 100 },
      { context },
    );
    expect(result.matchCount).toBe(0);
  });

  it("a grant on another stream cannot dry-run on this stream (cross-stream denial)", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-2"]),
    });
    await expect(
      call(
        buildRouter().testPattern,
        { streamId: "stream-1", template: "user <*>", sampleLimit: 100 },
        { context },
      ),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });

  it("a read grant on the stream may list pattern variables", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    const result = await call(
      buildRouter().listPatternVariables,
      { streamId: "stream-1", patternId: "p-1" },
      { context },
    );
    expect(result.variables).toEqual([]);
  });

  it("no grant on the stream is FORBIDDEN for listPatternVariables", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth([]),
    });
    await expect(
      call(
        buildRouter().listPatternVariables,
        { streamId: "stream-1", patternId: "p-1" },
        { context },
      ),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });

  it("a read grant on the stream may mask a line", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    const result = await call(
      buildRouter().maskLine,
      { streamId: "stream-1", body: "user logged in 42" },
      { context },
    );
    expect(result.template).toBe("user logged in 42");
  });

  it("a grant on another stream cannot mask on this stream (cross-stream denial)", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-2"]),
    });
    await expect(
      call(
        buildRouter().maskLine,
        { streamId: "stream-1", body: "user logged in 42" },
        { context },
      ),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });
});
