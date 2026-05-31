import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createHook, type HookSubscribeOptions } from "@checkstack/backend-api";
import type { TriggerDefinition } from "../action-types";
import { createTriggerRegistry } from "../trigger-registry";
import type { AutomationStore } from "../automation-store";
import {
  setupTriggerSubscriptions,
  type OnHookFn,
} from "./trigger-subscriber";
import { makeDispatchDeps } from "./test-fixtures";

/**
 * Tier-1 contract regression guard for the horizontal-scale fan-in.
 *
 * Every hook-backed trigger MUST be subscribed in `mode: "work-queue"` with
 * a per-trigger `workerGroup`. That is what makes exactly ONE pod consume a
 * given trigger emission across the fleet; dropping it would silently
 * revert to broadcast delivery, double-firing every automation once per
 * running pod.
 *
 * This guard can't prove exactly-once delivery (that needs a real BullMQ
 * work queue — Tier 2), but it catches an accidental removal / mistyping of
 * the work-queue options at the wiring boundary.
 */

function triggerFor(id: string): TriggerDefinition<{ id: string }> {
  return {
    id,
    displayName: id,
    payloadSchema: z.object({ id: z.string() }),
    hook: createHook<{ id: string }>(`test.${id}`),
    contextKey: (p) => p.id,
  };
}

const emptyStore: AutomationStore = {
  create: async () => {
    throw new Error("nope");
  },
  update: async () => {
    throw new Error("nope");
  },
  delete: async () => {},
  toggle: async () => {
    throw new Error("nope");
  },
  getById: async () => undefined,
  list: async () => ({ items: [], total: 0 }),
  findEnabledByTriggerEvent: async () => [],
  listEnabled: async () => [],
};

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Parameters<typeof setupTriggerSubscriptions>[0]["logger"];

describe("trigger fan-in — single-consumer (work-queue) contract", () => {
  it("subscribes every hook-backed trigger in work-queue mode with a per-trigger workerGroup", async () => {
    const triggers = createTriggerRegistry();
    triggers.register(triggerFor("alpha"), { pluginId: "plug" });
    triggers.register(triggerFor("beta"), { pluginId: "plug" });

    const { deps } = makeDispatchDeps({ triggers });

    // Spy onHook: capture (hookId, options) per subscription and hand back a
    // no-op teardown so setup completes.
    const captured: Array<{
      hookId: string;
      options: HookSubscribeOptions | undefined;
    }> = [];
    const onHook: OnHookFn = (hook, _listener, options) => {
      captured.push({ hookId: hook.id, options });
      return async () => {};
    };

    await setupTriggerSubscriptions({
      deps,
      onHook,
      automationStore: emptyStore,
      logger: noopLogger,
    });

    expect(captured).toHaveLength(2);
    for (const { hookId, options } of captured) {
      expect(options).toEqual({
        mode: "work-queue",
        workerGroup: `automation-trigger-${qualifiedIdForHook(hookId)}`,
      });
    }

    // Each per-trigger workerGroup is distinct so the two triggers fan in on
    // independent consumer groups (a shared group would serialize unrelated
    // triggers).
    const groups = captured.map((c) => c.options?.workerGroup);
    expect(new Set(groups).size).toBe(2);
  });
});

/**
 * The hook id is `test.<triggerId>` and the qualified id is
 * `plug.<triggerId>`; map one to the other for the assertion.
 */
function qualifiedIdForHook(hookId: string): string {
  const triggerId = hookId.replace(/^test\./, "");
  return `plug.${triggerId}`;
}
