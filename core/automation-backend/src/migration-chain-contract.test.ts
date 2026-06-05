/**
 * Contract test: every automation config that is stored UNVERSIONED and
 * read back via assume-v1-on-read MUST have a COMPLETE, contiguous
 * migration chain from version 1 to its current `version`.
 *
 * This is a pure STRUCTURAL check on the `Versioned.migrations` array
 * (`validateMigrationChainFromV1` — no `migrate()` is run on dummy data),
 * so it carries zero per-config upkeep: the day someone bumps a config's
 * `version` without shipping a covering migration, `parseAssumingV1` would
 * silently fail at runtime — this test turns that into a CI failure
 * instead.
 *
 * It enumerates the triggers + actions a registry actually holds, so new
 * built-in triggers / actions are covered automatically. Per-plugin
 * configs (e.g. the script actions) are guarded by an equivalent contract
 * test in their owning package.
 */
import { describe, expect, it } from "bun:test";
import type { QueueManager } from "@checkstack/queue-api";
import { definePluginMetadata } from "@checkstack/common";
import { createTriggerRegistry } from "./trigger-registry";
import { createActionRegistry } from "./action-registry";
import { registerBuiltinTriggers } from "./builtin-triggers";

const meta = definePluginMetadata({ pluginId: "automation" });

// `registerBuiltinTriggers` only constructs the trigger definitions; the
// queue is touched lazily inside `setup()`, which the contract check never
// calls. A stub is sufficient.
const stubQueueManager = {} as unknown as QueueManager;

describe("automation config migration-chain contract", () => {
  it("every built-in trigger config has a complete v1->version chain", () => {
    const triggerRegistry = createTriggerRegistry();
    registerBuiltinTriggers({
      queueManager: stubQueueManager,
      pluginMetadata: meta,
      registerTrigger: (trigger, m) => triggerRegistry.register(trigger, m),
    });

    const triggers = triggerRegistry.getTriggers();
    expect(triggers.length).toBeGreaterThan(0);

    for (const trigger of triggers) {
      if (!trigger.config) continue;
      const problem = trigger.config.validateMigrationChainFromV1();
      expect(
        problem,
        `Trigger "${trigger.qualifiedId}" config (version ${trigger.config.version}) has a broken migration chain: ${problem}`,
      ).toBeUndefined();
    }
  });

  it("every registered action config has a complete v1->version chain", () => {
    // Built-in registry is action-less; this asserts the enumeration
    // contract holds for whatever an action registry is given, so any
    // future built-in action is covered automatically.
    const actionRegistry = createActionRegistry();
    for (const action of actionRegistry.getActions()) {
      const problem = action.config.validateMigrationChainFromV1();
      expect(
        problem,
        `Action "${action.qualifiedId}" config (version ${action.config.version}) has a broken migration chain: ${problem}`,
      ).toBeUndefined();
    }
  });
});
