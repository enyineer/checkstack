import { describe, it, expect } from "bun:test";
import { createRunStore } from "./run-state";
import { createRunSecretRegistry } from "./run-secret-registry";

/**
 * Asserts the run-state persistence CHOKE POINT masks resolved secret
 * values out of step / run output before they are written — so any
 * downstream read / DTO / run-detail page is safe by construction.
 *
 * Uses a capturing fake `db` (the established boundary avoids real-DB
 * tests); we assert on the values the store hands to the DB layer.
 */

interface Captured {
  inserts: Array<{ table: string; values: Record<string, unknown> }>;
  updates: Array<Record<string, unknown>>;
}

function capturingDb(captured: Captured) {
  // The store calls: insert(table).values(v).returning() and
  // update(table).set(v).where(). We capture v and synthesize ids.
  let lastInsertTable = "";
  const db = {
    insert(table: { [k: string]: unknown }) {
      lastInsertTable = String(
        (table as { _?: { name?: string } })._?.name ?? "table",
      );
      return {
        values(v: Record<string, unknown>) {
          captured.inserts.push({ table: lastInsertTable, values: v });
          return {
            returning() {
              return Promise.resolve([{ id: "generated-id" }]);
            },
          };
        },
      };
    },
    update() {
      return {
        set(v: Record<string, unknown>) {
          captured.updates.push(v);
          return {
            where() {
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
  // The store's typed signature wants a SafeDatabase; this fake implements
  // only the chains exercised here.
  return db as unknown as Parameters<typeof createRunStore>[0];
}

describe("run-state masking choke point", () => {
  it("masks a step resultPayload + errorMessage that contain a resolved secret before persist", async () => {
    const captured: Captured = { inserts: [], updates: [] };
    const registry = createRunSecretRegistry();
    const store = createRunStore(capturingDb(captured), undefined, registry);

    // A run resolved this credential during execution.
    registry.register("run-1", ["resolved-cred-XYZ"]);

    const stepId = await store.createStep({
      runId: "run-1",
      actionPath: "actions[0]",
      actionId: "a1",
      actionKind: "action",
      providerActionId: "integration-jira.create_issue",
    });

    // A provider HTTP error embedding the credential + a payload echoing it.
    await store.updateStep(stepId, {
      status: "failed",
      errorMessage: "401 from Jira using token resolved-cred-XYZ",
      resultPayload: { detail: { auth: "Bearer resolved-cred-XYZ" } },
    });

    const stepUpdate = captured.updates.at(-1)!;
    expect(stepUpdate.errorMessage).toBe("401 from Jira using token ****");
    expect(stepUpdate.resultPayload).toEqual({
      detail: { auth: "Bearer ****" },
    });
    expect(JSON.stringify(stepUpdate)).not.toContain("resolved-cred-XYZ");
  });

  it("masks the run-level errorMessage before persist", async () => {
    const captured: Captured = { inserts: [], updates: [] };
    const registry = createRunSecretRegistry();
    const store = createRunStore(capturingDb(captured), undefined, registry);
    registry.register("run-2", ["run-cred-999"]);

    await store.updateRunStatus(
      "run-2",
      "failed",
      "run failed: leaked run-cred-999 in error",
    );

    const runUpdate = captured.updates.at(-1)!;
    expect(runUpdate.errorMessage).toBe("run failed: leaked **** in error");
    expect(JSON.stringify(runUpdate)).not.toContain("run-cred-999");
  });

  it("least-privilege: a value not resolved in the run is left intact", async () => {
    const captured: Captured = { inserts: [], updates: [] };
    const registry = createRunSecretRegistry();
    const store = createRunStore(capturingDb(captured), undefined, registry);
    // run-3 resolved nothing.
    const stepId = await store.createStep({
      runId: "run-3",
      actionPath: "actions[0]",
      actionId: "a1",
      actionKind: "log",
      providerActionId: null,
    });
    await store.updateStep(stepId, {
      status: "success",
      resultPayload: { message: "not-a-secret-value" },
    });
    const stepUpdate = captured.updates.at(-1)!;
    expect(stepUpdate.resultPayload).toEqual({ message: "not-a-secret-value" });
  });

  it("drops the run's mask set once the run reaches a terminal status", async () => {
    const captured: Captured = { inserts: [], updates: [] };
    const registry = createRunSecretRegistry();
    const store = createRunStore(capturingDb(captured), undefined, registry);
    registry.register("run-4", ["transient-cred"]);
    await store.updateRunStatus("run-4", "success");
    // After terminal, the value is no longer in the registry (memory-only).
    expect(registry.maskText("run-4", "x=transient-cred")).toBe(
      "x=transient-cred",
    );
  });
});
