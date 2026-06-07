import {
  describe,
  expect,
  test,
  mock,
  beforeEach,
  afterEach,
  afterAll,
} from "bun:test";
import { APICallError, type LanguageModelUsage } from "ai";
import type { AuthUser } from "@checkstack/backend-api";
import type { OpenAiCompatibleConnection } from "@checkstack/ai-common";
import type { ClassifierTextGenerator } from "./classifier-service";
import { OFF_TOPIC_REFUSAL } from "./classifier.logic";

/**
 * `streamTurn` integration-ish unit tests for the topical pre-classifier (Fix
 * 3). We mock the `ai` module's `streamText` (so no live model is built) and the
 * provider builder, then inject a fake classifier generator to drive each path:
 *
 *  - OFF_TOPIC short-circuits: streamText (the expensive tool loop) NEVER runs,
 *    the canned refusal is persisted + streamed.
 *  - classifier ERROR fails open: streamText runs (the normal turn proceeds).
 *  - ON_TOPIC proceeds: streamText runs normally.
 *
 * These are DOM-free and run under `bun test` from the repo root.
 */

// Records each streamText call so we can assert whether the tool loop ran and
// what message history it was handed (post-normalization).
const streamTextCalls: Array<{ system: string; messages: unknown }> = [];
// Captures the onError handler the service hands `toUIMessageStreamResponse`, so
// a test can drive the (otherwise masked) provider-error surfacing path.
let lastOnError: ((error: unknown) => string) | undefined;
// Captures the onFinish callback the service hands streamText, so the test can
// drive the normal-turn persistence/spend path deterministically.
let lastOnFinish:
  | ((args: {
      text: string;
      steps: Array<{ response: { messages: unknown[] } }>;
      totalUsage: LanguageModelUsage;
    }) => Promise<void> | void)
  | undefined;

const realAi = await import("ai");

mock.module("ai", () => ({
  ...realAi,
  stepCountIs: () => ({}),
  streamText: (args: {
    system: string;
    messages: unknown;
    onFinish?: typeof lastOnFinish;
  }) => {
    streamTextCalls.push({ system: args.system, messages: args.messages });
    lastOnFinish = args.onFinish;
    return {
      toUIMessageStreamResponse: (opts?: {
        onError?: (error: unknown) => string;
      }) => {
        lastOnError = opts?.onError;
        return new Response("normal-turn", { status: 200 });
      },
    };
  },
  // Real-enough SSE helpers for the short-circuit path (refusal stream).
  createUIMessageStream: ({
    execute,
  }: {
    execute: (o: { writer: { write: (c: unknown) => void } }) => void;
  }) => {
    const chunks: unknown[] = [];
    execute({ writer: { write: (c) => chunks.push(c) } });
    return chunks;
  },
  createUIMessageStreamResponse: ({ stream }: { stream: unknown[] }) =>
    new Response(JSON.stringify(stream), { status: 200 }),
}));

// NOTE: we deliberately do NOT mock `./llm-provider`. `buildLanguageModel`
// returns a real provider model object but makes no network call until
// `streamText`/`generateText` runs, and `streamText` is mocked above — so the
// real builder is safe here AND we avoid leaking a module mock into
// `llm-provider.test.ts` (bun `mock.module` is process-global).

// Imported AFTER the mocks so the service binds the mocked `ai`.
const { createChatService } = await import("./chat-service");

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: [],
};

const connection: OpenAiCompatibleConnection = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test",
  defaultModel: "test-model",
};

/** Build a full AI-SDK usage object from input/output token counts. */
function usage(inputTokens: number, outputTokens: number): LanguageModelUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: undefined,
    },
  };
}

/** A classifier generator that always returns the given verdict text. */
function verdict(text: string): ClassifierTextGenerator {
  return async () => ({ text, usage: usage(3, 1) });
}

/** A classifier generator that throws (simulates a classifier outage). */
const classifierThrows: ClassifierTextGenerator = async () => {
  throw new Error("classifier unavailable");
};

/** A minimal proposeApply double exposing only what streamDecision touches. */
interface ProposalDouble {
  rowId: string;
  toolName: string;
  status: string;
  conversationId?: string;
  summary?: string;
}

