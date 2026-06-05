/**
 * Contract test: every anomaly Versioned config that is stored and read back
 * via the migration chain MUST have a COMPLETE, contiguous chain from version
 * 1 to its current `version`. Pure STRUCTURAL check
 * (`validateMigrationChainFromV1` — no `migrate()` is run), so it carries zero
 * per-config upkeep: the day someone bumps a config's `version` without
 * shipping a covering migration, `parse`/`parseRecord` would silently fail at
 * runtime on a genuinely-v1 stored record — this test turns that into a CI
 * failure instead. See the HTTP plugin's equivalent test for the full
 * rationale.
 *
 * Covers the two module-level Versioned wrappers this package owns: the
 * site-wide settings config and the assignment-level override config.
 */
import { describe, expect, it } from "bun:test";
import { anomalySettingsConfig, anomalyAssignmentConfig } from "./config";

describe("anomaly config migration-chain contract", () => {
  const configs = [
    { name: "anomaly settings", config: anomalySettingsConfig },
    { name: "anomaly assignment", config: anomalyAssignmentConfig },
  ];

  it("every registered Versioned config has a complete v1->version chain", () => {
    for (const { name, config } of configs) {
      const problem = config.validateMigrationChainFromV1();
      expect(
        problem,
        `${name} config (version ${config.version}) has a broken migration chain: ${problem}`,
      ).toBeUndefined();
    }
  });
});
