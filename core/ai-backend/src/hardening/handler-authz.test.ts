import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createAiToolRegistry } from "../tool-registry";
import type { RegisteredAiTool } from "../tool-registry";
import { createAiToolResolver } from "../resolver";
import {
  createProposeApplyService,
  ProposeApplyError,
} from "../propose-apply/service";
import type { AiToolCallStore } from "../propose-apply/store";
import type { AiToolCallRow } from "../schema";

/**
 * HARDENING: handler-side authorization holds when the MODEL MISBEHAVES
 * (plan §1.5, §16 matrix #8/#11/#14, risk "Model calls a tool the principal
 * can't use").
 *
 * The LLM is an untrusted caller that happens to be good at picking arguments.
 * These named assertions prove the server refuses a model that "picks" a tool
 * the principal is NOT allowed (or passes bad args) — the refusal is
 * server-side, not a UI hint, and the underlying execute / dryRun is NEVER
 * reached. This complements the per-transport tests (`mcp/server.test.ts` #8,
 * `chat/agent-loop.test.ts` #14): here we assert the SHARED authorization spine
 * (`resolver` + `propose-apply` service) directly, so the invariant holds for
 * any future transport built on the same registry. Pure (no DB, no DOM).
 */

// These hardening tests reject at the authz / schema gate BEFORE the dry-run, so
// the RPC client is never used; a throwing stub satisfies the required arg and
// proves it is never reached.
const rpcClient = {
  forPlugin: () => {
    throw new Error("authz gate must reject before any RPC call");
  },
} as unknown as RpcClient;

/** A read tool whose execute must NEVER run for an unauthorized principal. */
function readTool(
  name: string,
  rule: string,
  onExecute: () => void,
): RegisteredAiTool {
  return {
    name,
    description: name,
    effect: "read",
    input: z.object({ q: z.string() }),
    requiredAccessRules: [rule],
    execute: () => {
      onExecute();
      return Promise.resolve({ ok: true });
    },
  };
}

/** A mutating tool whose dryRun must NEVER run for an unauthorized principal. */
function mutateTool(
  name: string,
  rule: string,
  hooks: { onDryRun: () => void; onExecute: () => void },
): RegisteredAiTool {
  return {
    name,
    description: name,
    effect: "mutate",
    input: z.object({ amount: z.number().int().positive() }),
    requiredAccessRules: [rule],
    dryRun: ({ input }) => {
      hooks.onDryRun();
      return Promise.resolve({ summary: "would mutate", payload: input });
    },
    execute: ({ input }) => {
      hooks.onExecute();
      return Promise.resolve(input);
    },
  };
}

/** Minimal in-memory store: enough for the propose path to be exercised. */
function memStore(): AiToolCallStore {
  let n = 0;
  const rows = new Map<string, AiToolCallRow>();
  const base = (over: Partial<AiToolCallRow>): AiToolCallRow => ({
    id: `row-${++n}`,
    principalKind: "user",
    principalId: "u1",
    transport: "chat",
    conversationId: null,
    toolName: "x",
    effect: "mutate",
    argsHash: "h",
    status: "proposed",
    proposalNonce: null,
    proposalExpiresAt: null,
    resultSnapshot: null,
    proposedPayload: null,
    error: null,
    proposedAt: null,
    appliedAt: null,
    appliedByKind: null,
    appliedById: null,
    createdAt: new Date(),
    ...over,
  });
  return {
    async recordExecuted(args) {
      const row = base({ ...args, conversationId: args.conversationId ?? null, effect: "read", status: "executed" });
      rows.set(row.id, row);
      return row;
    },
    async recordFailed(args) {
      const row = base({ ...args, conversationId: args.conversationId ?? null, status: "failed" });
      rows.set(row.id, row);
      return row;
    },
    async createProposal(args) {
      const nonce = "nonce-fixed";
      const row = base({
        ...args,
        conversationId: args.conversationId ?? null,
        proposalNonce: nonce,
        proposalExpiresAt: new Date(Date.now() + 600_000),
        proposedPayload: args.proposedPayload ?? null,
        resultSnapshot: args.resultSnapshot ?? null,
        proposedAt: new Date(),
      });
      rows.set(row.id, row);
      return { row, nonce };
    },
    async getProposal(id) {
      return rows.get(id);
    },
    async consumeProposal({ rowId }) {
      const row = rows.get(rowId);
      if (!row || row.status !== "proposed") return undefined;
      const applied = { ...row, status: "applied" as const, appliedAt: new Date() };
      rows.set(rowId, applied);
      return applied;
    },
    async expireStaleProposals() {
      return 0;
    },
  };
}

const limited: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["incident.incident.read"],
};

