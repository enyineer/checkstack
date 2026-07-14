import { describe, it, expect, mock } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createMockRpcContext } from "@checkstack/backend-api";
import type { RpcContext } from "@checkstack/backend-api";
import {
  DEFAULT_METRIC_STREAM_CONFIG,
  type MetricScrapeTarget,
  type MetricStream,
  type MetricStreamToken,
  type UpdateScrapeTarget,
} from "@checkstack/metricstream-common";
import { createMetricstreamRouter } from "./router";
import type { MetricstreamService } from "./service";
import type { SatelliteBindingAuthorizer } from "../satellite/binding-auth";

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

const token = (id: string, streamId: string): MetricStreamToken => ({
  id,
  streamId,
  name: "shipper",
  tokenPrefix: "ckms_abc",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  lastUsedAt: null,
  revokedAt: null,
});

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
    listTokens: async ({ streamId }) => [token("tok-1", streamId)],
    mintToken: async ({ streamId }) => ({
      secret: "ckms_secret_value",
      token: token("tok-1", streamId),
    }),
    revokeToken: async () => {},
    listScrapeTargets: async () => [],
    createScrapeTarget: async (input) => ({
      id: "target-1",
      streamId: input.streamId,
      name: input.name,
      url: input.url,
      intervalSeconds: input.intervalSeconds,
      timeoutMs: input.timeoutMs,
      enabled: input.enabled,
      satelliteId: input.satelliteId ?? null,
      hasBearerToken: false,
      lastScrapeAt: null,
      lastError: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    }),
    updateScrapeTarget: notImplemented("updateScrapeTarget"),
    deleteScrapeTarget: async () => {},
    listMetricNames: async () => ({ names: [] }),
    listLabelKeys: async () => ({ keys: [] }),
    listLabelValues: async () => ({ values: [] }),
    listMetricSeries: async () => ({ series: [] }),
    getMetricBuckets: async ({ grain }) => ({ grain: grain ?? "minute", points: [] }),
    listImportantEvents: async () => ({ events: [], nextCursor: null }),
    getStreamOverview: notImplemented("getStreamOverview"),
    ...overrides,
  };
}

/** By default the satellite-binding authorizer is a no-op (allow) so the
 * RLAC tests focus on the stream gate; the SAT-C block below injects its own. */
const buildRouter = (
  overrides?: Partial<MetricstreamService>,
  assertSatelliteBindable: SatelliteBindingAuthorizer = async () => {},
) =>
  createMetricstreamRouter({
    service: stubService(overrides),
    assertSatelliteBindable,
  });

const scrapeTargetDto = (
  input: { streamId: string; satelliteId?: string | null },
): MetricScrapeTarget => ({
  id: "target-1",
  streamId: input.streamId,
  name: "prom",
  url: "https://example.com/metrics",
  intervalSeconds: 60,
  timeoutMs: 10_000,
  enabled: true,
  satelliteId: input.satelliteId ?? null,
  hasBearerToken: false,
  lastScrapeAt: null,
  lastError: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
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
    expect(result.secret).toBe("ckms_secret_value");
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
});

describe("scrape targets gated on manage (idParam streamId)", () => {
  it("a manage grant may create a scrape target", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-1"]),
    });
    const result = await call(
      buildRouter().createScrapeTarget,
      {
        streamId: "stream-1",
        name: "prom",
        url: "https://example.com/metrics",
        intervalSeconds: 60,
        timeoutMs: 10_000,
        enabled: true,
      },
      { context },
    );
    expect(result.streamId).toBe("stream-1");
  });

  it("a grant on another stream cannot create here (cross-stream denial)", async () => {
    const context = createMockRpcContext({
      user: teamUser,
      ...grantAuth(["stream-2"]),
    });
    await expect(
      call(
        buildRouter().createScrapeTarget,
        {
          streamId: "stream-1",
          name: "prom",
          url: "https://example.com/metrics",
          intervalSeconds: 60,
          timeoutMs: 10_000,
          enabled: true,
        },
        { context },
      ),
    ).rejects.toThrow(/FORBIDDEN|Access denied/i);
  });
});

