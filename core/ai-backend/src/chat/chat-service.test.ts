import { describe, expect, test, mock } from "bun:test";
import { z } from "zod";
import type { AuthUser } from "@checkstack/backend-api";
import type { RegisteredAiTool } from "../tool-registry";
import type { ProposeApplyService } from "../propose-apply/service";
import type { ChatReadInvoker } from "./read-invoker";
import {
  buildChatToolCallbacks,
  type ChatRecordExecuted,
} from "./chat-service";
import { ToolBudgetExceededError } from "../rate-limit/tool-budget";
import { ToolValidationError } from "../propose-apply/validation-error";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["incident.incident.read"],
};

const readTool: RegisteredAiTool = {
  name: "incident.list",
  description: "list",
  effect: "read",
  input: z.object({ status: z.string().optional() }),
  requiredAccessRules: ["incident.incident.read"],
  execute: () => Promise.resolve({ rows: [] }),
};

/**
 * A COMPOSITE read tool (no projection routing) — like `ai.searchDocs` /
 * `ai.getDoc`. It has no entry in `readRouting`, so `runRead` must invoke its
 * own `execute` rather than re-entering the live router.
 */
const compositeReadTool: RegisteredAiTool = {
  name: "ai.searchDocs",
  description: "search docs",
  effect: "read",
  input: z.object({ query: z.string() }),
  requiredAccessRules: ["ai.chat.read"],
  execute: ({ input }) =>
    Promise.resolve({ echoed: (input as { query: string }).query }),
};

/** A fake db whose count query resolves to `used`, simulating the budget read. */
function budgetDb(used: number) {
  const where = mock(() => Promise.resolve([{ value: used }]));
  const from = mock(() => ({ where }));
  const select = mock(() => ({ from }));
  return { select } as never;
}

function deps(over?: {
  used?: number;
  invoke?: ChatReadInvoker["invoke"];
  recordExecuted?: ChatRecordExecuted;
}) {
  const recorded: Array<{
    transport: string;
    toolName: string;
    argsHash: string;
    conversationId: string;
  }> = [];
  const readInvoker: ChatReadInvoker = {
    invoke: over?.invoke ?? (() => Promise.resolve({ rows: [1, 2] })),
  };
  const recordExecuted: ChatRecordExecuted =
    over?.recordExecuted ??
    (async ({ toolName, argsHash, conversationId }) => {
      recorded.push({ transport: "chat", toolName, argsHash, conversationId });
    });
  const proposeApply = {} as ProposeApplyService;
  const readRouting = new Map([
    ["incident.list", { pluginId: "incident", procedureKey: "listIncidents" }],
  ]);
  const callbacks = buildChatToolCallbacks({
    proposeApply,
    readInvoker,
    recordExecuted,
    readRouting,
    db: budgetDb(over?.used ?? 0),
    conversationId: "conv-1",
    forwardHeaders: { cookie: "session=x" },
    internalUrl: "http://localhost:3000",
  });
  return { callbacks, recorded };
}

