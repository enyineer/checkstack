/**
 * Contract test: every notification Versioned config that this package
 * registers MUST have a COMPLETE, contiguous migration chain from version 1 to
 * its current `version`. Pure STRUCTURAL check (`validateMigrationChainFromV1`
 * — no `migrate()` is run), so it carries zero per-config upkeep: the day
 * someone bumps a config's `version` without shipping a covering migration,
 * `parseAssumingV1` would silently fail at runtime on a genuinely-v1 stored
 * blob — this test turns that into a CI failure instead. See the HTTP plugin's
 * equivalent test for the full rationale.
 *
 * It enumerates the automation actions this package registers, so a new
 * built-in action config is covered automatically.
 *
 * NOTE: notification strategies (and their `config` / `userConfig` /
 * `layoutConfig` Versioned wrappers) are registered by the strategy plugins
 * (e.g. notification-smtp-backend), NOT by this core package, so they are
 * guarded by an equivalent contract test in their owning plugin package — the
 * test lives where the registration lives to keep the dependency direction
 * intact.
 */
import { describe, expect, it } from "bun:test";
import { notificationActions } from "./automations";

describe("notification config migration-chain contract", () => {
  it("every registered action config has a complete v1->version chain", () => {
    const actions = notificationActions;
    expect(actions.length).toBeGreaterThan(0);

    for (const action of actions) {
      const problem = action.config.validateMigrationChainFromV1();
      expect(
        problem,
        `Action "${action.id}" config (version ${action.config.version}) has a broken migration chain: ${problem}`,
      ).toBeUndefined();
    }
  });
});
