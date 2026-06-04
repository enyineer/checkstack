/**
 * Behaviour tests for the notification automation triggers + send action.
 *
 * The triggers wrap two new hooks fired from `dispatchWithAttempt`,
 * so the surface tested here is dataclass-ish (payload validation +
 * contextKey extraction).
 *
 * The send action delegates to `notificationClient.sendTransactional`.
 * We mock the rpcClient.forPlugin(...) plumbing with a tiny shim so we
 * can exercise the happy / zero-deliveries / thrown-error paths and
 * lock down the artifact mapping.
 */
import { describe, expect, it, mock } from "bun:test";
import type { Logger, RpcClient } from "@checkstack/backend-api";
import { createMockLogger } from "@checkstack/test-utils-backend";

import {
  notificationSendAction,
  notificationDeliveredTrigger,
  notificationFailedTrigger,
  notificationSendArtifactType,
  notificationTriggers,
} from "./automations";

const logger = createMockLogger() as Logger;

const ctxBase = {
  runId: "run-1",
  automationId: "auto-1",
  contextKey: null,
  logger,
  getService: async <T,>(): Promise<T> => {
    throw new Error("not used");
  },
  rpcClient: { forPlugin: () => ({}) } as unknown as RpcClient,
};

// ─── Triggers ──────────────────────────────────────────────────────────

describe("notification triggers", () => {
  it("exposes two triggers in a stable order", () => {
    expect(notificationTriggers).toHaveLength(2);
    expect(notificationTriggers[0]).toBe(
      notificationDeliveredTrigger as (typeof notificationTriggers)[number],
    );
    expect(notificationTriggers[1]).toBe(
      notificationFailedTrigger as (typeof notificationTriggers)[number],
    );
  });

  it("extracts notificationId as the contextKey", () => {
    const delivered = {
      notificationId: "n-1",
      strategyQualifiedId: "email.smtp",
      durationMs: 42,
      timestamp: "2026-05-29T11:00:00Z",
    };
    expect(notificationDeliveredTrigger.contextKey?.(delivered)).toBe("n-1");

    const failed = {
      notificationId: "n-2",
      strategyQualifiedId: "webex.bot",
      errorMessage: "401 Unauthorized",
      durationMs: 12,
      timestamp: "2026-05-29T11:00:00Z",
    };
    expect(notificationFailedTrigger.contextKey?.(failed)).toBe("n-2");
  });

  it("rejects payloads missing required fields", () => {
    const bad = notificationFailedTrigger.payloadSchema.safeParse({
      notificationId: "n-2",
      strategyQualifiedId: "webex.bot",
      durationMs: 12,
      timestamp: "2026-05-29T11:00:00Z",
    });
    expect(bad.success).toBe(false);
  });
});

// ─── Artifact ──────────────────────────────────────────────────────────

describe("notificationSendArtifactType", () => {
  it("validates the canonical artifact shape", () => {
    const ok = notificationSendArtifactType.schema.safeParse({
      userId: "user-1",
      deliveredCount: 2,
      results: [
        { strategyId: "email.smtp", success: true },
        { strategyId: "webex.bot", success: false, error: "401" },
      ],
    });
    expect(ok.success).toBe(true);
  });
});

// ─── Action: notification.send ─────────────────────────────────────────

interface SendTransactionalResult {
  deliveredCount: number;
  results: Array<{ strategyId: string; success: boolean; error?: string }>;
}

function makeRpcClient(behaviour:
  | { ok: true; result: SendTransactionalResult }
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

describe("notification.send", () => {
  it("returns success when at least one strategy delivers and emits a per-strategy artifact", async () => {
    const rpcClient = makeRpcClient({
      ok: true,
      result: {
        deliveredCount: 1,
        results: [
          { strategyId: "email.smtp", success: true },
          { strategyId: "webex.bot", success: false, error: "401" },
        ],
      },
    });
    const send = notificationSendAction;

    const result = await send.execute({
      ...ctxBase,
      rpcClient,
      consumedArtifacts: {},
      config: {
        userId: "user-1",
        title: "Hi",
        body: "Hello",
      } as never,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.externalId).toBe("user-1");
    const artifact = result.artifact as {
      userId: string;
      deliveredCount: number;
      results: Array<{ strategyId: string; success: boolean }>;
    };
    expect(artifact.deliveredCount).toBe(1);
    expect(artifact.results).toHaveLength(2);

    // sendTransactional was called with the operator-supplied fields.
    const call = rpcClient.sendMock.mock.calls[0]![0] as {
      userId: string;
      notification: { title: string; body: string };
    };
    expect(call.userId).toBe("user-1");
    expect(call.notification.title).toBe("Hi");
    expect(call.notification.body).toBe("Hello");
  });

  it("returns success=false when no strategy delivered but still emits the artifact for audit", async () => {
    const rpcClient = makeRpcClient({
      ok: true,
      result: {
        deliveredCount: 0,
        results: [
          { strategyId: "email.smtp", success: false, error: "no contact" },
        ],
      },
    });
    const send = notificationSendAction;

    const result = await send.execute({
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
    const artifact = result.artifact as { deliveredCount: number };
    expect(artifact.deliveredCount).toBe(0);
  });

  it("forwards an action button to sendTransactional when both label + url are set", async () => {
    const rpcClient = makeRpcClient({
      ok: true,
      result: { deliveredCount: 1, results: [] },
    });
    const send = notificationSendAction;

    await send.execute({
      ...ctxBase,
      rpcClient,
      consumedArtifacts: {},
      config: {
        userId: "user-1",
        title: "Hi",
        body: "Hello",
        actionLabel: "Open",
        actionUrl: "https://example.com",
      } as never,
    });

    const call = rpcClient.sendMock.mock.calls[0]![0] as {
      notification: { action?: { label: string; url: string } };
    };
    expect(call.notification.action).toEqual({
      label: "Open",
      url: "https://example.com",
    });
  });

  it("omits the action object when only one of label/url is set", async () => {
    const rpcClient = makeRpcClient({
      ok: true,
      result: { deliveredCount: 1, results: [] },
    });
    const send = notificationSendAction;

    await send.execute({
      ...ctxBase,
      rpcClient,
      consumedArtifacts: {},
      config: {
        userId: "user-1",
        title: "Hi",
        body: "Hello",
        actionUrl: "https://example.com",
      } as never,
    });

    const call = rpcClient.sendMock.mock.calls[0]![0] as {
      notification: { action?: unknown };
    };
    expect(call.notification.action).toBeUndefined();
  });

  it("returns failure when sendTransactional throws", async () => {
    const rpcClient = makeRpcClient({
      ok: false,
      error: new Error("rpc unreachable"),
    });
    const send = notificationSendAction;

    const result = await send.execute({
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
    expect(result.error).toMatch(/rpc unreachable/);
  });
});
