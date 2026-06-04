/**
 * Behaviour tests for the Webex automation action.
 *
 * The ConnectionStore is faked; fetch is stubbed in-process so we can
 * exercise the full action.execute flow including the connection
 * lookup + Graph-style response mapping.
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
  createWebexActions,
  webexMessageArtifactType,
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
            providerId: "webex",
            name: "Webex Bot",
            config: { botToken: "secret-bot-token" },
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

describe("webexMessageArtifactType", () => {
  it("validates the canonical artifact shape", () => {
    const ok = webexMessageArtifactType.schema.safeParse({
      messageId: "msg-1",
      roomId: "room-1",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects when messageId is missing", () => {
    const bad = webexMessageArtifactType.schema.safeParse({
      roomId: "room-1",
    });
    expect(bad.success).toBe(false);
  });
});

describe("webex.post_message", () => {
  it("posts a markdown message and emits a webex.message artifact", async () => {
    fetchFixture = setupFetchSequence([{ body: { id: "msg-42" } }]);
    const actions = createWebexActions();
    const post = actions[0]!;
    const result = await post.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        connectionId: "conn-1",
        roomId: "room-1",
        markdown: "**hello**",
      } as never,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.externalId).toBe("msg-42");
    const artifact = result.artifact as { messageId: string; roomId: string };
    expect(artifact.messageId).toBe("msg-42");
    expect(artifact.roomId).toBe("room-1");
    const call = fetchFixture.calls[0]!;
    expect(call.url).toBe("https://webexapis.com/v1/messages");
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-bot-token");
    const body = JSON.parse(call.init.body as string) as {
      roomId: string;
      markdown: string;
    };
    expect(body.roomId).toBe("room-1");
    expect(body.markdown).toBe("**hello**");
  });

  it("returns failure when the connection is missing", async () => {
    const actions = createWebexActions();
    const post = actions[0]!;
    const result = await post.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        connectionId: "missing",
        roomId: "room-1",
        markdown: "x",
      } as never,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/connection not found/i);
  });

  it("returns failure when the Webex API responds non-OK", async () => {
    fetchFixture = setupFetchSequence([
      { status: 400, raw: "bad request" },
    ]);
    const actions = createWebexActions();
    const post = actions[0]!;
    const result = await post.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        connectionId: "conn-1",
        roomId: "room-1",
        markdown: "x",
      } as never,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/Webex API error \(400\)/);
    expect(result.error).toMatch(/bad request/);
  });
});
