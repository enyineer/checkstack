import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { AuthUser } from "@checkstack/backend-api";
import type { AiPermissionMode } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "../tool-registry";
import {
  buildAgentSdkTools,
  ToolFeedbackError,
  type AgentToolCallbacks,
  type AutoAppliedResult,
  type ConfirmCardResult,
  type DuplicateToolCallResult,
  type ValidationFeedbackResult,
} from "./sdk-tools";

function tool(
  name: string,
  effect: RegisteredAiTool["effect"],
): RegisteredAiTool {
  return {
    name,
    description: name,
    effect,
    input: z.object({ value: z.string() }),
    requiredAccessRules: [],
    ...(effect === "read"
      ? {}
      : { dryRun: async () => ({ summary: "s", payload: {} }) }),
    execute: () => Promise.resolve({ ok: true }),
  };
}

const principal: AuthUser = { type: "user", id: "u1", accessRules: ["*"] };

function callbacks() {
  const calls: string[] = [];
  return {
    calls,
    enforceBudget: async () => {
      calls.push("budget");
    },
    runRead: async () => {
      calls.push("runRead");
      return { rows: [] };
    },
    propose: async ({ tool: t }: { tool: RegisteredAiTool }) => {
      calls.push("propose");
      return {
        __confirm: true,
        status: "awaiting_operator",
        toolName: t.name,
        effect: t.effect as "mutate" | "destructive",
        summary: "would do it",
        token: "propose:abc.def",
        payload: { value: "x" },
        expiresAt: new Date().toISOString(),
        note: "awaiting approval",
      } satisfies ConfirmCardResult;
    },
    autoApply: async ({ tool: t }: { tool: RegisteredAiTool }) => {
      calls.push("autoApply");
      return {
        __applied: true,
        toolName: t.name,
        effect: "mutate",
        summary: "did it",
        toolCallId: "tc-1",
        result: { created: true },
        note: "applied",
      } satisfies AutoAppliedResult;
    },
  };
}

function build({
  effect,
  mode,
  cb,
}: {
  effect: RegisteredAiTool["effect"];
  mode: AiPermissionMode;
  cb: ReturnType<typeof callbacks>;
}) {
  const name = `t.${effect}`;
  const sdk = buildAgentSdkTools({
    tools: [tool(name, effect)],
    principal,
    mode,
    callbacks: cb,
  });
  return sdk[name]?.execute;
}

describe("buildAgentSdkTools — 3-tier gating", () => {
  test("read tool ALWAYS auto-runs (approve mode)", async () => {
    const cb = callbacks();
    const execute = build({ effect: "read", mode: "approve", cb });
    const result = await execute?.(
      { value: "x" },
      { toolCallId: "t1", messages: [] },
    );
    expect(result).toEqual({ rows: [] });
    expect(cb.calls).toEqual(["budget", "runRead"]);
  });

  test("read tool ALWAYS auto-runs (auto mode) — mode never gates reads", async () => {
    const cb = callbacks();
    const execute = build({ effect: "read", mode: "auto", cb });
    await execute?.({ value: "x" }, { toolCallId: "t1", messages: [] });
    expect(cb.calls).toEqual(["budget", "runRead"]);
  });

  test("mutate tool in APPROVE mode -> propose (confirm card, never commits)", async () => {
    const cb = callbacks();
    const execute = build({ effect: "mutate", mode: "approve", cb });
    const result = (await execute?.(
      { value: "x" },
      { toolCallId: "t1", messages: [] },
    )) as ConfirmCardResult;
    expect(result.__confirm).toBe(true);
    // A confirm card is a SUCCESS (the proposal landed); it carries the
    // structured `status` so the model keys on state, not the `note` prose.
    expect(result.status).toBe("awaiting_operator");
    expect(result.token).toBe("propose:abc.def");
    expect(cb.calls).toEqual(["budget", "propose"]);
  });

  test("mutate tool in AUTO mode -> auto-applies server-side (no confirm card)", async () => {
    const cb = callbacks();
    const execute = build({ effect: "mutate", mode: "auto", cb });
    const result = (await execute?.(
      { value: "x" },
      { toolCallId: "t1", messages: [] },
    )) as AutoAppliedResult;
    expect(result.__applied).toBe(true);
    expect(result.toolCallId).toBe("tc-1");
    // It applied; it did NOT return a confirm card.
    expect(cb.calls).toEqual(["budget", "autoApply"]);
  });

  test("destructive tool in APPROVE mode -> propose (confirm card)", async () => {
    const cb = callbacks();
    const execute = build({ effect: "destructive", mode: "approve", cb });
    const result = (await execute?.(
      { value: "x" },
      { toolCallId: "t1", messages: [] },
    )) as ConfirmCardResult;
    expect(result.effect).toBe("destructive");
    expect(result.__confirm).toBe(true);
    expect(cb.calls).toEqual(["budget", "propose"]);
  });

  test("SECURITY INVARIANT: destructive tool in AUTO mode STILL proposes (never auto-applies)", async () => {
    const cb = callbacks();
    const execute = build({ effect: "destructive", mode: "auto", cb });
    const result = (await execute?.(
      { value: "x" },
      { toolCallId: "t1", messages: [] },
    )) as ConfirmCardResult;
    // AUTO mode does NOT change a destructive tool's disposition: still a card.
    expect(result.__confirm).toBe(true);
    expect(result.effect).toBe("destructive");
    // autoApply was NEVER called for the destructive tool.
    expect(cb.calls).toEqual(["budget", "propose"]);
  });

  test("the model is offered exactly the tools passed in (resolver-allowed only)", () => {
    const sdk = buildAgentSdkTools({
      tools: [tool("incident.list", "read")],
      principal,
      mode: "approve",
      callbacks: callbacks(),
    });
    expect(Object.keys(sdk)).toEqual(["incident.list"]);
  });
});