describe("chat read auditing + budget (P4 review item 2)", () => {
  test("a chat read writes an ai_tool_calls row with transport 'chat' + args hash", async () => {
    const { callbacks, recorded } = deps();
    const result = await callbacks.runRead({
      principal,
      tool: readTool,
      input: { status: "open" },
    });
    expect(result).toEqual({ rows: [1, 2] });
    // The read was audit-recorded so it lands in the log AND counts to budget.
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.transport).toBe("chat");
    expect(recorded[0]?.toolName).toBe("incident.list");
    expect(recorded[0]?.conversationId).toBe("conv-1");
    // The args hash is a SHA-256 hex digest, never the raw args.
    expect(recorded[0]?.argsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("enforceBudget passes when under budget", async () => {
    const { callbacks } = deps({ used: 0 });
    await expect(callbacks.enforceBudget(principal)).resolves.toBeUndefined();
  });

  test("an over-budget chat read is rejected before it runs (budget counts chat reads)", async () => {
    let invoked = false;
    const { callbacks } = deps({
      used: 999,
      invoke: () => {
        invoked = true;
        return Promise.resolve({});
      },
    });
    // The SDK tool calls enforceBudget BEFORE runRead; over budget -> throw.
    await expect(callbacks.enforceBudget(principal)).rejects.toBeInstanceOf(
      ToolBudgetExceededError,
    );
    expect(invoked).toBe(false);
  });

  test("a read whose recordExecuted fails still surfaces (recording is awaited, audit-critical)", async () => {
    // The audit row is awaited because the budget depends on it; a recording
    // failure must propagate rather than silently undercount.
    const { callbacks } = deps({
      recordExecuted: () => Promise.reject(new Error("db down")),
    });
    await expect(
      callbacks.runRead({ principal, tool: readTool, input: {} }),
    ).rejects.toThrow("db down");
  });
});

describe("runRead composite-read fallback (searchDocs/getDoc path)", () => {
  test("a routing-less read tool runs its own execute (NOT the router)", async () => {
    // The readInvoker must NOT be touched for a composite tool; if it were, the
    // routing-less tool would error "has no routing" in the pre-fallback code.
    const invoke = mock(() => Promise.reject(new Error("router should not run")));
    const { callbacks, recorded } = deps({ invoke });

    const docPrincipal: AuthUser = {
      type: "user",
      id: "u1",
      accessRules: ["ai.chat.read"],
    };
    const result = await callbacks.runRead({
      principal: docPrincipal,
      tool: compositeReadTool,
      input: { query: "health checks" },
    });

    // The tool's own execute produced the result.
    expect(result).toEqual({ echoed: "health checks" });
    // The live-router invoker was never called (no routing entry).
    expect(invoke).not.toHaveBeenCalled();
    // The composite read is still audit-recorded (audit + budget count).
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.toolName).toBe("ai.searchDocs");
    expect(recorded[0]?.transport).toBe("chat");
  });
});

/** A mutate tool used to exercise the per-turn propose/auto-apply dedupe. */
const mutateTool: RegisteredAiTool = {
  name: "healthcheck.update",
  description: "update a health check",
  effect: "mutate",
  input: z.object({
    id: z.string(),
    body: z.record(z.string(), z.unknown()),
  }),
  requiredAccessRules: ["healthcheck.healthcheck.manage"],
  execute: () => Promise.resolve({ ok: true }),
};

/** Build callbacks wired to a propose-spy ProposeApplyService (no real store). */
function dedupeCallbacks(proposeMock: ReturnType<typeof mock>) {
  // Partial service stub: only `propose`/`apply` are exercised here (the same
  // pattern the existing harness uses with `{} as ProposeApplyService`).
  const proposeApply = {
    propose: proposeMock,
    apply: mock(() =>
      Promise.resolve({ toolCallId: "row-1", result: { ok: true } }),
    ),
  } as unknown as ProposeApplyService;
  return buildChatToolCallbacks({
    proposeApply,
    readInvoker: { invoke: () => Promise.resolve({}) },
    recordExecuted: async () => {},
    readRouting: new Map(),
    db: budgetDb(0),
    conversationId: "conv-1",
    forwardHeaders: {},
    internalUrl: "http://localhost:3000",
  });
}

describe("per-turn mutating-tool dedupe (no triple proposals)", () => {
  const proposal = {
    token: "propose:row-1.nonce",
    summary: "Update health check",
    payload: { id: "hc1" },
    diff: undefined,
    toolCallId: "row-1",
    expiresAt: new Date("2026-06-03T00:00:00Z"),
  };

  test("a repeated identical propose returns a duplicate, proposed only once", async () => {
    const proposeMock = mock(() => Promise.resolve(proposal));
    const callbacks = dedupeCallbacks(proposeMock);
    const input = { id: "hc1", body: { intervalSeconds: 120 } };

    const first = await callbacks.propose({ principal, tool: mutateTool, input });
    const second = await callbacks.propose({ principal, tool: mutateTool, input });

    // First call creates the real confirm card (with a token + a stop note).
    expect("__confirm" in first && first.__confirm).toBe(true);
    expect("token" in first).toBe(true);
    if ("note" in first) expect(first.note.length).toBeGreaterThan(0);

    // Second identical call is deduped: no card, no new token, a clear note.
    expect("__duplicate" in second && second.__duplicate).toBe(true);
    expect("token" in second).toBe(false);

    // The single-use proposal token is minted exactly ONCE for the repeat.
    expect(proposeMock).toHaveBeenCalledTimes(1);
  });

  test("a DIFFERENT propose in the same turn is NOT deduped", async () => {
    const proposeMock = mock(() => Promise.resolve(proposal));
    const callbacks = dedupeCallbacks(proposeMock);

    await callbacks.propose({
      principal,
      tool: mutateTool,
      input: { id: "hc1", body: { intervalSeconds: 120 } },
    });
    await callbacks.propose({
      principal,
      tool: mutateTool,
      input: { id: "hc2", body: { intervalSeconds: 120 } },
    });

    expect(proposeMock).toHaveBeenCalledTimes(2);
  });
});

describe("propose validation feedback loop (model self-corrects)", () => {
  const issues = [
    { path: ["runAs"], message: 'Service account "system" does not exist.' },
    {
      path: ["actions", 0, "config"],
      message: "Template references artifacts.x.found but x produces y.",
    },
  ];

  test("a ToolValidationError is returned to the model as feedback, not thrown", async () => {
    const proposeMock = mock(() =>
      Promise.reject(new ToolValidationError("invalid draft", issues)),
    );
    const callbacks = dedupeCallbacks(proposeMock);

    const out = await callbacks.propose({
      principal,
      tool: mutateTool,
      input: { id: "hc1", body: {} },
    });

    expect("__validationFailed" in out && out.__validationFailed).toBe(true);
    if ("issues" in out) expect(out.issues).toEqual(issues);
    if ("note" in out) {
      expect(out.note).toMatch(/fix/i);
      expect(out.note).toMatch(/not.*done|nothing has been/i);
    }
    // No confirm card / token leaked, and nothing was applied.
    expect("__confirm" in out).toBe(false);
  });

  test("the failed propose is NOT turn-deduped, so a corrected retry is allowed", async () => {
    // First call fails validation; second (corrected) succeeds.
    const proposeMock = mock(() =>
      Promise.reject(new ToolValidationError("invalid draft", issues)),
    );
    const callbacks = dedupeCallbacks(proposeMock);
    const input = { id: "hc1", body: {} };

    const first = await callbacks.propose({ principal, tool: mutateTool, input });
    expect("__validationFailed" in first && first.__validationFailed).toBe(true);

    // The model retries the SAME args after "fixing"; because the failure was
    // not recorded in handledThisTurn, this is NOT short-circuited as a dup.
    const second = await callbacks.propose({ principal, tool: mutateTool, input });
    expect("__duplicate" in second).toBe(false);
    expect(proposeMock).toHaveBeenCalledTimes(2);
  });

  test("a non-validation error still propagates (genuine fault, not feedback)", async () => {
    const proposeMock = mock(() =>
      Promise.reject(new Error("database is down")),
    );
    const callbacks = dedupeCallbacks(proposeMock);

    await expect(
      callbacks.propose({ principal, tool: mutateTool, input: { id: "hc1", body: {} } }),
    ).rejects.toThrow("database is down");
  });

  test("auto-apply also feeds a ToolValidationError back instead of applying", async () => {
    const proposeMock = mock(() =>
      Promise.reject(new ToolValidationError("invalid draft", issues)),
    );
    const applyMock = mock(() =>
      Promise.resolve({ toolCallId: "row-1", result: { ok: true } }),
    );
    const proposeApply = {
      propose: proposeMock,
      apply: applyMock,
    } as unknown as ProposeApplyService;
    const callbacks = buildChatToolCallbacks({
      proposeApply,
      readInvoker: { invoke: () => Promise.resolve({}) },
      recordExecuted: async () => {},
      readRouting: new Map(),
      db: budgetDb(0),
      conversationId: "conv-1",
      forwardHeaders: {},
      internalUrl: "http://localhost:3000",
    });

    const out = await callbacks.autoApply({
      principal,
      tool: mutateTool,
      input: { id: "hc1", body: {} },
    });

    expect("__validationFailed" in out && out.__validationFailed).toBe(true);
    // Crucially, a broken draft is NEVER applied.
    expect(applyMock).not.toHaveBeenCalled();
  });
});