describe("scrape-target satellite binding authorization (SAT-C SSRF fix)", () => {
  const ctx = () =>
    createMockRpcContext({ user: teamUser, ...grantAuth(["stream-1"]) });
  const createInput = (satelliteId?: string | null) => ({
    streamId: "stream-1",
    name: "prom",
    url: "https://example.com/metrics",
    intervalSeconds: 60,
    timeoutMs: 10_000,
    enabled: true,
    ...(satelliteId === undefined ? {} : { satelliteId }),
  });
  const updateInput = (satelliteId?: string | null): UpdateScrapeTarget => ({
    streamId: "stream-1",
    targetId: "target-1",
    ...(satelliteId === undefined ? {} : { satelliteId }),
  });
  const bindingService = () =>
    stubService({
      createScrapeTarget: async (input) => scrapeTargetDto(input),
      updateScrapeTarget: async (input) => scrapeTargetDto(input),
    });

  /** Run and return the ORPCError it rejects with (asserting its `code`, not the
   * message - the authorizer's FORBIDDEN carries a human message, not "FORBIDDEN"). */
  async function rejectedCode(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      return (error as ORPCError<string, unknown>).code;
    }
    throw new Error("expected the call to reject");
  }

  it("create: authorizes the binding and binds on success", async () => {
    const authz = mock<SatelliteBindingAuthorizer>(async () => {});
    const router = createMetricstreamRouter({
      service: bindingService(),
      assertSatelliteBindable: authz,
    });
    const result = await call(router.createScrapeTarget, createInput("sat-1"), {
      context: ctx(),
    });
    expect(authz).toHaveBeenCalledTimes(1);
    expect(authz.mock.calls[0]![0]!.satelliteId).toBe("sat-1");
    expect(result.satelliteId).toBe("sat-1");
  });

  it("create: a FORBIDDEN from the authorizer blocks the bind and never persists", async () => {
    const created = mock(async (input: { streamId: string }) =>
      scrapeTargetDto(input),
    );
    const authz = mock<SatelliteBindingAuthorizer>(async () => {
      throw new ORPCError("FORBIDDEN", { message: "no read access" });
    });
    const router = createMetricstreamRouter({
      service: stubService({ createScrapeTarget: created }),
      assertSatelliteBindable: authz,
    });
    expect(
      await rejectedCode(
        call(router.createScrapeTarget, createInput("other-team-sat"), {
          context: ctx(),
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(created).not.toHaveBeenCalled();
  });

  it("create: a BAD_REQUEST (unknown / non-scrape satellite) blocks the bind", async () => {
    const authz = mock<SatelliteBindingAuthorizer>(async () => {
      throw new ORPCError("BAD_REQUEST", { message: "Satellite not found." });
    });
    const router = createMetricstreamRouter({
      service: bindingService(),
      assertSatelliteBindable: authz,
    });
    await expect(
      call(router.createScrapeTarget, createInput("ghost"), { context: ctx() }),
    ).rejects.toThrow(/BAD_REQUEST|not found/i);
  });

  it("update (rebind): authorizes, and a FORBIDDEN blocks it", async () => {
    const okAuthz = mock<SatelliteBindingAuthorizer>(async () => {});
    await call(
      createMetricstreamRouter({
        service: bindingService(),
        assertSatelliteBindable: okAuthz,
      }).updateScrapeTarget,
      updateInput("sat-1"),
      { context: ctx() },
    );
    expect(okAuthz).toHaveBeenCalledTimes(1);
    expect(okAuthz.mock.calls[0]![0]!.satelliteId).toBe("sat-1");

    const denyAuthz = mock<SatelliteBindingAuthorizer>(async () => {
      throw new ORPCError("FORBIDDEN", { message: "no read access" });
    });
    expect(
      await rejectedCode(
        call(
          createMetricstreamRouter({
            service: bindingService(),
            assertSatelliteBindable: denyAuthz,
          }).updateScrapeTarget,
          updateInput("other-team-sat"),
          { context: ctx() },
        ),
      ),
    ).toBe("FORBIDDEN");
  });

  it("does NOT authorize when satelliteId is absent (core) or null (unbind)", async () => {
    const authz = mock<SatelliteBindingAuthorizer>(async () => {});
    const router = createMetricstreamRouter({
      service: bindingService(),
      assertSatelliteBindable: authz,
    });
    // create scraped from core (no satelliteId)
    await call(router.createScrapeTarget, createInput(), { context: ctx() });
    // update unbind (explicit null)
    await call(router.updateScrapeTarget, updateInput(null), { context: ctx() });
    expect(authz).not.toHaveBeenCalled();
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
