/**
 * Contract test: every healthcheck-backend-owned Versioned config that is
 * stored and read back via the migration chain MUST have a COMPLETE,
 * contiguous chain from version 1 to its current `version`. Pure STRUCTURAL
 * check (`validateMigrationChainFromV1` — no `migrate()` is run), so it carries
 * zero per-config upkeep: the day someone bumps a config's `version` without
 * shipping a covering migration, the read path would silently fail at runtime
 * on a genuinely-v1 stored blob — this test turns that into a CI failure
 * instead. See the HTTP plugin's equivalent test for the full rationale.
 *
 * Covers the configs this CORE package owns: the per-assignment state
 * thresholds wrapper and every built-in automation action config. The
 * strategy / collector `config` / `result` / `aggregatedResult` Versioned
 * schemas are registered by the healthcheck strategy plugins (e.g.
 * healthcheck-http-backend) and are guarded by an equivalent contract test in
 * each plugin package.
 */
import { describe, expect, it } from "bun:test";
import type { QueueManager } from "@checkstack/queue-api";
import type { Hook } from "@checkstack/backend-api";
import { stateThresholds } from "./state-thresholds-migrations";
import {
  createHealthCheckActions,
  type HealthCheckActionDeps,
} from "./automations";
import type { HealthCheckService } from "./service";

// `createHealthCheckActions` only constructs the action definitions; the deps
// are touched lazily inside `execute()`, which the contract check never calls.
// Stubs are sufficient.
const stubService = {} as unknown as HealthCheckService;
const stubQueueManager = {} as unknown as QueueManager;
const stubCatalogClient =
  {} as unknown as HealthCheckActionDeps["catalogClient"];
const stubEmitHook = async <T>(_hook: Hook<T>, _payload: T): Promise<void> => {};

describe("healthcheck config migration-chain contract", () => {
  it("the state-thresholds config has a complete v1->version chain", () => {
    const problem = stateThresholds.validateMigrationChainFromV1();
    expect(
      problem,
      `state thresholds config (version ${stateThresholds.version}) has a broken migration chain: ${problem}`,
    ).toBeUndefined();
  });

  it("every built-in action config has a complete v1->version chain", () => {
    const actions = createHealthCheckActions({
      service: stubService,
      queueManager: stubQueueManager,
      catalogClient: stubCatalogClient,
      emitHook: stubEmitHook,
    });
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
