import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { Versioned, createServiceRef } from "@checkstack/backend-api";
// Deep import: the ServiceRegistry is a tiny, side-effect-free class. We use
// the REAL one (not a stub) so this test proves the production resolution
// path — `registry.get(ref, { pluginId })` — actually hands a registered
// service to a provider action at execute time. Importing `@checkstack/backend`'s
// index would connect to a DB at import; the deep path avoids that.
import { ServiceRegistry } from "@checkstack/backend/src/services/service-registry";
import { connectionStoreRef } from "@checkstack/integration-backend";
import { AutomationDefinitionSchema } from "@checkstack/automation-common";
import { createActionRegistry } from "../action-registry";
import { createArtifactTypeRegistry } from "../artifact-type-registry";
import type { ActionDefinition, ArtifactTypeDefinition } from "../action-types";
import { dispatchTrigger } from "./engine";
import { makeDispatchDeps, testPlugin } from "./test-fixtures";
import { createRunSecretRegistry } from "./run-secret-registry";
import { assembleDispatchGetService } from "./assemble-get-service";
import {
  CONNECTION_STORE_REF_ID,
  SECRET_RESOLVER_REF_ID,
} from "./secret-ref-ids";
import type { DispatchDeps, LoadedAutomation } from "./types";

/**
 * Integration coverage for the cross-plugin service-resolution seam used by
 * the automation dispatch engine.
 *
 * Background: provider actions (Jira / Teams / Webex create-issue etc.) and
 * the `secretEnv` script action resolve their deps through `getService` at
 * EXECUTE time — e.g. `await getService(connectionStoreRef)`. In production
 * the dispatch `getService` is the plugin `env.getService`, which resolves
 * through the real `ServiceRegistry`. The whole dispatch suite stubs
 * `getService` (via `makeDispatchDeps`), so a throwing stub in the
 * production assembly went unnoticed: every provider action would throw at
 * runtime.
 *
 * These tests use a REAL `ServiceRegistry` and build the dispatch
 * `getService` the way the plugin loader assembles `env.getService`:
 * `(ref) => registry.get(ref, { pluginId })`.
 */

const CONSUMER_PLUGIN_ID = "automation";

/** Build the dispatch `getService` exactly as the plugin loader's `env`. */
function makeRegistryBackedGetService(registry: ServiceRegistry) {
  return <T>(ref: { id: string; T: T; toString(): string }): Promise<T> =>
    registry.get(ref, { pluginId: CONSUMER_PLUGIN_ID });
}

/** A provider-style fake connection store keyed by the real ref id. */
interface FakeConnectionStore {
  getConnectionWithCredentials(
    connectionId: string,
  ): Promise<{ config: Record<string, unknown> } | undefined>;
}

function automation(actions: unknown[]): LoadedAutomation {
  const definition = AutomationDefinitionSchema.parse({
    name: "Test",
    triggers: [{ event: "test.event" }],
    conditions: [],
    actions,
    mode: "single",
    max_runs: 10,
  });
  return { id: "auto-1", name: "Test", status: "enabled", definition, runAs: "app-test" };
}

/**
 * A provider-style action that resolves the connection store via
 * `getService` (mirroring `integration-jira-backend`'s `create_issue`) and
 * produces an artifact echoing the resolved credential — so we can assert
 * (a) resolution succeeded and (b) the credential is masked in step output.
 */
function makeProviderAction(opts?: { storeRefId?: string }): {
  definition: ActionDefinition<{ connectionId: string }, { token: string }>;
  artifactType: ArtifactTypeDefinition<{ token: string }>;
  resolved: string[];
} {
  const resolved: string[] = [];
  const storeRefId = opts?.storeRefId ?? CONNECTION_STORE_REF_ID;
  // Ref typed to the minimal shape the action uses; same id as the real
  // `connectionStoreRef` so the run-secret masking interceptor matches.
  const storeRef = createServiceRef<FakeConnectionStore>(storeRefId);
  return {
    artifactType: {
      id: "issue",
      displayName: "Issue (fake provider)",
      schema: z.object({ token: z.string() }),
    },
    definition: {
      id: "create_issue",
      displayName: "Create Issue (fake provider)",
      produces: "issue",
      config: new Versioned({
        version: 1,
        schema: z.object({ connectionId: z.string() }),
      }),
      execute: async ({ config, getService }) => {
        const store = await getService(storeRef);
        const conn = await store.getConnectionWithCredentials(
          config.connectionId,
        );
        const token = String(conn?.config.token ?? "");
        resolved.push(token);
        return { success: true, artifact: { token } };
      },
    },
    resolved,
  };
}

