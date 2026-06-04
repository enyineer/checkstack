/**
 * Contract test: every DNS health-check Versioned schema stored UNVERSIONED
 * and read back via assume-v1-on-read MUST have a COMPLETE, contiguous
 * migration chain from version 1 to its current `version`. Pure STRUCTURAL
 * check (`validateMigrationChainFromV1`); enumerates every Versioned field
 * (config + result + aggregatedResult) of this plugin's strategy + collectors
 * so a new collector or a bumped result schema is covered automatically. See
 * the HTTP plugin's equivalent test for the full rationale.
 */
import { describe, expect, it } from "bun:test";
import { DnsHealthCheckStrategy } from "./strategy";
import { LookupCollector } from "./lookup-collector";

describe("dns health-check migration-chain contract", () => {
  const strategy = new DnsHealthCheckStrategy();
  const collector = new LookupCollector();
  const configs = [
    { name: "dns strategy config", config: strategy.config },
    { name: "dns strategy result", config: strategy.result },
    { name: "dns strategy aggregatedResult", config: strategy.aggregatedResult },
    { name: "lookup collector config", config: collector.config },
    { name: "lookup collector result", config: collector.result },
    {
      name: "lookup collector aggregatedResult",
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
