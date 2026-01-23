import { describe, it, expect } from "bun:test";
import {
  InlineScriptCollector,
  type InlineScriptConfig,
} from "./inline-script-collector";
import type { ScriptTransportClient } from "./transport-client";

/**
 * Unit tests for the Inline Script Collector.
 *
 * Tests cover:
 * - Basic script execution
 * - Return value handling
 * - Error handling
 * - Timeout protection
 */

// Mock client (not actually used by InlineScriptCollector, but required by interface)
const mockClient: ScriptTransportClient = {
  exec: async () => ({
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
  }),
};

function createConfig(
  overrides: Partial<InlineScriptConfig> = {},
): InlineScriptConfig {
  return {
    script: "return { success: true };",
    timeout: 5000,
    ...overrides,
  };
}

describe("InlineScriptCollector", () => {
  const collector = new InlineScriptCollector();

  // ─────────────────────────────────────────────────────────────
  // Metadata
  // ─────────────────────────────────────────────────────────────

  describe("metadata", () => {
    it("has correct basic metadata", () => {
      expect(collector.id).toBe("inline-script");
      expect(collector.displayName).toBe("Inline Script");
      expect(collector.description).toContain("TypeScript");
    });

    it("allows multiple instances", () => {
      expect(collector.allowMultiple).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Basic Execution
  // ─────────────────────────────────────────────────────────────

  describe("execute - basic", () => {
    it("executes script returning success object", async () => {
      const config = createConfig({
        script: 'return { success: true, message: "All good" };',
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(true);
      expect(result.result.message).toBe("All good");
      expect(result.error).toBeUndefined();
    });

    it("executes script returning boolean", async () => {
      const config = createConfig({
        script: "return true;",
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(true);
    });

    it("executes script with no return (defaults to success)", async () => {
      const config = createConfig({
        script: "const x = 1 + 1;",
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(true);
    });

    it("executes async script", async () => {
      const config = createConfig({
        script: `
          await Promise.resolve();
          return { success: true, message: "async works" };
        `,
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(true);
      expect(result.result.message).toBe("async works");
    });

    it("captures numeric value from script", async () => {
      const config = createConfig({
        script: "return { success: true, value: 42 };",
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.value).toBe(42);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Failure Handling
  // ─────────────────────────────────────────────────────────────

  describe("execute - failures", () => {
    it("handles script returning false", async () => {
      const config = createConfig({
        script: "return false;",
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("handles script returning success: false", async () => {
      const config = createConfig({
        script: 'return { success: false, message: "Check failed" };',
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(false);
      expect(result.result.message).toBe("Check failed");
      expect(result.error).toBe("Check failed");
    });

    it("handles script errors", async () => {
      const config = createConfig({
        script: 'throw new Error("Something went wrong");',
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(false);
      expect(result.error).toContain("Something went wrong");
    });

    it("handles syntax errors", async () => {
      const config = createConfig({
        script: "const x = {",
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Timeout
  // ─────────────────────────────────────────────────────────────

  describe("execute - timeout", () => {
    it("times out long-running scripts", async () => {
      const config = createConfig({
        script: `
          await new Promise(resolve => setTimeout(resolve, 5000));
          return { success: true };
        `,
        timeout: 1000,
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(false);
      expect(result.result.timedOut).toBe(true);
      expect(result.error).toContain("timed out");
    }, 10000);
  });

  // ─────────────────────────────────────────────────────────────
  // Aggregation
  // ─────────────────────────────────────────────────────────────

  describe("mergeResult", () => {
    it("aggregates execution time and success rate", () => {
      const run1 = {
        metadata: { success: true, executionTimeMs: 100, timedOut: false },
      };
      const run2 = {
        metadata: { success: true, executionTimeMs: 200, timedOut: false },
      };
      const run3 = {
        metadata: { success: false, executionTimeMs: 150, timedOut: false },
      };

      let aggregated = collector.mergeResult(undefined, run1 as never);
      aggregated = collector.mergeResult(aggregated, run2 as never);
      aggregated = collector.mergeResult(aggregated, run3 as never);

      expect(aggregated.avgExecutionTimeMs.avg).toBe(150); // (100+200+150)/3
      expect(aggregated.successRate.rate).toBeCloseTo(67, 0); // 2/3 * 100 = ~67
    });
  });
});
