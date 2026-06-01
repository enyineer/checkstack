import { describe, it, expect } from "bun:test";
import type { ServiceRef } from "@checkstack/backend-api";
import { AutomationDefinitionSchema } from "@checkstack/automation-common";
import { createRunStore } from "./run-state";
import { createRunStateStore } from "./run-state-store";
import { createArtifactStore } from "../artifact-store";
import {
  createRunSecretRegistry,
  wrapGetServiceForRun,
} from "./run-secret-registry";
import { reseedRunSecretRegistry } from "./reseed-run-secrets";
import type { AdvisoryLockService } from "@checkstack/backend-api";

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
              return Promise.resolve([{ id: "generated-id", ...v }]);
            },
            onConflictDoUpdate() {
              return Promise.resolve();
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

// ─── L2 cross-pod masking ───────────────────────────────────────────────

const RESOLVER_REF_ID = "secrets.resolver";
const CONNECTION_REF_ID = "integration.connectionStore";
const RUN_ID = "run-suspended";
const POD_A_CRED = "podA-resolved-cred-XYZ";

/**
 * A SHARED secret backend both pods read through — the value lives in the
 * cluster's secret/connection store, not on any one pod. Pod A and pod B get
 * their own (per-process) mask registry, but resolve against this same store.
 */
function sharedSecretBackend() {
  return {
    resolver: {
      resolveSecret: async () => POD_A_CRED,
      resolveForRun: async () => ({
        env: { API_TOKEN: POD_A_CRED },
        masking: {},
      }),
      resolveBySchema: async () => ({ resolved: {}, warnings: [] }),
    },
    connectionStore: {
      getConnectionWithCredentials: async () => ({
        config: { baseUrl: "https://jira.example", apiToken: POD_A_CRED },
      }),
    },
  };
}

/** A getService over the shared backend, keyed by the two intercepted refs. */
function sharedGetService(backend: ReturnType<typeof sharedSecretBackend>) {
  return async <T>(refArg: ServiceRef<T>): Promise<T> => {
    if (refArg.id === RESOLVER_REF_ID) {
      return backend.resolver as unknown as T;
    }
    if (refArg.id === CONNECTION_REF_ID) {
      return backend.connectionStore as unknown as T;
    }
    throw new Error(`unexpected ref ${refArg.id}`);
  };
}

/**
 * Definition whose action uses BOTH a `secretEnv` mapping and a connection
 * — the declared secret refs the resume path must re-resolve.
 */
function definitionUsingSecrets() {
  return AutomationDefinitionSchema.parse({
    name: "Cross-pod masking",
    triggers: [{ event: "incident.created" }],
    conditions: [],
    actions: [
      {
        action: "integration-jira.create_issue",
        config: {
          connectionId: "conn-1",
          secretEnv: { API_TOKEN: "${{ secrets.jira_token }}" },
        },
      },
      { wait_for_trigger: { event: "incident.resolved" } },
      {
        action: "integration-script.run",
        config: { script: "echo done" },
      },
    ],
    mode: "single",
    max_runs: 1,
  });
}

describe("L2 cross-pod masking — resume on a fresh pod re-seeds the mask set", () => {
  it("WITHOUT re-seed: a fresh pod-B registry persists pod-A's secret UNMASKED (the leak)", async () => {
    // Pod B comes up cold: it never resolved this run's secrets, so its mask
    // set is empty.
    const podBRegistry = createRunSecretRegistry();
    const captured: Captured = { inserts: [], updates: [] };
    const store = createRunStore(capturingDb(captured), undefined, podBRegistry);

    // Pod B persists a step whose output still carries pod-A's credential
    // (e.g. a carried-over value surfaced post-resume).
    const stepId = await store.createStep({
      runId: RUN_ID,
      actionPath: "actions[2]",
      actionId: "a3",
      actionKind: "action",
      providerActionId: "integration-script.run",
    });
    await store.updateStep(stepId, {
      status: "success",
      resultPayload: { echoed: `token=${POD_A_CRED}` },
    });

    const stepUpdate = captured.updates.at(-1)!;
    // The leak: an empty mask set leaves the value intact in the persisted row.
    expect(JSON.stringify(stepUpdate)).toContain(POD_A_CRED);
  });

  it("WITH re-seed: pod B re-resolves declared refs, so the same persist is masked", async () => {
    const backend = sharedSecretBackend();
    const podBRegistry = createRunSecretRegistry();
    const wrappedGetService = wrapGetServiceForRun({
      getService: sharedGetService(backend),
      runId: RUN_ID,
      registry: podBRegistry,
      resolverRefId: RESOLVER_REF_ID,
      connectionStoreRefId: CONNECTION_REF_ID,
    });

    // The fix: before walking/persisting, the resuming pod re-seeds its mask
    // set from the automation's declared secret refs.
    await reseedRunSecretRegistry({
      getService: wrappedGetService,
      registry: podBRegistry,
      runId: RUN_ID,
      definition: definitionUsingSecrets(),
      resolverRefId: RESOLVER_REF_ID,
      connectionStoreRefId: CONNECTION_REF_ID,
    });

    // Now every choke point on pod B masks pod-A's value.
    const captured: Captured = { inserts: [], updates: [] };
    const runStore = createRunStore(
      capturingDb(captured),
      undefined,
      podBRegistry,
    );
    const stepId = await runStore.createStep({
      runId: RUN_ID,
      actionPath: "actions[2]",
      actionId: "a3",
      actionKind: "action",
      providerActionId: "integration-script.run",
    });
    await runStore.updateStep(stepId, {
      status: "success",
      resultPayload: { echoed: `token=${POD_A_CRED}` },
      errorMessage: undefined,
    });
    const stepUpdate = captured.updates.at(-1)!;
    expect(stepUpdate.resultPayload).toEqual({ echoed: "token=****" });
    expect(JSON.stringify(stepUpdate)).not.toContain(POD_A_CRED);

    // The scope-snapshot choke point (run-state) is masked too.
    const noopAdvisoryLock: AdvisoryLockService = {
      tryAcquire: async () => ({ release: async () => {} }),
      withXactLock<T>({ fn }: { key: string; fn: () => Promise<T> }): Promise<T> {
        return fn();
      },
    };
    const stateCaptured: Captured = { inserts: [], updates: [] };
    const stateStore = createRunStateStore(
      capturingDb(stateCaptured) as unknown as Parameters<
        typeof createRunStateStore
      >[0],
      noopAdvisoryLock,
      podBRegistry,
    );
    await stateStore.upsert({
      runId: RUN_ID,
      scopeSnapshot: { variables: { carried: POD_A_CRED }, artifacts: {} },
      lastActionPath: "actions[2]",
    });
    const persistedScope = stateCaptured.inserts.at(-1)!.values;
    expect(JSON.stringify(persistedScope.scopeSnapshot)).not.toContain(
      POD_A_CRED,
    );
    expect(persistedScope.scopeSnapshot).toEqual({
      variables: { carried: "****" },
      artifacts: {},
    });

    // And a produced artifact echoing the credential is masked.
    const artCaptured: Captured = { inserts: [], updates: [] };
    const artifactStore = createArtifactStore(
      capturingDb(artCaptured) as unknown as Parameters<
        typeof createArtifactStore
      >[0],
      podBRegistry,
    );
    await artifactStore.record({
      automationId: "auto-1",
      runId: RUN_ID,
      stepId,
      actionId: "a3",
      artifactType: "integration-jira.issue",
      data: { url: "https://x", auth: `Bearer ${POD_A_CRED}` },
      contextKey: "incident-1",
    });
    const persistedArtifact = artCaptured.inserts.at(-1)!.values;
    expect(JSON.stringify(persistedArtifact.data)).not.toContain(POD_A_CRED);
    expect(persistedArtifact.data).toEqual({
      url: "https://x",
      auth: "Bearer ****",
    });
  });

  it("re-seed is a no-op for a definition that declares no secret refs", async () => {
    const backend = sharedSecretBackend();
    const registry = createRunSecretRegistry();
    const wrapped = wrapGetServiceForRun({
      getService: sharedGetService(backend),
      runId: "run-clean",
      registry,
      resolverRefId: RESOLVER_REF_ID,
      connectionStoreRefId: CONNECTION_REF_ID,
    });
    const definition = AutomationDefinitionSchema.parse({
      name: "No secrets",
      triggers: [{ event: "x.y" }],
      conditions: [],
      actions: [{ variables: { greeting: "hi" } }],
      mode: "single",
      max_runs: 1,
    });
    await reseedRunSecretRegistry({
      getService: wrapped,
      registry,
      runId: "run-clean",
      definition,
      resolverRefId: RESOLVER_REF_ID,
      connectionStoreRefId: CONNECTION_REF_ID,
    });
    // Nothing registered, so an unrelated value is left intact.
    expect(registry.maskText("run-clean", `x=${POD_A_CRED}`)).toBe(
      `x=${POD_A_CRED}`,
    );
  });
});
