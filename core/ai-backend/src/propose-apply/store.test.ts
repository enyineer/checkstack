import { describe, expect, test, mock } from "bun:test";
import { createAiToolCallStore, PROPOSAL_TTL_MS } from "./store";
import type { AiToolCallRow } from "../schema";

function row(over: Partial<AiToolCallRow> = {}): AiToolCallRow {
  return {
    id: "r1",
    principalKind: "user",
    principalId: "u1",
    transport: "chat",
    conversationId: null,
    toolName: "demo.mutate",
    effect: "mutate",
    argsHash: "h".repeat(64),
    status: "proposed",
    proposalNonce: "n".repeat(64),
    proposalExpiresAt: new Date("2026-06-01T00:10:00Z"),
    resultSnapshot: null,
    proposedPayload: { value: "x" },
    error: null,
    proposedAt: new Date("2026-06-01T00:00:00Z"),
    appliedAt: null,
    appliedByKind: null,
    appliedById: null,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    ...over,
  };
}

describe("createAiToolCallStore", () => {
  test("createProposal inserts a proposed row with nonce + TTL", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const values = mock((_v: Record<string, unknown>) => ({
      returning: mock(() => Promise.resolve([row()])),
    }));
    const db = { insert: mock(() => ({ values })) };
    const store = createAiToolCallStore({ db: db as never });

    const { row: created, nonce } = await store.createProposal({
      principal: { kind: "user", id: "u1" },
      transport: "chat",
      toolName: "demo.mutate",
      effect: "mutate",
      argsHash: "h".repeat(64),
      proposedPayload: { value: "x" },
      now,
    });

    const inserted = values.mock.calls[0]?.[0] as {
      status: string;
      proposalNonce: string;
      proposalExpiresAt: Date;
    };
    expect(inserted.status).toBe("proposed");
    expect(inserted.proposalNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(inserted.proposalExpiresAt.getTime()).toBe(now.getTime() + PROPOSAL_TTL_MS);
    expect(nonce).toBe(inserted.proposalNonce);
    expect(created.id).toBe("r1");
  });

  test("recordExecuted writes an executed read row (no nonce)", async () => {
    const values = mock((_v: Record<string, unknown>) => ({
      returning: mock(() =>
        Promise.resolve([row({ status: "executed", effect: "read", proposalNonce: null })]),
      ),
    }));
    const db = { insert: mock(() => ({ values })) };
    const store = createAiToolCallStore({ db: db as never });

    await store.recordExecuted({
      principal: { kind: "user", id: "u1" },
      transport: "mcp",
      toolName: "incident.list",
      argsHash: "h".repeat(64),
    });

    const inserted = values.mock.calls[0]?.[0] as {
      status: string;
      effect: string;
      proposalNonce?: string;
    };
    expect(inserted.status).toBe("executed");
    expect(inserted.effect).toBe("read");
    expect(inserted.proposalNonce).toBeUndefined();
  });

  test("consumeProposal issues an UPDATE ... WHERE status='proposed' (atomic single-use) and stamps the applier", async () => {
    const where = mock(() => ({
      returning: mock(() =>
        Promise.resolve([
          row({ status: "applied", appliedByKind: "user", appliedById: "u2" }),
        ]),
      ),
    }));
    const set = mock(
      (_v: {
        status: string;
        appliedAt: Date;
        appliedByKind: string;
        appliedById: string;
      }) => ({ where }),
    );
    const db = { update: mock(() => ({ set })) };
    const store = createAiToolCallStore({ db: db as never });

    const consumed = await store.consumeProposal({
      rowId: "r1",
      applier: { kind: "user", id: "u2" },
    });
    expect(consumed?.status).toBe("applied");
    // The set transitions to applied with an appliedAt timestamp + applier.
    const setArg = set.mock.calls[0]?.[0];
    expect(setArg?.status).toBe("applied");
    expect(setArg?.appliedAt).toBeInstanceOf(Date);
    // P3 review item 1: the actual applying principal is recorded.
    expect(setArg?.appliedByKind).toBe("user");
    expect(setArg?.appliedById).toBe("u2");
    // The atomic guard (id + status + TTL) is expressed in the WHERE clause.
    expect(where).toHaveBeenCalledTimes(1);
  });

  test("consumeProposal returns undefined when no row matches (already consumed)", async () => {
    const where = mock(() => ({
      returning: mock(() => Promise.resolve([])),
    }));
    const set = mock(() => ({ where }));
    const db = { update: mock(() => ({ set })) };
    const store = createAiToolCallStore({ db: db as never });
    expect(
      await store.consumeProposal({
        rowId: "r1",
        applier: { kind: "user", id: "u2" },
      }),
    ).toBeUndefined();
  });
});
