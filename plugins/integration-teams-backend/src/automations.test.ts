/**
 * Behaviour tests for the Teams automation action.
 *
 * The ConnectionStore is faked; fetch is stubbed in-process so we can
 * drive `teams.post_message.execute` through:
 *   1. OAuth client-credentials token fetch
 *   2. Microsoft Graph POST to `/teams/.../channels/.../messages`
 *
 * The action wraps the operator-authored body in a minimal Adaptive
 * Card before posting — we assert that wrapping here.
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import { createMockLogger } from "@checkstack/test-utils-backend";
import {
  connectionStoreRef,
  type ConnectionStore,
} from "@checkstack/integration-backend";
import type { RpcClient, ServiceRef } from "@checkstack/backend-api";

import {
  createTeamsActions,
  teamsMessageArtifactType,
} from "./automations";

const logger = createMockLogger() as Logger;

interface CapturedFetchCall {
  url: string;
  init: RequestInit;
}

interface StagedResponse {
  body?: unknown;
  status?: number;
  raw?: string;
}

function setupFetchSequence(responses: StagedResponse[]) {
  const calls: CapturedFetchCall[] = [];
  const originalFetch = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses[i++] ?? { body: {}, status: 200 };
    return new Response(
      next.raw !== undefined ? next.raw : JSON.stringify(next.body ?? {}),
      {
        status: next.status ?? 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function makeConnectionStore(): ConnectionStore {
  return {
    listConnections: mock(async () => []),
    getConnection: mock(async () => undefined),
    getConnectionWithCredentials: mock(async (id: string) =>
      id === "conn-1"
        ? {
            id: "conn-1",
            providerId: "teams",
            name: "Tenant",
            config: {
              tenantId: "tenant-1",
              clientId: "client-1",
              clientSecret: "client-secret",
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : undefined,
    ),
    createConnection: mock(async () => {
      throw new Error("not implemented in stub");
    }),
    updateConnection: mock(async () => {
      throw new Error("not implemented in stub");
    }),
    deleteConnection: mock(async () => false),
    findConnectionProvider: mock(async () => undefined),
  } as unknown as ConnectionStore;
}

let fetchFixture: ReturnType<typeof setupFetchSequence> | undefined;

beforeEach(() => {
  fetchFixture?.restore();
  fetchFixture = undefined;
});

function makeCtx(store: ConnectionStore) {
  return {
    runId: "run-1",
    automationId: "auto-1",
    contextKey: null,
    logger,
    getService: async <T,>(ref: ServiceRef<T>): Promise<T> => {
      if (ref.id === connectionStoreRef.id) {
        return store as unknown as T;
      }
      throw new Error(`Unstubbed service requested: ${ref.id}`);
    },
    rpcClient: { forPlugin: () => ({}) } as unknown as RpcClient,
  };
}

const ctxBase = makeCtx(makeConnectionStore());

describe("teamsMessageArtifactType", () => {
  it("validates the canonical artifact shape", () => {
    const ok = teamsMessageArtifactType.schema.safeParse({
      messageId: "msg-1",
      teamId: "team-1",
      channelId: "ch-1",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects when teamId is missing", () => {
    const bad = teamsMessageArtifactType.schema.safeParse({
      messageId: "msg-1",
      channelId: "ch-1",
    });
    expect(bad.success).toBe(false);
  });
});

describe("teams.post_message", () => {
  it("posts an adaptive card and emits a teams.message artifact", async () => {
    fetchFixture = setupFetchSequence([
      { body: { access_token: "tok-1", expires_in: 3600 } },
      { body: { id: "msg-42" } },
    ]);
    const actions = createTeamsActions();
    const post = actions[0]!;
    const result = await post.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        connectionId: "conn-1",
        teamId: "team-1",
        channelId: "ch-1",
        title: "Heads up",
        body: "Something happened",
      } as never,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.externalId).toBe("msg-42");
    const artifact = result.artifact as {
      messageId: string;
      teamId: string;
      channelId: string;
    };
    expect(artifact).toEqual({
      messageId: "msg-42",
      teamId: "team-1",
      channelId: "ch-1",
    });

    // First call: token endpoint.
    const tokenCall = fetchFixture.calls[0]!;
    expect(tokenCall.url).toContain(
      "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token",
    );
    expect(tokenCall.init.method).toBe("POST");

    // Second call: Graph messages endpoint with the bearer token.
    const graphCall = fetchFixture.calls[1]!;
    expect(graphCall.url).toBe(
      "https://graph.microsoft.com/v1.0/teams/team-1/channels/ch-1/messages",
    );
    const headers = graphCall.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-1");
    const body = JSON.parse(graphCall.init.body as string) as {
      attachments: Array<{ content: string }>;
    };
    const card = JSON.parse(body.attachments[0]!.content) as {
      type: string;
      body: Array<{ text: string }>;
    };
    expect(card.type).toBe("AdaptiveCard");
    expect(card.body[0]!.text).toBe("Heads up");
    expect(card.body[1]!.text).toBe("Something happened");
  });

  it("omits the title TextBlock when title is not provided", async () => {
    fetchFixture = setupFetchSequence([
      { body: { access_token: "tok-1", expires_in: 3600 } },
      { body: { id: "msg-99" } },
    ]);
    const actions = createTeamsActions();
    const post = actions[0]!;
    const result = await post.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        connectionId: "conn-1",
        teamId: "team-1",
        channelId: "ch-1",
        body: "Just the body",
      } as never,
    });
    expect(result.success).toBe(true);
    const graphCall = fetchFixture.calls[1]!;
    const body = JSON.parse(graphCall.init.body as string) as {
      attachments: Array<{ content: string }>;
    };
    const card = JSON.parse(body.attachments[0]!.content) as {
      body: Array<{ text: string }>;
    };
    expect(card.body).toHaveLength(1);
    expect(card.body[0]!.text).toBe("Just the body");
  });

  it("returns failure when the connection is missing", async () => {
    const actions = createTeamsActions();
    const post = actions[0]!;
    const result = await post.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        connectionId: "missing",
        teamId: "team-1",
        channelId: "ch-1",
        body: "x",
      } as never,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/connection not found/i);
  });

  it("returns failure when the token request fails", async () => {
    fetchFixture = setupFetchSequence([
      { status: 401, raw: "invalid_client" },
    ]);
    const actions = createTeamsActions();
    const post = actions[0]!;
    const result = await post.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        connectionId: "conn-1",
        teamId: "team-1",
        channelId: "ch-1",
        body: "x",
      } as never,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/Authentication failed/);
    expect(result.error).toMatch(/Token request failed \(401\)/);
  });

  it("returns failure when the Graph POST responds non-OK", async () => {
    fetchFixture = setupFetchSequence([
      { body: { access_token: "tok-1", expires_in: 3600 } },
      { status: 403, raw: "forbidden" },
    ]);
    const actions = createTeamsActions();
    const post = actions[0]!;
    const result = await post.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        connectionId: "conn-1",
        teamId: "team-1",
        channelId: "ch-1",
        body: "x",
      } as never,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/Graph API error \(403\)/);
    expect(result.error).toMatch(/forbidden/);
  });
});
