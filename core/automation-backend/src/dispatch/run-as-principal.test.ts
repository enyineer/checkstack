import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { Versioned, type RpcClient } from "@checkstack/backend-api";
import { AutomationDefinitionSchema } from "@checkstack/automation-common";
import { createActionRegistry } from "../action-registry";
import type { ActionDefinition } from "../action-types";
import { dispatchTrigger } from "./engine";
import { makeDispatchDeps, testPlugin } from "./test-fixtures";
import type { DispatchDeps, LoadedAutomation } from "./types";

/**
 * The automation `runAs` service-account threading.
 *
 * Proves the two runtime guarantees the security model depends on:
 *  1. Every action's `context.rpcClient` is built from the automation's
 *     `runAs` via `deps.rpcClientForApplication(runAs)` - so all action data
 *     access authenticates as the bounded service account, NOT the trusted
 *     service client.
 *  2. An automation with NO `runAs` fails loudly at action execution rather
 *     than silently falling back to a broader client (no god mode).
 */

function automation(actions: unknown[], runAs: string | null): LoadedAutomation {
  const definition = AutomationDefinitionSchema.parse({
    name: "Test",
    triggers: [{ event: "test.event" }],
    conditions: [],
    actions,
    mode: "single",
    max_runs: 10,
  });
  return { id: "auto-1", name: "Test", status: "enabled", definition, runAs };
}

/** An action that records the application id its `rpcClient` was built for. */
function makeProbeAction(): {
  definition: ActionDefinition<Record<string, never>, undefined>;
  seen: string[];
} {
  const seen: string[] = [];
  return {
    seen,
    definition: {
      id: "probe",
      displayName: "Probe",
      config: new Versioned({ version: 1, schema: z.object({}) }),
      execute: async ({ rpcClient }) => {
        // forPlugin returns a tagged marker carrying the app id (see the spy
        // factory below), so we can prove WHICH identity the client is bound to.
        const tag = (
          rpcClient.forPlugin as unknown as () => { __appId: string }
        )();
        seen.push(tag.__appId);
        return { success: true };
      },
    },
  };
}

describe("automation runs as its `runAs` service account", () => {
  it("threads a `runAs`-scoped rpcClient into every action", async () => {
    const actions = createActionRegistry();
    const probe = makeProbeAction();
    actions.register(
      probe.definition as ActionDefinition<unknown, unknown>,
      testPlugin,
    );

    const { deps } = makeDispatchDeps({ actions });
    const builtFor: string[] = [];
    const wired: DispatchDeps = {
      ...deps,
      rpcClientForApplication: async (applicationId: string) => {
        builtFor.push(applicationId);
        return {
          forPlugin: () => ({ __appId: applicationId }),
        } as unknown as RpcClient;
      },
    };

    const result = await dispatchTrigger(wired, {
      automation: automation(
        [{ id: "p", action: "test.probe", config: {} }],
        "svc-acct-7",
      ),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });

    expect(result.status).toBe("success");
    // The per-run client was minted for the automation's runAs...
    expect(builtFor).toEqual(["svc-acct-7"]);
    // ...and the action actually received THAT identity's client.
    expect(probe.seen).toEqual(["svc-acct-7"]);
  });

  it("fails the action loudly when no `runAs` is assigned (no god-mode fallback)", async () => {
    const actions = createActionRegistry();
    const probe = makeProbeAction();
    actions.register(
      probe.definition as ActionDefinition<unknown, unknown>,
      testPlugin,
    );

    const { deps, runs } = makeDispatchDeps({ actions });
    let factoryCalled = false;
    const wired: DispatchDeps = {
      ...deps,
      rpcClientForApplication: async () => {
        factoryCalled = true;
        return { forPlugin: () => ({}) } as unknown as RpcClient;
      },
    };

    const result = await dispatchTrigger(wired, {
      automation: automation(
        [{ id: "p", action: "test.probe", config: {} }],
        null,
      ),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });

    expect(result.status).toBe("failed");
    const step = runs.steps.find((s) => s.actionId === "p");
    expect(step?.status).toBe("failed");
    expect(step?.errorMessage).toMatch(/service account|runAs/i);
    // The action never ran, and no client was minted for a null identity.
    expect(probe.seen).toEqual([]);
    expect(factoryCalled).toBe(false);
  });
});