describe("buildAgentSdkTools — tool descriptions are STABLE across permission modes (Finding 10)", () => {
  // The mode is conveyed ONCE via the system prompt's permission-mode line; the
  // wire-time tool descriptions must NOT be mutated per mode (no
  // " (auto-applied...)" / " (requires human confirmation...)" suffixes), so
  // tool identity stays decoupled from conversation state and any future
  // tool-block prompt cache survives a mode toggle.
  function descriptionFor({
    effect,
    mode,
  }: {
    effect: RegisteredAiTool["effect"];
    mode: AiPermissionMode;
  }): string | undefined {
    const name = `t.${effect}`;
    const sdk = buildAgentSdkTools({
      tools: [tool(name, effect)],
      principal,
      mode,
      callbacks: callbacks(),
    });
    return sdk[name]?.description;
  }

  test("the description is the raw tool description, with NO per-mode note appended", () => {
    for (const effect of ["read", "mutate", "destructive"] as const) {
      for (const mode of ["approve", "auto"] as const) {
        const description = descriptionFor({ effect, mode });
        expect(description).toBe(`t.${effect}`);
        expect(description).not.toContain("auto-applied");
        expect(description).not.toContain("requires human confirmation");
      }
    }
  });

  test("a mutate tool's description is IDENTICAL in approve and auto mode", () => {
    expect(descriptionFor({ effect: "mutate", mode: "approve" })).toBe(
      descriptionFor({ effect: "mutate", mode: "auto" }),
    );
  });

  test("a destructive tool's description is IDENTICAL in approve and auto mode", () => {
    expect(descriptionFor({ effect: "destructive", mode: "approve" })).toBe(
      descriptionFor({ effect: "destructive", mode: "auto" }),
    );
  });
});

describe("buildAgentSdkTools — self-correction error channel (Phase 1)", () => {
  /** Build a single mutate tool's `execute` against a propose-spy callback set. */
  function buildMutateExecute(
    propose: AgentToolCallbacks["propose"],
  ): ((input: unknown, opts: unknown) => Promise<unknown>) | undefined {
    const cb: AgentToolCallbacks = {
      enforceBudget: async () => {},
      runRead: async () => ({}),
      propose,
      autoApply: async () => {
        throw new Error("autoApply should not run in APPROVE mode");
      },
    };
    const sdk = buildAgentSdkTools({
      tools: [tool("t.mutate", "mutate")],
      principal,
      mode: "approve",
      callbacks: cb,
    });
    return sdk["t.mutate"]?.execute as
      | ((input: unknown, opts: unknown) => Promise<unknown>)
      | undefined;
  }

  const opts = { toolCallId: "t1", messages: [] };

  test("a validation failure is THROWN as a ToolFeedbackError (not returned as success)", async () => {
    const issues = [{ path: ["runAs"], message: "no such account" }];
    const execute = buildMutateExecute(async ({ tool: t }) => {
      const feedback: ValidationFeedbackResult = {
        __validationFailed: true,
        toolName: t.name,
        issues,
        note: "Fix the issues and call again; nothing has been applied.",
      };
      return feedback;
    });

    let caught: unknown;
    try {
      await execute?.({ value: "x" }, opts);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ToolFeedbackError);
    const err = caught as ToolFeedbackError;
    // The structured payload travels on the error for the model to key on...
    expect(err.feedback.kind).toBe("validation_failed");
    expect(err.feedback.toolName).toBe("t.mutate");
    expect(err.feedback.issues).toEqual(issues);
    // ...and the prose guidance is the error message (belt and suspenders).
    expect(err.message).toMatch(/Fix the issues/);
  });

  test("a duplicate call is THROWN as a ToolFeedbackError", async () => {
    const execute = buildMutateExecute(async ({ tool: t }) => {
      const duplicate: DuplicateToolCallResult = {
        __duplicate: true,
        toolName: t.name,
        note: "You already proposed this; stop and tell the operator.",
      };
      return duplicate;
    });

    let caught: unknown;
    try {
      await execute?.({ value: "x" }, opts);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ToolFeedbackError);
    expect((caught as ToolFeedbackError).feedback.kind).toBe("duplicate_call");
    expect((caught as ToolFeedbackError).feedback.issues).toBeUndefined();
  });

  test("a confirm card is a SUCCESS value with status: awaiting_operator (NOT thrown)", async () => {
    const execute = buildMutateExecute(async ({ tool: t }) => {
      const card: ConfirmCardResult = {
        __confirm: true,
        status: "awaiting_operator",
        toolName: t.name,
        effect: "mutate",
        summary: "would do it",
        token: "propose:abc.def",
        payload: {},
        expiresAt: new Date().toISOString(),
        note: "awaiting approval",
      };
      return card;
    });

    const result = (await execute?.({ value: "x" }, opts)) as ConfirmCardResult;
    expect(result.__confirm).toBe(true);
    expect(result.status).toBe("awaiting_operator");
  });
});
