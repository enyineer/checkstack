import { describe, it, expect } from "bun:test";
import { createRunStateStore } from "./run-state-store";
import { createRunSecretRegistry } from "./run-secret-registry";
import { createArtifactStore } from "../artifact-store";
import type { AdvisoryLockService } from "@checkstack/backend-api";

/**
 * H2 — the run-wide masking choke point must ALSO cover the scope snapshot
 * (run-state) and produced artifacts. A resolved connection credential
 * threaded into `scope.variables` / an artifact's `data` must be redacted
 * BEFORE persist, so `getRunScopeForReplay` (which reads those rows
 * verbatim, gated only on automationAccess.read) can never hand a
 * read-only user the live value.
 *
 * Uses a capturing fake `db` (the established boundary for these store
 * tests) so we assert on exactly what the store writes to the DB layer —
 * which is what the replay endpoint later reads back.
 */

interface Captured {
  inserts: Array<{ values: Record<string, unknown> }>;
}

function capturingDb(captured: Captured) {
  const chain = {
    values(v: Record<string, unknown>) {
      captured.inserts.push({ values: v });
      return {
        returning() {
          return Promise.resolve([{ id: "generated-id", ...v }]);
        },
        onConflictDoUpdate() {
          return Promise.resolve();
        },
      };
    },
  };
  const db = {
    insert() {
      return chain;
    },
  };
  return db;
}

const noopAdvisoryLock: AdvisoryLockService = {
  tryAcquire: async () => ({ release: async () => {} }),
  withXactLock<T>({ fn }: { key: string; fn: () => Promise<T> }): Promise<T> {
    return fn();
  },
};

describe("H2 — scope snapshot masking (run-state choke point)", () => {
  it("masks a resolved credential surfaced into scope.variables before persist", async () => {
    const captured: Captured = { inserts: [] };
    const registry = createRunSecretRegistry();
    // The run resolved this connection credential during execution (the
    // wrapped connection store registered it).
    registry.register("run-1", ["super-secret-token-123"]);

    const store = createRunStateStore(
      capturingDb(captured) as unknown as Parameters<
        typeof createRunStateStore
      >[0],
      noopAdvisoryLock,
      registry,
    );

    await store.upsert({
      runId: "run-1",
      scopeSnapshot: {
        variables: { apiKey: "super-secret-token-123" },
        artifacts: {},
      },
      lastActionPath: "actions[0]",
    });

    const persisted = captured.inserts.at(-1)!.values;
    // This is exactly the row getRunScopeForReplay would read back.
    expect(JSON.stringify(persisted.scopeSnapshot)).not.toContain(
      "super-secret-token-123",
    );
    expect(persisted.scopeSnapshot).toEqual({
      variables: { apiKey: "****" },
      artifacts: {},
    });
  });

  it("least-privilege: a value not resolved in the run is left intact", async () => {
    const captured: Captured = { inserts: [] };
    const registry = createRunSecretRegistry();
    const store = createRunStateStore(
      capturingDb(captured) as unknown as Parameters<
        typeof createRunStateStore
      >[0],
      noopAdvisoryLock,
      registry,
    );
    await store.upsert({
      runId: "run-x",
      scopeSnapshot: { variables: { note: "not-a-secret" } },
      lastActionPath: null,
    });
    const persisted = captured.inserts.at(-1)!.values;
    expect(persisted.scopeSnapshot).toEqual({
      variables: { note: "not-a-secret" },
    });
  });
});

describe("H2 — artifact data masking (artifact-store choke point)", () => {
  it("masks a resolved credential surfaced into a produced artifact before insert", async () => {
    const captured: Captured = { inserts: [] };
    const registry = createRunSecretRegistry();
    registry.register("run-2", ["resolved-cred-XYZ"]);

    const store = createArtifactStore(
      capturingDb(captured) as unknown as Parameters<
        typeof createArtifactStore
      >[0],
      registry,
    );

    await store.record({
      automationId: "auto-1",
      runId: "run-2",
      stepId: "step-1",
      actionId: "a1",
      artifactType: "integration-jira.issue",
      data: { url: "https://x", auth: "Bearer resolved-cred-XYZ" },
      contextKey: "incident-1",
    });

    const persisted = captured.inserts.at(-1)!.values;
    expect(JSON.stringify(persisted.data)).not.toContain("resolved-cred-XYZ");
    expect(persisted.data).toEqual({
      url: "https://x",
      auth: "Bearer ****",
    });
  });
});
