import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createAiToolRegistry } from "../tool-registry";
import type { RegisteredAiTool } from "../tool-registry";
import { createAiToolResolver } from "../resolver";
import {
  createProposeApplyService,
  ProposeApplyError,
} from "./service";
import { generateProposalNonce } from "./token";
import type { AiToolCallStore } from "./store";
import type { AiToolCallRow } from "../schema";

/**
 * In-memory `AiToolCallStore` that faithfully mimics the atomic single-use
 * consume: only one caller can flip a row from `proposed` to `applied`. This
 * lets the lifecycle / single-use / expiry / authz logic be tested without a
 * real Postgres connection (the SQL atomicity itself is expressed by the
 * `WHERE status='proposed'` clause in the real store).
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
      // Atomic single-use: only a still-`proposed`, non-expired row wins.
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
    async expireStaleProposals(at = now()) {
      let n = 0;
      for (const [id, row] of rows) {
        if (
          row.status === "proposed" &&
          row.proposalExpiresAt &&
          row.proposalExpiresAt.getTime() < at.getTime()
        ) {
          rows.set(id, { ...row, status: "expired" });
          n += 1;
        }
      }
      return n;
    },
  };
}

const ManageInput = z.object({ value: z.string() });

function mutatingTool(
  over?: Partial<RegisteredAiTool>,
): RegisteredAiTool<{ value: string }, { created: string }> {
  let executed = 0;
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
    execute: async ({ input }) => {
      executed += 1;
      return { created: input.value };
    },
    ...(over as Partial<RegisteredAiTool<{ value: string }, { created: string }>>),
  };
  Object.defineProperty(tool, "_executed", { get: () => executed });
  return tool;
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

// The demo tool's dryRun/execute ignore the RPC client, so a never-called stub
// satisfies the user-scoped `rpcClient` arg threaded through propose/apply.
const rpcClient = {
  forPlugin: () => {
    throw new Error("demo tool must not call the RPC client");
  },
} as unknown as RpcClient;

function setup(tool: RegisteredAiTool, clock = () => new Date()) {
  const registry = createAiToolRegistry();
  registry.register(tool);
  const resolver = createAiToolResolver({ registry });
  const store = createFakeStore(clock);
  const real = createProposeApplyService({ registry, resolver, store });
  // Auto-inject the user-scoped `rpcClient` stub on every propose/apply so the
  // individual tests below stay focused on lifecycle/authz (the demo tool
  // ignores the client). This mirrors how the transports build the per-turn,
  // user-scoped client and hand it to the service.
  const service = {
    ...real,
    propose: (args: Omit<Parameters<typeof real.propose>[0], "rpcClient">) =>
      real.propose({ ...args, rpcClient }),
    apply: (args: Omit<Parameters<typeof real.apply>[0], "rpcClient">) =>
      real.apply({ ...args, rpcClient }),
  };
  return { registry, resolver, store, service };
}

describe("propose/apply lifecycle (matrix #11)", () => {
  test("a valid token applies exactly once; a second apply is rejected", async () => {
    const tool = mutatingTool();
    const { service } = setup(tool);

    const proposal = await service.propose({
      principal: allowed,
      toolName: "demo.mutate",
      input: { value: "alpha" },
      transport: "chat",
    });
    expect(proposal.token.startsWith("propose:")).toBe(true);

    const first = await service.apply({ principal: allowed, token: proposal.token });
    expect(first.result).toEqual({ created: "alpha" });

    // Single-use: the second apply must be rejected (atomic consume lost).
    await expect(
      service.apply({ principal: allowed, token: proposal.token }),
    ).rejects.toMatchObject({ code: "consumed" });
  });

  test("an expired token is rejected", async () => {
    let current = new Date("2026-06-01T00:00:00Z");
    const tool = mutatingTool();
    const { service } = setup(tool, () => current);

    const proposal = await service.propose({
      principal: allowed,
      toolName: "demo.mutate",
      input: { value: "beta" },
      transport: "chat",
    });

    // Advance the clock past the 10-minute TTL.
    current = new Date(current.getTime() + 11 * 60_000);
    await expect(
      service.apply({ principal: allowed, token: proposal.token }),
    ).rejects.toMatchObject({ code: "expired" });
  });

  test("a tampered nonce is rejected (constant-time compare)", async () => {
    const tool = mutatingTool();
    const { service } = setup(tool);
    const proposal = await service.propose({
      principal: allowed,
      toolName: "demo.mutate",
      input: { value: "gamma" },
      transport: "chat",
    });
    // Replace the nonce with a same-length but different value.
    const [head, nonce] = proposal.token.split(".");
    const tampered = `${head}.${"f".repeat(nonce.length)}`;
    await expect(
      service.apply({ principal: allowed, token: tampered }),
    ).rejects.toMatchObject({ code: "invalid_token" });
  });

  test("a malformed token is rejected", async () => {
    const { service } = setup(mutatingTool());
    await expect(
      service.apply({ principal: allowed, token: "not-a-token" }),
    ).rejects.toMatchObject({ code: "invalid_token" });
  });
});

describe("propose/apply authorization (matrix #11 / decision 5)", () => {
  test("propose is refused for a principal lacking the rule", async () => {
    const { service } = setup(mutatingTool());
    await expect(
      service.propose({
        principal: notAllowed,
        toolName: "demo.mutate",
        input: { value: "x" },
        transport: "chat",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  test("apply re-checks authz: a rule lost after propose blocks apply", async () => {
    const tool = mutatingTool();
    const { service } = setup(tool);
    const proposal = await service.propose({
      principal: allowed,
      toolName: "demo.mutate",
      input: { value: "x" },
      transport: "chat",
    });
    // The SAME user, but their rules have since been revoked.
    const revoked: AuthUser = { type: "user", id: "u1", accessRules: [] };
    await expect(
      service.apply({ principal: revoked, token: proposal.token }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  test("a read tool is not proposable", async () => {
    const read = mutatingTool({ effect: "read", dryRun: undefined });
    const { service } = setup(read);
    await expect(
      service.propose({
        principal: allowed,
        toolName: "demo.mutate",
        input: { value: "x" },
        transport: "chat",
      }),
    ).rejects.toMatchObject({ code: "not_proposable" });
  });

  test("a service principal can never propose", async () => {
    const { service } = setup(mutatingTool());
    await expect(
      service.propose({
        principal: { type: "service", pluginId: "x" },
        toolName: "demo.mutate",
        input: { value: "x" },
        transport: "chat",
      }),
    ).rejects.toBeInstanceOf(ProposeApplyError);
  });
});

describe("propose does NOT mutate (matrix #12)", () => {
  test("propose runs dryRun and never calls execute", async () => {
    const tool = mutatingTool();
    const { service } = setup(tool);
    await service.propose({
      principal: allowed,
      toolName: "demo.mutate",
      input: { value: "x" },
      transport: "chat",
    });
    expect((tool as unknown as { _executed: number })._executed).toBe(0);
  });
});

describe("audit rows (matrix #13)", () => {
  test("propose writes a proposed row; apply transitions it to applied", async () => {
    const tool = mutatingTool();
    const { service, store } = setup(tool);
    const proposal = await service.propose({
      principal: allowed,
      toolName: "demo.mutate",
      input: { value: "x" },
      transport: "chat",
    });
    const proposedRow = store.rows.get(proposal.toolCallId);
    expect(proposedRow?.status).toBe("proposed");
    // The audit row stores a SHA-256 of the args, never the raw args. (The
    // separate `proposedPayload` holds the VALIDATED apply payload by design —
    // it is what `apply` commits — but the inbound args themselves are only
    // ever represented as the hash.)
    expect(proposedRow?.argsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(proposedRow).not.toHaveProperty("args");
    expect(proposedRow).not.toHaveProperty("rawArgs");

    await service.apply({ principal: allowed, token: proposal.token });
    expect(store.rows.get(proposal.toolCallId)?.status).toBe("applied");
  });

  test("apply records WHO applied, not the proposer (P3 review item 1)", async () => {
    const tool = mutatingTool();
    const { service, store } = setup(tool);
    // Proposed by u1.
    const proposal = await service.propose({
      principal: allowed,
      toolName: "demo.mutate",
      input: { value: "x" },
      transport: "chat",
    });
    // Applied by a DIFFERENT principal that also holds the rule. The invariant
    // (single-use 256-bit token + live authz re-check) holds, so the apply is
    // recorded, attributed to the real applier — not rejected.
    const otherApplier: AuthUser = {
      type: "user",
      id: "u-applier",
      accessRules: ["demo.demo.manage"],
    };
    await service.apply({ principal: otherApplier, token: proposal.token });
    const applied = store.rows.get(proposal.toolCallId);
    expect(applied?.status).toBe("applied");
    expect(applied?.principalKind).toBe("user");
    expect(applied?.principalId).toBe("u1"); // proposer preserved
    expect(applied?.appliedByKind).toBe("user");
    expect(applied?.appliedById).toBe("u-applier"); // real applier recorded
  });

  test("apply re-parses the stored payload against the tool schema (P3 review item 2)", async () => {
    // A tool whose input schema would reject the stored payload at apply time
    // (simulating an evolved schema): execute must never run.
    const tool = mutatingTool();
    const { service, store } = setup(tool);
    const proposal = await service.propose({
      principal: allowed,
      toolName: "demo.mutate",
      input: { value: "x" },
      transport: "chat",
    });
    // Corrupt the server-stored payload so it no longer matches the schema.
    const row = store.rows.get(proposal.toolCallId);
    if (row) {
      store.rows.set(proposal.toolCallId, {
        ...row,
        proposedPayload: { value: 42 } as unknown as Record<string, unknown>,
      });
    }
    await expect(
      service.apply({ principal: allowed, token: proposal.token }),
    ).rejects.toMatchObject({ code: "execute_failed" });
    // execute never ran.
    expect((tool as unknown as { _executed: number })._executed).toBe(0);
  });

  test("expireStaleProposals flips expired rows to expired status", async () => {
    let current = new Date("2026-06-01T00:00:00Z");
    const tool = mutatingTool();
    const { service, store } = setup(tool, () => current);
    const proposal = await service.propose({
      principal: allowed,
      toolName: "demo.mutate",
      input: { value: "x" },
      transport: "chat",
    });
    current = new Date(current.getTime() + 11 * 60_000);
    const n = await store.expireStaleProposals(current);
    expect(n).toBe(1);
    expect(store.rows.get(proposal.toolCallId)?.status).toBe("expired");
  });
});