describe("HARDENING: a misbehaving model cannot escape the resolver gate", () => {
  test("isAllowed refuses a tool whose rule the principal lacks", () => {
    const registry = createAiToolRegistry();
    let ran = false;
    const adminTool = readTool("ai_secrets", "ai.tools.manage", () => {
      ran = true;
    });
    registry.register(adminTool);
    const resolver = createAiToolResolver({ registry });

    expect(resolver.isAllowed({ principal: limited, tool: adminTool })).toBe(false);
    // resolveTools never even surfaces it to the model.
    expect(resolver.resolveTools(limited)).toEqual([]);
    expect(ran).toBe(false);
  });

  test("a service principal (no access rules) is refused every tool", () => {
    const registry = createAiToolRegistry();
    const tool = readTool("incident_list", "incident.incident.read", () => {});
    registry.register(tool);
    const resolver = createAiToolResolver({ registry });
    const service: AuthUser = { type: "service", pluginId: "svc" };
    expect(resolver.isAllowed({ principal: service, tool })).toBe(false);
  });
});

describe("HARDENING: propose refuses a model-picked out-of-scope tool BEFORE dryRun", () => {
  test("an unauthorized mutating tool is refused server-side; dryRun never runs", async () => {
    const registry = createAiToolRegistry();
    let dryRan = false;
    let executed = false;
    const tool = mutateTool("billing_refund", "billing.billing.manage", {
      onDryRun: () => {
        dryRan = true;
      },
      onExecute: () => {
        executed = true;
      },
    });
    registry.register(tool);
    const resolver = createAiToolResolver({ registry });
    const service = createProposeApplyService({
      registry,
      resolver,
      store: memStore(),
    });

    await expect(
      service.propose({
        principal: limited, // lacks billing.billing.manage
        toolName: "billing_refund",
        input: { amount: 100 },
        transport: "chat",
        rpcClient,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    // The dry-run (and therefore any mutation) was never reached.
    expect(dryRan).toBe(false);
    expect(executed).toBe(false);
  });
});

describe("HARDENING: bad model-supplied args are rejected (no execution on garbage)", () => {
  test("propose rejects args that fail the tool's own zod schema", async () => {
    const registry = createAiToolRegistry();
    let dryRan = false;
    const tool = mutateTool("incident_escalate", "incident.incident.read", {
      onDryRun: () => {
        dryRan = true;
      },
      onExecute: () => {},
    });
    registry.register(tool);
    const resolver = createAiToolResolver({ registry });
    const service = createProposeApplyService({
      registry,
      resolver,
      store: memStore(),
    });

    // The principal IS authorized (same rule), but the model passed bad args:
    // `amount` must be a positive integer. The schema validation gate refuses
    // it WITHOUT running the dry-run.
    await expect(
      service.propose({
        principal: limited,
        toolName: "incident_escalate",
        input: { amount: -5 },
        transport: "chat",
        rpcClient,
      }),
    ).rejects.toBeInstanceOf(ProposeApplyError);
    expect(dryRan).toBe(false);
  });
});

describe("HARDENING: scope-narrowing can never WIDEN the surfaced toolset", () => {
  // The resolver predicate is the same one autoAuthMiddleware applies. A
  // scope-narrowed principal carries a SMALLER accessRules set; intersection can
  // only ever shrink the visible tools — never add one the principal lacks.
  test("narrowing the principal's rules monotonically shrinks the visible tools", () => {
    const registry = createAiToolRegistry();
    registry.register(readTool("incident_list", "incident.incident.read", () => {}));
    registry.register(readTool("hc_status", "healthcheck.config.read", () => {}));
    registry.register(readTool("ai_secrets", "ai.tools.manage", () => {}));
    const resolver = createAiToolResolver({ registry });

    const wide: AuthUser = {
      type: "user",
      id: "u1",
      accessRules: ["incident.incident.read", "healthcheck.config.read"],
    };
    const narrowed: AuthUser = {
      type: "user",
      id: "u1",
      accessRules: ["incident.incident.read"], // a token granted only this
    };

    const wideNames = new Set(resolver.resolveTools(wide).map((t) => t.name));
    const narrowNames = new Set(resolver.resolveTools(narrowed).map((t) => t.name));

    // Narrowed is a strict subset — never a superset.
    for (const name of narrowNames) expect(wideNames.has(name)).toBe(true);
    expect(narrowNames.has("hc_status")).toBe(false);
    expect(narrowNames.has("ai_secrets")).toBe(false);
    // And the narrowing never invented a tool outside the wide set.
    expect([...narrowNames].every((n) => wideNames.has(n))).toBe(true);
  });
});
