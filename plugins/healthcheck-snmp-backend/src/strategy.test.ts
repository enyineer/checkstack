import { describe, expect, it, mock } from "bun:test";
import { renderTemplatableConfig } from "@checkstack/backend-api";
import { SnmpHealthCheckStrategy } from "./strategy";
import { snmpConfigSchema } from "./schemas";
import { SnmpType, type RawSnmpVarbind } from "./snmp-varbind";
import type { SnmpSession, SnmpSessionFactory } from "./snmp-session";

/** Build a strategy whose session resolves a fixed varbind. */
function strategyWithVarbind(varbind: RawSnmpVarbind): {
  strategy: SnmpHealthCheckStrategy;
  close: ReturnType<typeof mock>;
} {
  const close = mock(() => {});
  const session: SnmpSession = {
    get: () => Promise.resolve(varbind),
    close,
  };
  const factory: SnmpSessionFactory = () => session;
  return { strategy: new SnmpHealthCheckStrategy(factory), close };
}

/** Build a strategy whose session rejects (transport failure). */
function strategyWithError(error: Error): SnmpHealthCheckStrategy {
  const session: SnmpSession = {
    get: () => Promise.reject(error),
    close: () => {},
  };
  const factory: SnmpSessionFactory = () => session;
  return new SnmpHealthCheckStrategy(factory);
}

describe("SnmpHealthCheckStrategy", () => {
  describe("static metadata", () => {
    it("has the expected id, category and versioned schemas", () => {
      const strategy = new SnmpHealthCheckStrategy();
      expect(strategy.id).toBe("snmp");
      expect(strategy.category).toBe("networking");
      expect(strategy.config.version).toBe(1);
      expect(strategy.result.version).toBe(1);
    });
  });

  describe("createClient + exec", () => {
    it("returns the OID value, type and timing on a successful GET", async () => {
      const { strategy } = strategyWithVarbind({
        type: SnmpType.Counter32,
        value: 12_345,
      });
      const connected = await strategy.createClient({ host: "127.0.0.1" });
      const result = await connected.client.exec({ oid: "1.3.6.1.2.1.1.3.0" });

      expect(result.value).toBe(12_345);
      expect(result.valueString).toBe("12345");
      expect(result.valueType).toBe("Counter32");
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
      connected.close();
    });

    it("exposes an exception varbind as a metric, NOT a transport error", async () => {
      const { strategy } = strategyWithVarbind({
        type: SnmpType.NoSuchInstance,
        value: null,
      });
      const connected = await strategy.createClient({ host: "127.0.0.1" });
      const result = await connected.client.exec({ oid: "1.3.6.1.2.1.99" });

      expect(result.error).toBeUndefined();
      expect(result.valueType).toBe("noSuchInstance");
      expect(result.value).toBeUndefined();
      connected.close();
    });

    it("surfaces a genuine transport failure as `error`", async () => {
      const strategy = strategyWithError(new Error("Request timed out"));
      const connected = await strategy.createClient({ host: "10.255.255.1" });
      const result = await connected.client.exec({ oid: "1.3.6.1.2.1.1.3.0" });

      expect(result.error).toBe("Request timed out");
      expect(result.valueType).toBe("error");
      connected.close();
    });

    it("closes the underlying session on close()", async () => {
      const { strategy, close } = strategyWithVarbind({
        type: SnmpType.Integer,
        value: 1,
      });
      const connected = await strategy.createClient({ host: "127.0.0.1" });
      connected.close();
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe("environment templating", () => {
    // The strategy `host` field is `x-templatable`, so the executor renders
    // `{{ environment.* }}` into it PER environment (via renderTemplatableConfig)
    // BEFORE createClient. These tests exercise that render pass + the
    // post-render empty-host guard together.
    const renderHost = (host: string, environment: Record<string, unknown>) =>
      renderTemplatableConfig({
        config: { host },
        schema: snmpConfigSchema,
        context: { environment, check: {}, system: {} },
      }) as { host: string };

    it("renders a {{ environment.host }} template against the env fields", () => {
      const rendered = renderHost("{{ environment.host }}", {
        host: "snmp.prod.internal",
      });
      expect(rendered.host).toBe("snmp.prod.internal");
    });

    it("builds a session for the rendered host", async () => {
      const { strategy } = strategyWithVarbind({
        type: SnmpType.Integer,
        value: 1,
      });
      const rendered = renderHost("{{ environment.host }}", {
        host: "snmp.prod.internal",
      });
      const connected = await strategy.createClient(rendered);
      expect(connected.client).toBeDefined();
      connected.close();
    });

    it("throws a transport failure when the host renders empty (no env)", async () => {
      const { strategy } = strategyWithVarbind({
        type: SnmpType.Integer,
        value: 1,
      });
      // An env-less run resolves `{{ environment.host }}` to "" (strict:false).
      const rendered = renderHost("{{ environment.host }}", {});
      expect(rendered.host).toBe("");
      await expect(strategy.createClient(rendered)).rejects.toThrow(
        /Rendered host is empty/,
      );
    });
  });

  describe("mergeResult", () => {
    it("averages values and counts transport errors across runs", () => {
      const strategy = new SnmpHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { value: 100, valueType: "Gauge32", responseTimeMs: 10 },
        },
        {
          id: "2",
          status: "unhealthy" as const,
          latencyMs: 0,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            value: 200,
            valueType: "error",
            responseTimeMs: 30,
            error: "unreachable",
          },
        },
      ];

      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgValue.avg).toBe(150);
      expect(aggregated.avgResponseTime.avg).toBe(20);
      expect(aggregated.errorCount.count).toBe(1);
    });
  });
});
