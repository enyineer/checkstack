import { describe, expect, it, mock } from "bun:test";
import { renderTemplatableConfig } from "@checkstack/backend-api";
import { SnmpCollector } from "./snmp-collector";
import type { SnmpResult, SnmpTransportClient } from "./transport-client";

describe("SnmpCollector", () => {
  const createMockClient = (
    response: Partial<SnmpResult> = {},
  ): SnmpTransportClient => {
    const base: SnmpResult = {
      value: 42,
      valueString: "42",
      valueType: "Integer",
      responseTimeMs: 12,
    };
    return {
      // Spread `response` last so an explicit `value: undefined` overrides the
      // default (a `??` fallback would swallow it and break the exception case).
      exec: mock(() => Promise.resolve<SnmpResult>({ ...base, ...response })),
    };
  };

  describe("execute", () => {
    it("forwards the returned value, type and timing as assertable metrics", async () => {
      const collector = new SnmpCollector();
      const client = createMockClient();

      const result = await collector.execute({
        config: { oid: "1.3.6.1.2.1.1.3.0" },
        client,
        pluginId: "test",
      });

      expect(result.result.value).toBe(42);
      expect(result.result.valueString).toBe("42");
      expect(result.result.valueType).toBe("Integer");
      expect(result.result.responseTimeMs).toBe(12);
      expect(result.error).toBeUndefined();
      expect(client.exec).toHaveBeenCalledWith({ oid: "1.3.6.1.2.1.1.3.0" });
    });

    it("treats an exception varbind (noSuchObject) as a completed response, not an error", async () => {
      const collector = new SnmpCollector();
      const client = createMockClient({
        value: undefined,
        valueString: "noSuchObject",
        valueType: "noSuchObject",
      });

      const result = await collector.execute({
        config: { oid: "1.3.6.1.2.1.99.99" },
        client,
        pluginId: "test",
      });

      // noSuchObject is a metric the user asserts on - the collector must not
      // surface it as a transport error.
      expect(result.error).toBeUndefined();
      expect(result.result.valueType).toBe("noSuchObject");
      expect(result.result.value).toBeUndefined();
    });

    it("propagates a transport error", async () => {
      const collector = new SnmpCollector();
      const client = createMockClient({
        valueType: "error",
        error: "Request timed out",
      });

      const result = await collector.execute({
        config: { oid: "1.3.6.1.2.1.1.3.0" },
        client,
        pluginId: "test",
      });

      expect(result.error).toBe("Request timed out");
    });
  });

  describe("environment templating", () => {
    // `oid` is `x-templatable`, so the executor renders `{{ environment.* }}`
    // into it PER environment before execute. These tests exercise that render
    // pass and the post-render empty-oid guard together.
    const renderOid = (oid: string, environment: Record<string, unknown>) => {
      const collector = new SnmpCollector();
      const rendered = renderTemplatableConfig({
        config: { oid },
        schema: collector.config.schema,
        context: { environment, check: {}, system: {} },
      });
      return (rendered as { oid: string }).oid;
    };

    it("renders a {{ environment.oid }} template against the env fields", () => {
      expect(
        renderOid("{{ environment.oid }}", {
          oid: "1.3.6.1.2.1.1.5.0",
        }),
      ).toBe("1.3.6.1.2.1.1.5.0");
    });

    it("issues the rendered OID against the client", async () => {
      const collector = new SnmpCollector();
      const client = createMockClient({ value: 7 });
      const oid = renderOid("{{ environment.oid }}", { oid: "1.3.6.1.2.1.1.3.0" });

      const result = await collector.execute({ config: { oid }, client, pluginId: "test" });

      expect(result.error).toBeUndefined();
      expect(result.result.value).toBe(7);
      expect(client.exec).toHaveBeenCalledWith({ oid: "1.3.6.1.2.1.1.3.0" });
    });

    it("returns a transport failure when the OID renders empty (no env)", async () => {
      const collector = new SnmpCollector();
      const client = createMockClient();
      // An env-less run resolves `{{ environment.oid }}` to "" (strict:false).
      const oid = renderOid("{{ environment.oid }}", {});
      expect(oid).toBe("");

      const result = await collector.execute({ config: { oid }, client, pluginId: "test" });

      expect(result.error).toContain("Rendered OID is empty");
      expect(result.result.valueType).toBe("error");
      // A config error must not issue the GET.
      expect(client.exec).not.toHaveBeenCalled();
    });
  });

  describe("mergeResult", () => {
    it("averages value and response time and counts errors", () => {
      const collector = new SnmpCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { value: 10, valueType: "Counter32", responseTimeMs: 20 },
        },
        {
          id: "2",
          status: "unhealthy" as const,
          latencyMs: 0,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            value: 30,
            valueType: "error",
            responseTimeMs: 40,
            error: "Timeout",
          },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgValue.avg).toBe(20);
      expect(aggregated.avgResponseTime.avg).toBe(30);
      expect(aggregated.errorCount.count).toBe(1);
    });
  });

  describe("metadata", () => {
    it("exposes the expected static properties", () => {
      const collector = new SnmpCollector();
      expect(collector.id).toBe("snmp");
      expect(collector.displayName).toBe("SNMP GET");
      expect(collector.allowMultiple).toBe(true);
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});