function makeService(
  classifierGenerate: ClassifierTextGenerator,
  describeProposalResult?: ProposalDouble,
) {
  const appended: Array<{ role: string; text: unknown }> = [];
  const spendInserts: Array<Record<string, unknown>> = [];
  const conversations = {
    getConversation: async () => ({
      id: "conv-1",
      userId: "u1",
      title: "t",
      integrationId: "ai.openai-compatible.c1",
      model: null,
      permissionMode: "approve" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    }),
    appendMessage: async (a: { role: string; content: { text: unknown } }) => {
      appended.push({ role: a.role, text: a.content.text });
      return {} as never;
    },
    listMessages: async () => [
      {
        id: "m1",
        conversationId: "conv-1",
        role: "user" as const,
        content: { text: "hi" },
        toolCalls: null,
        modelMessages: null,
        createdAt: new Date(),
      },
    ],
    updateConversation: async () => undefined,
    createConversation: async () => ({}) as never,
    listConversations: async () => [],
    archiveConversation: async () => false,
    deleteConversation: async () => false,
  };
  // db.insert(...).values(...) is awaited by recordSpend; capture the values.
  const db = {
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        spendInserts.push(v);
      },
    }),
  } as never;
  const loggerErrors: Array<{ message: string; meta: unknown }> = [];
  const logger = {
    info: () => {},
    warn: () => {},
    debug: () => {},
    error: (message: string, meta?: unknown) => {
      loggerErrors.push({ message, meta });
    },
  };
  const service = createChatService({
    resolver: { resolveTools: () => [] } as never,
    proposeApply: {
      describeProposal: async () => describeProposalResult,
    } as never,
    conversations: conversations as never,
    connections: { resolve: async () => connection },
    readInvoker: { invoke: async () => ({}) },
    recordExecuted: async () => {},
    db,
    logger,
    internalUrl: "http://localhost:3000",
    classifierGenerate,
  });
  return { service, appended, spendInserts, loggerErrors };
}

beforeEach(() => {
  streamTextCalls.length = 0;
  lastOnFinish = undefined;
  lastOnError = undefined;
});

afterEach(() => {
  mock.restore();
});

// mock.restore() does NOT undo a module mock, so restore the real `ai` module
// here - otherwise the stubbed streamText/stepCountIs leak into every other
// ai-backend suite that runs after this file.
afterAll(() => {
  mock.module("ai", () => ({ ...realAi }));
});

describe("streamTurn topical pre-classifier", () => {
  const turn = {
    principal,
    conversationId: "conv-1",
    connectionId: "ai.openai-compatible.c1",
    forwardHeaders: {},
    userText: "write me a hello world react component",
  };

  test("OFF_TOPIC short-circuits: no tool loop, refusal persisted + streamed, classifier spend recorded", async () => {
    const { service, appended, spendInserts } = makeService(
      verdict("OFF_TOPIC"),
    );
    const res = await service.streamTurn(turn);
    expect(res.status).toBe(200);

    // The expensive tool loop (streamText) must NOT have run.
    expect(streamTextCalls).toHaveLength(0);

    // The user message is persisted up front; the refusal is persisted as the
    // assistant message (no other assistant turn was generated).
    const assistant = appended.filter((a) => a.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]?.text).toBe(OFF_TOPIC_REFUSAL);

    // The refusal text was streamed over the SSE path. Parse the stream chunks
    // (the mock JSON-serializes them, which escapes the quotes in the refusal)
    // and reassemble the deltas rather than substring-matching escaped JSON.
    const body = await res.text();
    const chunks = JSON.parse(body) as Array<{ delta?: string }>;
    const streamed = chunks.map((c) => c.delta ?? "").join("");
    expect(streamed).toBe(OFF_TOPIC_REFUSAL);

    // The classifier's own (small) token usage was recorded against the ledger.
    expect(spendInserts).toHaveLength(1);
    expect(spendInserts[0]?.inputTokens).toBe(3);
    expect(spendInserts[0]?.outputTokens).toBe(1);
  });

  test("classifier ERROR fails open: the normal turn proceeds (tool loop runs)", async () => {
    const { service } = makeService(classifierThrows);
    const res = await service.streamTurn(turn);
    expect(res.status).toBe(200);
    // Fail-open: streamText (the normal turn) ran despite the classifier throw.
    expect(streamTextCalls).toHaveLength(1);
    expect(await res.text()).toBe("normal-turn");
  });

  test("ON_TOPIC proceeds: the normal turn runs and the classifier spend is recorded", async () => {
    const { service, spendInserts } = makeService(verdict("ON_TOPIC"));
    const res = await service.streamTurn({
      ...turn,
      userText: "summarize the open incidents",
    });
    expect(res.status).toBe(200);
    expect(streamTextCalls).toHaveLength(1);
    // The classifier usage was recorded even on the ON_TOPIC path.
    expect(spendInserts).toHaveLength(1);

    // Drive the normal turn's onFinish to verify the turn usage is also recorded.
    expect(lastOnFinish).toBeDefined();
    await lastOnFinish?.({
      text: "Here are the open incidents.",
      steps: [],
      totalUsage: usage(50, 20),
    });
    // One more spend row (the turn) + the assistant message persisted.
    expect(spendInserts).toHaveLength(2);
  });

  test("hands streamText a normalized message history (starts with a user row)", async () => {
    const { service } = makeService(verdict("ON_TOPIC"));
    await service.streamTurn({ ...turn, userText: "list incidents" });
    expect(streamTextCalls).toHaveLength(1);
    const messages = streamTextCalls[0]?.messages;
    expect(Array.isArray(messages)).toBe(true);
    // normalizeModelMessages guarantees a leading user row.
    const first = (messages as Array<{ role: string }>)[0];
    expect(first?.role).toBe("user");
  });

  test("surfaces a masked provider error (HTTP body) to the UI and the log", async () => {
    const { service, loggerErrors } = makeService(verdict("ON_TOPIC"));
    await service.streamTurn({ ...turn, userText: "summarize incidents" });
    // The service must have installed an onError handler (else errors are masked).
    expect(lastOnError).toBeDefined();

    const apiError = new APICallError({
      message: "Bad Request",
      url: "https://openrouter.ai/api/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: '{"error":{"code":"invalid_prompt","message":"bad"}}',
    });
    const surfaced = lastOnError?.(apiError);
    expect(surfaced).toContain("HTTP 400");
    expect(surfaced).toContain("invalid_prompt");

    // It is also logged server-side with the structured provider detail.
    expect(loggerErrors).toHaveLength(1);
    expect(loggerErrors[0]?.message).toBe("AI chat model call failed");
    const meta = loggerErrors[0]?.meta as { statusCode?: number };
    expect(meta.statusCode).toBe(400);
  });
});