/**
 * The runAs service account must hold an action's `requiredAccessRules` for it
 * to run - the only authorization point for actions (e.g. integration actions)
 * that resolve credentials through a trusted service rather than the bounded
 * `rpcClient`. Without this, merely being able to author automations would grant
 * the ability to act on any integration.
 */
describe("action requiredAccessRules enforced against runAs", () => {
  /** A probe action that requires `test.thing.manage` to run. */
  function makeGatedProbe(): {
    definition: ActionDefinition<Record<string, never>, undefined>;
    ran: { value: boolean };
  } {
    const ran = { value: false };
    return {
      ran,
      definition: {
        id: "gated",
        displayName: "Gated",
        config: new Versioned({ version: 1, schema: z.object({}) }),
        requiredAccessRules: ["test.thing.manage"],
        execute: async () => {
          ran.value = true;
          return { success: true };
        },
      },
    };
  }

  function wire(
    deps: DispatchDeps,
    resolveRunAsAccessRules?: (id: string) => Promise<string[]>,
  ): DispatchDeps {
    return {
      ...deps,
      rpcClientForApplication: async () =>
        ({ forPlugin: () => ({}) }) as unknown as RpcClient,
      resolveRunAsAccessRules,
    };
  }

  async function run(deps: DispatchDeps) {
    return dispatchTrigger(deps, {
      automation: automation(
        [{ id: "g", action: "test.gated", config: {} }],
        "svc-1",
      ),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
  }

  it("runs when the runAs holds the required rule", async () => {
    const actions = createActionRegistry();
    const probe = makeGatedProbe();
    actions.register(probe.definition as ActionDefinition<unknown, unknown>, testPlugin);
    const { deps } = makeDispatchDeps({ actions });

    const result = await run(wire(deps, async () => ["test.thing.manage"]));
    expect(result.status).toBe("success");
    expect(probe.ran.value).toBe(true);
  });

  it("fails the action when the runAs lacks the rule, and never runs it", async () => {
    const actions = createActionRegistry();
    const probe = makeGatedProbe();
    actions.register(probe.definition as ActionDefinition<unknown, unknown>, testPlugin);
    const { deps, runs } = makeDispatchDeps({ actions });

    const result = await run(wire(deps, async () => ["something.else.read"]));
    expect(result.status).toBe("failed");
    expect(probe.ran.value).toBe(false);
    const step = runs.steps.find((s) => s.actionId === "g");
    expect(step?.errorMessage).toMatch(/not permitted|missing access rule/i);
    expect(step?.errorMessage).toMatch(/test\.thing\.manage/);
  });

  it("a wildcard runAs satisfies the rule", async () => {
    const actions = createActionRegistry();
    const probe = makeGatedProbe();
    actions.register(probe.definition as ActionDefinition<unknown, unknown>, testPlugin);
    const { deps } = makeDispatchDeps({ actions });

    const result = await run(wire(deps, async () => ["*"]));
    expect(result.status).toBe("success");
    expect(probe.ran.value).toBe(true);
  });

  it("fails closed when no rule resolver is wired", async () => {
    const actions = createActionRegistry();
    const probe = makeGatedProbe();
    actions.register(probe.definition as ActionDefinition<unknown, unknown>, testPlugin);
    const { deps } = makeDispatchDeps({ actions });

    const result = await run(wire(deps, undefined));
    expect(result.status).toBe("failed");
    expect(probe.ran.value).toBe(false);
  });
});