describe("dispatch getService wiring (cross-plugin resolution)", () => {
  it("resolves a registered connection store through the real ServiceRegistry-backed getService", async () => {
    const registry = new ServiceRegistry();
    const fakeStore: FakeConnectionStore = {
      async getConnectionWithCredentials() {
        return { config: { token: "live-token-123", baseUrl: "https://x" } };
      },
    };
    // Register under the REAL connection-store ref (typed `ConnectionStore`);
    // the action resolves a same-id ref with a minimal structural shape.
    registry.register(
      connectionStoreRef,
      fakeStore as unknown as (typeof connectionStoreRef)["T"],
    );

    const actions = createActionRegistry();
    const artifactTypes = createArtifactTypeRegistry();
    const provider = makeProviderAction();
    actions.register(
      provider.definition as ActionDefinition<unknown, unknown>,
      testPlugin,
    );
    artifactTypes.register(
      provider.artifactType as ArtifactTypeDefinition<unknown>,
      testPlugin,
    );

    const { deps } = makeDispatchDeps({ actions, artifactTypes });
    // Replace the test stub with the PRODUCTION assembly: env.getService.
    const wired: DispatchDeps = {
      ...deps,
      getService: makeRegistryBackedGetService(registry),
    };

    const result = await dispatchTrigger(wired, {
      automation: automation([
        {
          id: "create",
          action: "test.create_issue",
          config: { connectionId: "conn-1" },
        },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });

    expect(result.status).toBe("success");
    // The action RESOLVED the fake store (did not throw "not yet wired").
    expect(provider.resolved).toEqual(["live-token-123"]);
  });

  it("captures a credential resolved through the real getService into the run mask set (5c end-to-end)", async () => {
    const registry = new ServiceRegistry();
    const fakeStore: FakeConnectionStore = {
      async getConnectionWithCredentials() {
        return { config: { token: "secret-cred-XYZ" } };
      },
    };
    registry.register(
      connectionStoreRef,
      fakeStore as unknown as (typeof connectionStoreRef)["T"],
    );

    const actions = createActionRegistry();
    const artifactTypes = createArtifactTypeRegistry();
    const provider = makeProviderAction();
    actions.register(
      provider.definition as ActionDefinition<unknown, unknown>,
      testPlugin,
    );
    artifactTypes.register(
      provider.artifactType as ArtifactTypeDefinition<unknown>,
      testPlugin,
    );

    const { deps, runs } = makeDispatchDeps({ actions, artifactTypes });
    // Production assembly: real getService + run-secret registry + ref ids.
    // The engine wraps each run's getService (wrapGetServiceForRun): once
    // the real getService is wired, resolving the connection store
    // registers the credential into the run's mask set, which the run-state
    // persistence choke point then masks before write (covered by
    // run-state-masking.test.ts).
    const secretRegistry = createRunSecretRegistry();
    const wired: DispatchDeps = {
      ...deps,
      getService: makeRegistryBackedGetService(registry),
      secretRegistry,
      secretResolverRefId: SECRET_RESOLVER_REF_ID,
      connectionStoreRefId: CONNECTION_STORE_REF_ID,
    };

    const result = await dispatchTrigger(wired, {
      automation: automation([
        {
          id: "create",
          action: "test.create_issue",
          config: { connectionId: "conn-1" },
        },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });

    expect(result.status).toBe("success");
    expect(provider.resolved).toEqual(["secret-cred-XYZ"]);
    // The run's mask set captured the resolved credential — proving the
    // real getService activates Phase-5c masking. Without the fix (throwing
    // stub) the action never resolves and nothing is captured.
    const runId = runs.runs.keys().next().value as string;
    expect(secretRegistry.maskText(runId, "token=secret-cred-XYZ")).toBe(
      "token=****",
    );
  });

  it("throws a clear error when an action resolves an UNregistered ref (fail loud, not undefined)", async () => {
    const registry = new ServiceRegistry();
    // Intentionally register nothing.
    const actions = createActionRegistry();
    const artifactTypes = createArtifactTypeRegistry();
    const provider = makeProviderAction();
    actions.register(
      provider.definition as ActionDefinition<unknown, unknown>,
      testPlugin,
    );
    artifactTypes.register(
      provider.artifactType as ArtifactTypeDefinition<unknown>,
      testPlugin,
    );

    const { deps, runs } = makeDispatchDeps({ actions, artifactTypes });
    const wired: DispatchDeps = {
      ...deps,
      getService: makeRegistryBackedGetService(registry),
    };

    const result = await dispatchTrigger(wired, {
      automation: automation([
        {
          id: "create",
          action: "test.create_issue",
          config: { connectionId: "conn-1" },
        },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });

    // The run fails loudly (resolution threw) rather than the action seeing
    // `undefined` and behaving unpredictably.
    expect(result.status).toBe("failed");
    const step = runs.steps.find((s) => s.actionId === "create");
    expect(step?.status).toBe("failed");
    expect(step?.errorMessage).toContain(CONNECTION_STORE_REF_ID);
  });
});

/**
 * Guard for the EXACT regression class: the production dispatchDeps must
 * assemble a REAL, registry-backed `getService` — never a throwing stub.
 * `index.ts` builds it via `assembleDispatchGetService({ envGetService })`,
 * so exercising that helper with a real ServiceRegistry-backed env proves
 * the assembled value resolves registered refs and fails loud on missing
 * ones.
 */
describe("assembleDispatchGetService (production dispatchDeps.getService)", () => {
  function envGetServiceFor(registry: ServiceRegistry) {
    return <T>(ref: { id: string; T: T; toString(): string }): Promise<T> =>
      registry.get(ref, { pluginId: CONSUMER_PLUGIN_ID });
  }

  it("is NOT a throwing stub — resolves a registered ref", async () => {
    const registry = new ServiceRegistry();
    const ref = createServiceRef<{ ok: boolean }>("some.service");
    registry.register(ref, { ok: true });

    const getService = assembleDispatchGetService({
      envGetService: envGetServiceFor(registry),
    });
    const resolved = await getService(ref);
    expect(resolved.ok).toBe(true);
  });

  it("propagates a clear error on a missing ref (fail loud)", async () => {
    const registry = new ServiceRegistry();
    const getService = assembleDispatchGetService({
      envGetService: envGetServiceFor(registry),
    });
    const ref = createServiceRef<{ ok: boolean }>("absent.service");

    let error: unknown;
    try {
      await getService(ref);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("absent.service");
  });
});
