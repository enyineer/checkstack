/**
 * Contract test: every HTTP health-check Versioned schema that is stored
 * UNVERSIONED and read back via assume-v1-on-read MUST have a COMPLETE,
 * contiguous migration chain from version 1 to its current `version`.
 *
 * This is a pure STRUCTURAL check on the `Versioned.migrations` array
 * (`validateMigrationChainFromV1` — no `migrate()` is run), so it carries
 * zero per-config upkeep: the day someone bumps a schema's `version` without
 * shipping a covering migration, `parseAssumingV1` would silently fail at
 * runtime on a genuinely-v1 stored blob — this test turns that into a CI
 * failure instead. It enumerates every Versioned field (config + result +
 * aggregatedResult) of the strategy + collectors this plugin registers, so a
 * new collector or a bumped result schema is covered automatically.
 */
import { describe, expect, it } from "bun:test";
import { HttpHealthCheckStrategy } from "./strategy";
import { RequestCollector } from "./request-collector";

describe("http health-check migration-chain contract", () => {
  const strategy = new HttpHealthCheckStrategy();
  const collector = new RequestCollector();
  const configs = [
    { name: "http strategy config", config: strategy.config },
    { name: "http strategy result", config: strategy.result },
    { name: "http strategy aggregatedResult", config: strategy.aggregatedResult },
    { name: "request collector config", config: collector.config },
    { name: "request collector result", config: collector.result },
    {
      name: "request collector aggregatedResult",
      config: collector.aggregatedResult,
    },
  ];

  it("every registered Versioned schema has a complete v1->version chain", () => {
    for (const { name, config } of configs) {
      const problem = config.validateMigrationChainFromV1();
      expect(
        problem,
        `${name} (version ${config.version}) has a broken migration chain: ${problem}`,
      ).toBeUndefined();
    }
  });
});
