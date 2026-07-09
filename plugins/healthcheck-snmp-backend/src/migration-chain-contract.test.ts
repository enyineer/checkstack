/**
 * Contract test: every SNMP health-check Versioned schema stored UNVERSIONED
 * and read back via assume-v1-on-read MUST have a COMPLETE, contiguous
 * migration chain from version 1 to its current `version`. Pure STRUCTURAL
 * check (`validateMigrationChainFromV1`); enumerates every Versioned field
 * (config + result + aggregatedResult) of this plugin's strategy + collector
 * so a new collector or a bumped result schema is covered automatically. See
 * the Ping plugin's equivalent test for the full rationale.
 */
import { describe, expect, it } from "bun:test";
import { SnmpHealthCheckStrategy } from "./strategy";
import { SnmpCollector } from "./snmp-collector";

describe("snmp health-check migration-chain contract", () => {
  const strategy = new SnmpHealthCheckStrategy();
  const collector = new SnmpCollector();
  const configs = [
    { name: "snmp strategy config", config: strategy.config },
    { name: "snmp strategy result", config: strategy.result },
    {
      name: "snmp strategy aggregatedResult",
      config: strategy.aggregatedResult,
    },
    { name: "snmp collector config", config: collector.config },
    { name: "snmp collector result", config: collector.result },
    {
      name: "snmp collector aggregatedResult",
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
