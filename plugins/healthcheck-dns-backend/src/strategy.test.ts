import { describe, expect, it, mock } from "bun:test";
import {
  DnsHealthCheckStrategy,
  DnsResolver,
  ResolverFactory,
} from "./strategy";

describe("DnsHealthCheckStrategy", () => {
  // Helper to create mock resolver factory
  const createMockResolver = (
    config: {
      resolve4?: string[] | Error;
      resolve6?: string[] | Error;
      resolveCname?: string[] | Error;
      resolveMx?: { priority: number; exchange: string }[] | Error;
      resolveTxt?: string[][] | Error;
      resolveNs?: string[] | Error;
    } = {}
  ): ResolverFactory => {
    return () =>
      ({
        setServers: mock(() => {}),
        resolve4: mock(() =>
          config.resolve4 instanceof Error
            ? Promise.reject(config.resolve4)
            : Promise.resolve(config.resolve4 ?? [])
        ),
        resolve6: mock(() =>
          config.resolve6 instanceof Error
            ? Promise.reject(config.resolve6)
            : Promise.resolve(config.resolve6 ?? [])
        ),
        resolveCname: mock(() =>
          config.resolveCname instanceof Error
            ? Promise.reject(config.resolveCname)
            : Promise.resolve(config.resolveCname ?? [])
        ),
        resolveMx: mock(() =>
          config.resolveMx instanceof Error
            ? Promise.reject(config.resolveMx)
            : Promise.resolve(config.resolveMx ?? [])
        ),
        resolveTxt: mock(() =>
          config.resolveTxt instanceof Error
            ? Promise.reject(config.resolveTxt)
            : Promise.resolve(config.resolveTxt ?? [])
        ),
        resolveNs: mock(() =>
          config.resolveNs instanceof Error
            ? Promise.reject(config.resolveNs)
            : Promise.resolve(config.resolveNs ?? [])
        ),
      } as DnsResolver);
  };

  describe("execute", () => {
    it("should return healthy for successful A record resolution", async () => {
      const strategy = new DnsHealthCheckStrategy(
        createMockResolver({ resolve4: ["1.2.3.4", "5.6.7.8"] })
      );

      const result = await strategy.execute({
        hostname: "example.com",
        recordType: "A",
        timeout: 5000,
      });

      expect(result.status).toBe("healthy");
      expect(result.metadata?.resolvedValues).toEqual(["1.2.3.4", "5.6.7.8"]);
      expect(result.metadata?.recordCount).toBe(2);
    });

    it("should return unhealthy for DNS error", async () => {
      const strategy = new DnsHealthCheckStrategy(
        createMockResolver({ resolve4: new Error("NXDOMAIN") })
      );

      const result = await strategy.execute({
        hostname: "nonexistent.example.com",
        recordType: "A",
        timeout: 5000,
      });

      expect(result.status).toBe("unhealthy");
      expect(result.message).toContain("NXDOMAIN");
      expect(result.metadata?.error).toBeDefined();
    });

    it("should pass recordExists assertion when records found", async () => {
      const strategy = new DnsHealthCheckStrategy(
        createMockResolver({ resolve4: ["1.2.3.4"] })
      );

      const result = await strategy.execute({
        hostname: "example.com",
        recordType: "A",
        timeout: 5000,
        assertions: [{ field: "recordExists", operator: "isTrue" }],
      });

      expect(result.status).toBe("healthy");
    });

    it("should fail recordExists assertion when no records", async () => {
      const strategy = new DnsHealthCheckStrategy(
        createMockResolver({ resolve4: [] })
      );

      const result = await strategy.execute({
        hostname: "example.com",
        recordType: "A",
        timeout: 5000,
        assertions: [{ field: "recordExists", operator: "isTrue" }],
      });

      expect(result.status).toBe("unhealthy");
      expect(result.message).toContain("Assertion failed");
    });

    it("should pass recordValue assertion with matching value", async () => {
      const strategy = new DnsHealthCheckStrategy(
        createMockResolver({ resolveCname: ["cdn.example.com"] })
      );

      const result = await strategy.execute({
        hostname: "example.com",
        recordType: "CNAME",
        timeout: 5000,
        assertions: [
          { field: "recordValue", operator: "contains", value: "cdn" },
        ],
      });

      expect(result.status).toBe("healthy");
    });

    it("should pass recordCount assertion", async () => {
      const strategy = new DnsHealthCheckStrategy(
        createMockResolver({ resolve4: ["1.2.3.4", "5.6.7.8", "9.10.11.12"] })
      );

      const result = await strategy.execute({
        hostname: "example.com",
        recordType: "A",
        timeout: 5000,
        assertions: [
          { field: "recordCount", operator: "greaterThanOrEqual", value: 2 },
        ],
      });

      expect(result.status).toBe("healthy");
    });

    it("should resolve MX records correctly", async () => {
      const strategy = new DnsHealthCheckStrategy(
        createMockResolver({
          resolveMx: [
            { priority: 0, exchange: "mail1.example.com" },
            { priority: 10, exchange: "mail2.example.com" },
          ],
        })
      );

      const result = await strategy.execute({
        hostname: "example.com",
        recordType: "MX",
        timeout: 5000,
      });

      expect(result.status).toBe("healthy");
      expect(result.metadata?.resolvedValues).toContain("0 mail1.example.com");
    });

    it("should use custom nameserver when provided", async () => {
      const setServersMock = mock(() => {});
      const strategy = new DnsHealthCheckStrategy(() => ({
        setServers: setServersMock,
        resolve4: mock(() => Promise.resolve(["1.2.3.4"])),
        resolve6: mock(() => Promise.resolve([])),
        resolveCname: mock(() => Promise.resolve([])),
        resolveMx: mock(() => Promise.resolve([])),
        resolveTxt: mock(() => Promise.resolve([])),
        resolveNs: mock(() => Promise.resolve([])),
      }));

      await strategy.execute({
        hostname: "example.com",
        recordType: "A",
        nameserver: "8.8.8.8",
        timeout: 5000,
      });

      expect(setServersMock).toHaveBeenCalledWith(["8.8.8.8"]);
    });
  });

  describe("aggregateResult", () => {
    it("should calculate averages correctly", () => {
      const strategy = new DnsHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            resolvedValues: ["1.2.3.4"],
            recordCount: 1,
            resolutionTimeMs: 10,
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 20,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            resolvedValues: ["5.6.7.8"],
            recordCount: 1,
            resolutionTimeMs: 20,
          },
        },
      ];

      const aggregated = strategy.aggregateResult(runs);

      expect(aggregated.avgResolutionTime).toBe(15);
      expect(aggregated.failureCount).toBe(0);
      expect(aggregated.errorCount).toBe(0);
    });

    it("should count failures and errors", () => {
      const strategy = new DnsHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "unhealthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            resolvedValues: [],
            recordCount: 0,
            resolutionTimeMs: 10,
            error: "NXDOMAIN",
          },
        },
        {
          id: "2",
          status: "unhealthy" as const,
          latencyMs: 20,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            resolvedValues: [],
            recordCount: 0,
            resolutionTimeMs: 20,
          },
        },
      ];

      const aggregated = strategy.aggregateResult(runs);

      expect(aggregated.errorCount).toBe(1);
      expect(aggregated.failureCount).toBe(1);
    });
  });
});
