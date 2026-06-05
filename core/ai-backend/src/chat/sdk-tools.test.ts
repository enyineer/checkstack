import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { AuthUser } from "@checkstack/backend-api";
import type { AiPermissionMode } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "../tool-registry";
import {
  buildAgentSdkTools,
  type AutoAppliedResult,
  type ConfirmCardResult,
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