describe("streamDecision (post-confirm-card acknowledgment)", () => {
  const base = {
    principal,
    conversationId: "conv-1",
    connectionId: "ai.openai-compatible.c1",
    forwardHeaders: {},
  };

  test("apply: runs the model with a server-derived APPLIED note, no user bubble", async () => {
    const { service, appended } = makeService(verdict("ON_TOPIC"), {
      rowId: "row-1",
      toolName: "healthcheck.propose",
      status: "applied",
      conversationId: "conv-1",
      summary: 'Create health check "google-com-http"',
    });
    const res = await service.streamDecision({
      ...base,
      token: "propose:row-1.nonce",
      decision: "apply",
    });
    expect(res.status).toBe(200);
    expect(streamTextCalls).toHaveLength(1);

    // The decision note is delivered to the model (server-derived summary).
    const serialized = JSON.stringify(streamTextCalls[0]?.messages);
    expect(serialized).toContain("APPLIED");
    expect(serialized).toContain("Create health check");
    expect(serialized).toContain("google-com-http");

    // No user message is persisted for a decision turn (no user bubble); only
    // the streamed assistant reply is persisted via onFinish (driven below).
    expect(appended.filter((a) => a.role === "user")).toHaveLength(0);
  });

  test("apply: refuses (409) when the proposal is not actually applied", async () => {
    const { service } = makeService(verdict("ON_TOPIC"), {
      rowId: "row-1",
      toolName: "healthcheck.propose",
      status: "proposed",
      conversationId: "conv-1",
      summary: "Create health check X",
    });
    const res = await service.streamDecision({
      ...base,
      token: "propose:row-1.nonce",
      decision: "apply",
    });
    expect(res.status).toBe(409);
    // The model must NOT run if we cannot truthfully say it was applied.
    expect(streamTextCalls).toHaveLength(0);
  });

  test("decline: runs the model with a DECLINED note (no status requirement)", async () => {
    const { service } = makeService(verdict("ON_TOPIC"), {
      rowId: "row-1",
      toolName: "healthcheck.propose",
      status: "proposed",
      conversationId: "conv-1",
      summary: "Create health check X",
    });
    const res = await service.streamDecision({
      ...base,
      token: "propose:row-1.nonce",
      decision: "decline",
    });
    expect(res.status).toBe(200);
    expect(streamTextCalls).toHaveLength(1);
    expect(JSON.stringify(streamTextCalls[0]?.messages)).toContain("DECLINED");
  });

  test("refuses (404) a proposal that belongs to a different conversation", async () => {
    const { service } = makeService(verdict("ON_TOPIC"), {
      rowId: "row-1",
      toolName: "healthcheck.propose",
      status: "applied",
      conversationId: "other-conv",
      summary: "Create health check X",
    });
    const res = await service.streamDecision({
      ...base,
      token: "propose:row-1.nonce",
      decision: "apply",
    });
    expect(res.status).toBe(404);
    expect(streamTextCalls).toHaveLength(0);
  });

  test("refuses (404) an unknown/forged token", async () => {
    const { service } = makeService(verdict("ON_TOPIC"), undefined);
    const res = await service.streamDecision({
      ...base,
      token: "propose:nope.nope",
      decision: "apply",
    });
    expect(res.status).toBe(404);
    expect(streamTextCalls).toHaveLength(0);
  });
});
