import { describe, expect, test, mock } from "bun:test";
import { z } from "zod";
import type { AuthUser } from "@checkstack/backend-api";
import { createAiToolRegistry } from "../tool-registry";
import type { RegisteredAiTool } from "../tool-registry";
import { createAiToolResolver } from "../resolver";
import {
  createProposeApplyService,
  ProposeApplyError,
} from "../propose-apply/service";
import { generateProposalNonce } from "../propose-apply/token";
import type { AiToolCallStore } from "../propose-apply/store";
import type { AiToolCallRow } from "../schema";
import { buildChatToolCallbacks, type ChatRecordExecuted } from "./chat-service";
import type { ChatReadInvoker } from "./read-invoker";

/**
 * In-memory `AiToolCallStore` mirroring the atomic single-use consume (same as
 * the propose/apply service test). Used here to prove the AUTO-mode server-side
 * auto-apply path runs through the SAME propose/apply service - same `isAllowed`
 * re-check, same `ai_tool_calls` audit rows - as the human `applyTool` flow.
 */
function createFakeStore(now: () => Date): AiToolCallStore & {
  rows: Map<string, AiToolCallRow>;
} {
  const rows = new Map<string, AiToolCallRow>();
  let counter = 0;
  const baseRow = (over: Partial<AiToolCallRow>): AiToolCallRow => ({
    id: `row-${++counter}`,
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
    createdAt: now(),
    ...over,
  });
  return {
    rows,
    async recordExecuted(args) {
      const row = baseRow({
        ...args,
        conversationId: args.conversationId ?? null,
        effect: "read",
        status: "executed",
        resultSnapshot: args.resultSnapshot ?? null,
      });
      rows.set(row.id, row);
      return row;
    },
    async recordFailed(args) {
      const row = baseRow({
        ...args,
        conversationId: args.conversationId ?? null,
        status: "failed",
      });
      rows.set(row.id, row);
      return row;
    },
    async createProposal(args) {
      const nonce = generateProposalNonce();
      const row = baseRow({
        principalKind: args.principal.kind,
        principalId: args.principal.id,
        transport: args.transport,
        conversationId: args.conversationId ?? null,
        toolName: args.toolName,
        effect: args.effect,
        argsHash: args.argsHash,
        status: "proposed",
        proposalNonce: nonce,
        proposalExpiresAt: new Date((args.now ?? now()).getTime() + 600_000),
        proposedPayload: args.proposedPayload,
        resultSnapshot: args.resultSnapshot ?? null,
        proposedAt: args.now ?? now(),
      });
      rows.set(row.id, row);
      return { row, nonce };
    },
    async consumeProposal({ rowId, applier, now: at = now() }) {
      const row = rows.get(rowId);
      if (!row) return undefined;
      if (row.status !== "proposed") return undefined;
      if (row.proposalExpiresAt && row.proposalExpiresAt.getTime() <= at.getTime()) {
        return undefined;
      }
      const updated: AiToolCallRow = {
        ...row,
        status: "applied",
        appliedAt: at,
        appliedByKind: applier.kind,
        appliedById: applier.id,
      };
      rows.set(rowId, updated);
      return updated;
    },
    async getProposal(rowId) {
      return rows.get(rowId);
    },
    async expireStaleProposals() {
      return 0;
    },
  };
}

const ManageInput = z.object({ value: z.string() });

function mutatingTool(): {
  tool: RegisteredAiTool<{ value: string }, { created: string }>;
  execute: ReturnType<typeof mock>;
} {
  // A spy execute so a test can assert the tool body NEVER ran (e.g. when the
  // authz gate refuses before any commit). Refusal happens in `propose` today,
  // before execute — this makes the no-execute guarantee regression-proof if the
  // gate order ever changes.
  const execute = mock(async ({ input }: { input: { value: string } }) => ({
    created: input.value,
  }));
  const tool: RegisteredAiTool<{ value: string }, { created: string }> = {
    name: "demo.mutate",
    description: "demo mutating tool",
    effect: "mutate",
    input: ManageInput,
    requiredAccessRules: ["demo.demo.manage"],
    dryRun: async ({ input }) => ({
      summary: `Would create ${input.value}`,
      payload: { value: input.value },
    }),
    execute,
  };
  return { tool, execute };
}

const allowed: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["demo.demo.manage"],
};
const notAllowed: AuthUser = {
  type: "user",
  id: "u2",
  accessRules: ["other.read"],
};

function budgetDb(used: number) {
  const where = mock(() => Promise.resolve([{ value: used }]));
  const from = mock(() => ({ where }));
  const select = mock(() => ({ from }));
  return { select } as never;
}

function setup() {
  const registry = createAiToolRegistry();
  const { tool, execute } = mutatingTool();
  registry.register(tool);
  const resolver = createAiToolResolver({ registry });
  const store = createFakeStore(() => new Date());
  const proposeApply = createProposeApplyService({ registry, resolver, store });
  const readInvoker: ChatReadInvoker = {
    invoke: () => Promise.reject(new Error("read invoker should not run")),
  };
  const recordExecuted: ChatRecordExecuted = async () => {};
  const callbacks = buildChatToolCallbacks({
    proposeApply,
    readInvoker,
    recordExecuted,
    readRouting: new Map(),
    db: budgetDb(0),
    conversationId: "conv-1",
    forwardHeaders: {},
    internalUrl: "http://localhost:3000",
  });
  return { tool, execute, store, callbacks };
}

describe("AUTO-mode mutate auto-apply path", () => {
  test("auto-applies server-side through the SAME propose/apply service (audited as applied)", async () => {
    const { tool, execute, store, callbacks } = setup();

    const result = await callbacks.autoApply({
      principal: allowed,
      tool,
      input: { value: "alpha" },
    });

    // A first call must auto-apply (not be deduped as a duplicate).
    if (!("__applied" in result)) {
      throw new Error("expected an applied result, got a duplicate");
    }
    // The tool's execute actually ran (server-side apply, no human click).
    expect(result.__applied).toBe(true);
    expect(result.result).toEqual({ created: "alpha" });
    expect(execute).toHaveBeenCalledTimes(1);

    // The audit trail mirrors a HUMAN apply exactly: a row transitioned
    // proposed -> applied, with the applier stamped. Not a weaker/parallel path.
    const applied = [...store.rows.values()].filter((r) => r.status === "applied");
    expect(applied).toHaveLength(1);
    expect(applied[0]?.toolName).toBe("demo.mutate");
    expect(applied[0]?.effect).toBe("mutate");
    expect(applied[0]?.appliedById).toBe("u1");
    expect(applied[0]?.id).toBe(result.toolCallId);
  });

  test("re-checks authz: an unauthorized principal is refused (no apply, no execute)", async () => {
    const { tool, execute, store, callbacks } = setup();

    await expect(
      callbacks.autoApply({
        principal: notAllowed,
        tool,
        input: { value: "beta" },
      }),
    ).rejects.toBeInstanceOf(ProposeApplyError);

    // Nothing was applied — the authz gate (the SAME `isAllowed` re-check the
    // human path uses) refused before any commit.
    const applied = [...store.rows.values()].filter((r) => r.status === "applied");
    expect(applied).toHaveLength(0);
    // The tool body NEVER ran for the unauthorized principal. Refusal happens in
    // `propose` (before any execute) today; this assertion makes the no-execute
    // guarantee regression-proof even if the gate order ever changes.
    expect(execute).not.toHaveBeenCalled();
  });
});
