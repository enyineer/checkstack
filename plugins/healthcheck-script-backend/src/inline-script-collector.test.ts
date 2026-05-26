import { describe, it, expect } from "bun:test";
import {
  InlineScriptCollector,
  type InlineScriptConfig,
} from "./inline-script-collector";
import type { ScriptTransportClient } from "./transport-client";

/**
 * Unit tests for the Inline Script Collector.
 *
 * The collector runs each script in a freshly-spawned Bun subprocess
 * against a temp `.mjs` file. The subprocess overhead is ~10-20 ms per
 * test, which is acceptable for the small number of cases here and keeps
 * the tests close to what users actually experience at runtime (real
 * ESM, real `node:*` imports, real `process.exit()`).
 */

// Mock transport client — the inline-script collector doesn't actually
// use it, but the CollectorStrategy interface requires one.
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
    script: "export default { success: true };",
    timeout: 10_000,
    ...overrides,
  };
}

describe("InlineScriptCollector", () => {
  const collector = new InlineScriptCollector();

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

  describe("modern ESM scripts", () => {
    it("executes a script with `export default {object}`", async () => {
      const config = createConfig({
        script: `export default { success: true, message: "All good", value: 42 };`,
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(true);
      expect(result.result.message).toBe("All good");
      expect(result.result.value).toBe(42);
      expect(result.error).toBeUndefined();
    });

    it("executes a script that imports from node:os", async () => {
      // This is the user-reported regression: `import { loadavg } from "os"`
      // failed at parse time with "Unexpected token '{'" because the
      // previous executor wrapped scripts in `new Function(...)`. Real
      // ESM execution makes it just work.
      const config = createConfig({
        script: `
          import { loadavg, cpus } from "node:os";
          const load = loadavg()[0];
          export default {
            success: load >= 0,
            message: \`cpus=\${cpus().length} load=\${load.toFixed(2)}\`,
            value: load,
          };
        `,
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(true);
      expect(typeof result.result.value).toBe("number");
      expect(result.result.message).toMatch(/cpus=\d+ load=/);
    });

    it("supports top-level await", async () => {
      const config = createConfig({
        script: `
          await new Promise((r) => setTimeout(r, 10));
          export default { success: true, message: "awaited" };
        `,
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(true);
      expect(result.result.message).toBe("awaited");
    });

    it("exposes `defineHealthCheck` as a runtime global (no import required)", async () => {
      // The editor advertises `defineHealthCheck` both as an ambient global
      // and as a named export from `@checkstack/healthcheck`. The global
      // form lets Monaco autocomplete `defineHea…` on a fresh module
      // without the user typing an import first. This test confirms the
      // runner actually installs the global onto `globalThis` so the
      // script runs.
      const config = createConfig({
        script: `export default defineHealthCheck({ success: true, value: 99, message: "via global" });`,
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(true);
      expect(result.result.value).toBe(99);
      expect(result.result.message).toBe("via global");
    });

    it("resolves the virtual `@checkstack/healthcheck` defineHealthCheck helper at runtime", async () => {
      // The editor advertises `import { defineHealthCheck } from
      // "@checkstack/healthcheck"` for IntelliSense + return-shape type
      // checking. At runtime, the collector rewrites that import to a
      // sibling helper file. This test verifies the rewrite actually
      // resolves — if it ever regressed (e.g. the regex stopped matching),
      // the script would throw "Cannot find module @checkstack/healthcheck"
      // and we'd catch it here.
      const config = createConfig({
        script: `
          import { defineHealthCheck } from "@checkstack/healthcheck";
          export default defineHealthCheck({ success: true, value: 7, message: "via helper" });
        `,
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(true);
      expect(result.result.value).toBe(7);
      expect(result.result.message).toBe("via helper");
    });

    it("supports `export default async function (context)` callback form", async () => {
      const config = createConfig({
        script: `
          export default async function (ctx) {
            return { success: true, value: typeof ctx === "object" ? 1 : 0 };
          };
        `,
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(true);
      expect(result.result.value).toBe(1);
    });
  });

  describe("legacy IIFE-style scripts (backwards compatibility)", () => {
    it("still supports `return { success: true }` at the top level", async () => {
      const config = createConfig({
        script: `return { success: true, message: "All good" };`,
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(true);
      expect(result.result.message).toBe("All good");
    });

    it("still supports `return true`", async () => {
      const config = createConfig({ script: "return true;" });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(true);
    });

    it("treats a script with no return as successful", async () => {
      const config = createConfig({ script: "const x = 1 + 1;" });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(true);
    });

    it("captures stdout as the run message when no message is returned", async () => {
      const config = createConfig({
        script: `console.log("hello from script"); return true;`,
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(true);
      expect(result.result.message).toContain("hello from script");
    });
  });

  describe("failure handling", () => {
    it("treats `return false` as failure", async () => {
      const config = createConfig({ script: "return false;" });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("treats `return { success: false, message: ... }` as failure", async () => {
      const config = createConfig({
        script: `return { success: false, message: "Check failed" };`,
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

    it("captures thrown errors", async () => {
      const config = createConfig({
        script: `throw new Error("Something went wrong");`,
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(false);
      expect(result.error).toContain("Something went wrong");
    });

    it("captures syntax errors", async () => {
      const config = createConfig({ script: "const x = {" });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("timeout", () => {
    it("kills long-running scripts when the timeout expires", async () => {
      const config = createConfig({
        script: `
          await new Promise((r) => setTimeout(r, 5000));
          export default { success: true };
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
    }, 15_000);
  });

  describe("context.config", () => {
    it("exposes the collector configuration as `context.config`", async () => {
      const config = createConfig({
        script: `
          // @ts-ignore — context is injected by the runner
          export default { success: true, value: context.config.timeout };
        `,
      });

      const result = await collector.execute({
        config,
        client: mockClient,
        pluginId: "script",
      });

      expect(result.result.success).toBe(true);
      expect(result.result.value).toBe(10_000);
    });
  });

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

      expect(aggregated.avgExecutionTimeMs.avg).toBe(150);
      expect(aggregated.successRate.rate).toBeCloseTo(67, 0);
    });
  });
});
