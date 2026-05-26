import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  scriptProvider,
  scriptConfigSchemaV1,
  type ScriptConfig,
} from "./provider";
import type { IntegrationDeliveryContext } from "@checkstack/integration-backend";

/**
 * Unit tests for the Script Integration Provider.
 *
 * Tests cover:
 * - Config schema validation
 * - Successful script execution
 * - Context access (event payload, subscription info)
 * - Error handling
 * - Timeout protection
 * - Console logging
 */

// Mock logger
const mockLogger = {
  debug: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

// Create a test delivery context
function createTestContext(
  configOverrides: Partial<ScriptConfig> = {},
): IntegrationDeliveryContext<ScriptConfig> {
  const defaultConfig: ScriptConfig = {
    script: 'return { id: "test" };',
    timeout: 5000,
    ...configOverrides,
  };

  return {
    event: {
      eventId: "test-plugin.incident.created",
      payload: {
        incidentId: "inc-123",
        title: "Test Incident",
        severity: "critical",
      },
      timestamp: new Date().toISOString(),
      deliveryId: "del-456",
    },
    subscription: {
      id: "sub-789",
      name: "Test Subscription",
    },
    providerConfig: defaultConfig,
    logger: mockLogger,
  };
}

describe("ScriptProvider", () => {
  beforeEach(() => {
    mockLogger.debug.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Provider Metadata
  // ─────────────────────────────────────────────────────────────────────────

  describe("metadata", () => {
    it("has correct basic metadata", () => {
      expect(scriptProvider.id).toBe("script");
      expect(scriptProvider.displayName).toBe("Script");
      expect(scriptProvider.description).toContain("TypeScript");
      expect(scriptProvider.icon).toBe("Code");
    });

    it("has a versioned config schema", () => {
      expect(scriptProvider.config).toBeDefined();
      expect(scriptProvider.config.version).toBe(1);
    });

    it("has documentation", () => {
      expect(scriptProvider.documentation?.setupGuide).toBeDefined();
      expect(scriptProvider.documentation?.setupGuide).toContain(
        "context.event.payload",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Config Schema Validation
  // ─────────────────────────────────────────────────────────────────────────

  describe("config schema", () => {
    it("requires script field", () => {
      expect(() => {
        scriptConfigSchemaV1.parse({});
      }).toThrow();
    });

    it("accepts valid script", () => {
      const result = scriptConfigSchemaV1.parse({
        script: 'console.log("hello");',
      });
      expect(result.script).toBe('console.log("hello");');
    });

    it("applies default timeout", () => {
      const result = scriptConfigSchemaV1.parse({
        script: "return 1;",
      });
      expect(result.timeout).toBe(10_000);
    });

    it("validates timeout range", () => {
      expect(() => {
        scriptConfigSchemaV1.parse({
          script: "return 1;",
          timeout: 500, // Too short
        });
      }).toThrow();

      expect(() => {
        scriptConfigSchemaV1.parse({
          script: "return 1;",
          timeout: 100_000, // Too long
        });
      }).toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Script Execution - Basic
  // ─────────────────────────────────────────────────────────────────────────

  describe("deliver - basic execution", () => {
    it("executes simple script and returns success", async () => {
      const context = createTestContext({
        script: 'return { id: "executed" };',
      });

      const result = await scriptProvider.deliver(context);

      expect(result.success).toBe(true);
      expect(result.externalId).toBe("executed");
    });

    it("handles script with no return value", async () => {
      const context = createTestContext({
        script: "const x = 1 + 1;",
      });

      const result = await scriptProvider.deliver(context);

      expect(result.success).toBe(true);
      expect(result.externalId).toBeUndefined();
    });

    it("handles async script", async () => {
      const context = createTestContext({
        script: `
          await Promise.resolve();
          return { id: "async-result" };
        `,
      });

      const result = await scriptProvider.deliver(context);

      expect(result.success).toBe(true);
      expect(result.externalId).toBe("async-result");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Script Execution - Context Access
  // ─────────────────────────────────────────────────────────────────────────

  describe("deliver - context access", () => {
    it("can access event payload", async () => {
      const context = createTestContext({
        script: `
          const title = context.event.payload.title;
          return { id: title };
        `,
      });

      const result = await scriptProvider.deliver(context);

      expect(result.success).toBe(true);
      expect(result.externalId).toBe("Test Incident");
    });

    it("can access event metadata", async () => {
      const context = createTestContext({
        script: `
          return { id: context.event.eventId };
        `,
      });

      const result = await scriptProvider.deliver(context);

      expect(result.success).toBe(true);
      expect(result.externalId).toBe("test-plugin.incident.created");
    });

    it("can access subscription info", async () => {
      const context = createTestContext({
        script: `
          return { id: context.subscription.name };
        `,
      });

      const result = await scriptProvider.deliver(context);

      expect(result.success).toBe(true);
      expect(result.externalId).toBe("Test Subscription");
    });

    // Regression guards for every field we advertise in
    // `IntegrationScriptContext` (built by `integrationScriptContext`).
    // If the runner drops one of these, the editor would still
    // autocomplete it via the schema-typed declaration while the
    // runtime returned `undefined`.

    it("exposes context.event.timestamp", async () => {
      const context = createTestContext({
        script: `return { id: context.event.timestamp };`,
      });
      const result = await scriptProvider.deliver(context);
      expect(result.success).toBe(true);
      expect(result.externalId).toBe(context.event.timestamp);
    });

    it("exposes context.event.deliveryId", async () => {
      const context = createTestContext({
        script: `return { id: context.event.deliveryId };`,
      });
      const result = await scriptProvider.deliver(context);
      expect(result.success).toBe(true);
      expect(result.externalId).toBe("del-456");
    });

    it("exposes context.subscription.id (distinct from .name)", async () => {
      const context = createTestContext({
        script: `return { id: context.subscription.id };`,
      });
      const result = await scriptProvider.deliver(context);
      expect(result.success).toBe(true);
      expect(result.externalId).toBe(context.subscription.id);
    });

    it("can read deeply-nested payload fields", async () => {
      const context = createTestContext({
        script: `
          const v = context.event.payload.nested && context.event.payload.nested.field;
          return { id: v };
        `,
      });
      context.event.payload = {
        ...context.event.payload,
        nested: { field: "value" },
      };
      const result = await scriptProvider.deliver(context);
      expect(result.success).toBe(true);
      expect(result.externalId).toBe("value");
    });

    it("preserves array shape in context.event.payload (no JSON-stringify)", async () => {
      // Unlike the shell provider — where arrays get JSON-encoded into
      // an env-var string — the inline-script runner serialises the
      // context as JSON once and re-parses it inside the subprocess,
      // so arrays stay as real JS arrays available to user code.
      const context = createTestContext({
        script: `
          const tags = context.event.payload.tags;
          if (!Array.isArray(tags)) {
            throw new Error("expected array, got " + typeof tags);
          }
          return { id: tags.join(",") };
        `,
      });
      context.event.payload = {
        ...context.event.payload,
        tags: ["urgent", "production"],
      };
      const result = await scriptProvider.deliver(context);
      expect(result.success).toBe(true);
      expect(result.externalId).toBe("urgent,production");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Script Execution - Console Logging
  // ─────────────────────────────────────────────────────────────────────────

  describe("deliver - console logging", () => {
    it("captures console.log calls", async () => {
      const context = createTestContext({
        script: `
          console.log("Hello from script");
          return { id: "logged" };
        `,
      });

      await scriptProvider.deliver(context);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Hello from script"),
      );
    });

    it("captures console.warn calls (forwarded to logger.error)", async () => {
      // In the subprocess execution model both console.warn and
      // console.error write to stderr (Bun matches Node behaviour);
      // post-hoc we can't distinguish them, so the provider forwards
      // every stderr line to `logger.error`. The slight noise on a
      // pure-warn call is preferable to losing visibility on a true
      // console.error.
      const context = createTestContext({
        script: `
          console.warn("Warning message");
          return { id: "warned" };
        `,
      });

      await scriptProvider.deliver(context);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Warning message"),
      );
    });

    it("captures console.error calls", async () => {
      const context = createTestContext({
        script: `
          console.error("Error message");
          return { id: "errored" };
        `,
      });

      await scriptProvider.deliver(context);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error message"),
      );
    });

    it("captures objects via console.log (Bun's native inspect format)", async () => {
      // The previous in-process implementation JSON.stringified objects
      // before logging. The subprocess model just streams Bun's actual
      // stdout output — which uses util.inspect formatting (`{ key:
      // "value" }`, not `{"key":"value"}`). The test now asserts both
      // tokens are present in the log line without requiring a strict
      // serialisation format.
      const context = createTestContext({
        script: `
          console.log({ key: "value" });
          return { id: "json" };
        `,
      });

      await scriptProvider.deliver(context);

      const debugCalls = mockLogger.debug.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join("\n");
      expect(debugCalls).toContain("key");
      expect(debugCalls).toContain("value");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Script Execution - Error Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe("deliver - error handling", () => {
    it("handles script syntax errors", async () => {
      const context = createTestContext({
        script: "const x = {", // Invalid syntax
      });

      const result = await scriptProvider.deliver(context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Script error");
    });

    it("handles runtime errors", async () => {
      const context = createTestContext({
        script: `
          throw new Error("Script failed");
        `,
      });

      const result = await scriptProvider.deliver(context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Script failed");
    });

    it("handles undefined variable access", async () => {
      const context = createTestContext({
        script: `
          return undefinedVariable.property;
        `,
      });

      const result = await scriptProvider.deliver(context);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Script Execution - Timeout
  // ─────────────────────────────────────────────────────────────────────────

  describe("deliver - timeout", () => {
    it("times out long-running scripts", async () => {
      const context = createTestContext({
        script: `
          await new Promise(resolve => setTimeout(resolve, 5000));
          return { id: "never" };
        `,
        timeout: 1000, // Use minimum allowed timeout
      });

      const result = await scriptProvider.deliver(context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    }, 10000);

    it("completes fast scripts within timeout", async () => {
      const context = createTestContext({
        script: `
          await new Promise(resolve => setTimeout(resolve, 10));
          return { id: "fast" };
        `,
        timeout: 5000,
      });

      const result = await scriptProvider.deliver(context);

      expect(result.success).toBe(true);
      expect(result.externalId).toBe("fast");
    });
  });
});
