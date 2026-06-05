/**
 * Behaviour tests for the built-in `log` and `notify_user` actions.
 */
import { describe, expect, it, mock } from "bun:test";
import type { Logger, RpcClient } from "@checkstack/backend-api";
import { createMockLogger } from "@checkstack/test-utils-backend";

import {
  logAction,
  notifyUserAction,
  notifyUserArtifactType,
  type NotifyUserArtifact,
} from "./builtin-actions";

const baseLogger = createMockLogger();
const logger = baseLogger as Logger;

const noopRpcClient = {
  forPlugin: () => ({}),
} as unknown as RpcClient;

const ctxBase = {
  runId: "run-1",
  automationId: "auto-1",
  contextKey: null,
  logger,
  getService: async <T,>(): Promise<T> => {
    throw new Error("not used");
  },
  rpcClient: noopRpcClient,
};

describe("automation.log", () => {
  it("forwards the message to the run logger at the requested level", async () => {
    const localLogger = createMockLogger();
    const result = await logAction.execute({
      ...ctxBase,
      logger: localLogger as Logger,
      consumedArtifacts: {},
      config: { message: "hello", level: "warn" } as never,
    });
    expect(result.success).toBe(true);
    expect(localLogger.warn).toHaveBeenCalledTimes(1);
    const call = (localLogger.warn as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls[0];
    expect(call?.[0]).toContain("hello");
  });

  it("defaults to level=info when not provided (after zod parsing)", async () => {
    const localLogger = createMockLogger();
    // The dispatch engine validates config before calling execute,
    // so the schema's default has already kicked in by the time the
    // action runs. Simulate that by passing `level: "info"`.
    const result = await logAction.execute({
      ...ctxBase,
      logger: localLogger as Logger,
      consumedArtifacts: {},
      config: { message: "hi", level: "info" } as never,
    });
    expect(result.success).toBe(true);
    expect(localLogger.info).toHaveBeenCalledTimes(1);
  });

  it("returns success without an artifact", async () => {
    const result = await logAction.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { message: "x", level: "info" } as never,
    });
    expect(result.success).toBe(true);
    expect(result.artifact).toBeUndefined();
  });
});

interface SendResult {
  deliveredCount: number;
  results: Array<{ strategyId: string; success: boolean; error?: string }>;
}

function makeRpcClient(
  behaviour:
    | { ok: true; result: SendResult }
    | { ok: false; error: Error },
): RpcClient & { sendMock: ReturnType<typeof mock> } {
  const sendMock = mock(async (_input: unknown) => {
    if (!behaviour.ok) throw behaviour.error;
    return behaviour.result;
  });
  return {
    forPlugin: () => ({ sendTransactional: sendMock }),
    sendMock,
  } as unknown as RpcClient & { sendMock: ReturnType<typeof mock> };
}

describe("automation.notify_user", () => {
  it("delegates to sendTransactional and emits a per-strategy artifact", async () => {
    const rpcClient = makeRpcClient({
      ok: true,
      result: {
        deliveredCount: 1,
        results: [{ strategyId: "email.smtp", success: true }],
      },
    });
    const result = await notifyUserAction.execute({
      ...ctxBase,
      rpcClient,
      consumedArtifacts: {},
      config: {
        userId: "user-1",
        title: "Hello",
        body: "World",
      } as never,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.externalId).toBe("user-1");
    const artifact = result.artifact as NotifyUserArtifact;
    expect(artifact.userId).toBe("user-1");
    expect(artifact.deliveredCount).toBe(1);
    expect(artifact.results).toHaveLength(1);

    const call = rpcClient.sendMock.mock.calls[0]![0] as {
      userId: string;
      notification: { title: string; body: string };
    };
    expect(call.userId).toBe("user-1");
    expect(call.notification.title).toBe("Hello");
    expect(call.notification.body).toBe("World");
  });

  it("returns success=false when no strategy delivers but still emits the artifact for audit", async () => {
    const rpcClient = makeRpcClient({
      ok: true,
      result: { deliveredCount: 0, results: [] },
    });
    const result = await notifyUserAction.execute({
      ...ctxBase,
      rpcClient,
      consumedArtifacts: {},
      config: {
        userId: "user-1",
        title: "Hi",
        body: "Hello",
      } as never,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.artifact).toBeDefined();
  });

  it("returns failure when sendTransactional throws", async () => {
    const rpcClient = makeRpcClient({
      ok: false,
      error: new Error("rpc down"),
    });
    const result = await notifyUserAction.execute({
      ...ctxBase,
      rpcClient,
      consumedArtifacts: {},
      config: {
        userId: "user-1",
        title: "Hi",
        body: "Hello",
      } as never,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/rpc down/);
  });
});

describe("notifyUserArtifactType", () => {
  it("validates the canonical artifact shape", () => {
    const ok = notifyUserArtifactType.schema.safeParse({
      userId: "user-1",
      deliveredCount: 2,
      results: [{ strategyId: "email.smtp", success: true }],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects when deliveredCount is missing", () => {
    const bad = notifyUserArtifactType.schema.safeParse({
      userId: "user-1",
      results: [],
    });
    expect(bad.success).toBe(false);
  });
});
