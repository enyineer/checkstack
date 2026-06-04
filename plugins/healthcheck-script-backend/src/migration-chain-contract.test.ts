/**
 * Contract test: every Script health-check Versioned schema stored UNVERSIONED
 * and read back via assume-v1-on-read MUST have a COMPLETE, contiguous
 * migration chain from version 1 to its current `version`. Pure STRUCTURAL
 * check (`validateMigrationChainFromV1`); enumerates every Versioned field
 * (config + result + aggregatedResult) of this plugin's strategy + collectors
 * (including the highest-risk execute collector) so a new collector or a
 * bumped result schema is covered automatically. See the HTTP plugin's
 * equivalent test for the full rationale.
 */
import { describe, expect, it } from "bun:test";
import { ScriptHealthCheckStrategy } from "./strategy";
import { ExecuteCollector } from "./execute-collector";
import { InlineScriptCollector } from "./inline-script-collector";

describe("script health-check migration-chain contract", () => {
  const strategy = new ScriptHealthCheckStrategy();
  const executeCollector = new ExecuteCollector();
  const inlineCollector = new InlineScriptCollector();
  const configs = [
    { name: "script strategy config", config: strategy.config },
    { name: "script strategy result", config: strategy.result },
    {
      name: "script strategy aggregatedResult",
      config: strategy.aggregatedResult,
    },
    { name: "execute collector config", config: executeCollector.config },
    { name: "execute collector result", config: executeCollector.result },
    {
      name: "execute collector aggregatedResult",
      config: executeCollector.aggregatedResult,
    },
    { name: "inline-script collector config", config: inlineCollector.config },
    { name: "inline-script collector result", config: inlineCollector.result },
    {
      name: "inline-script collector aggregatedResult",
      config: inlineCollector.aggregatedResult,
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
