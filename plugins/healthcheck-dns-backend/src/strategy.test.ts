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
    } = {},
  ): ResolverFactory => {
    return () =>
      ({
        setServers: mock(() => {}),
        resolve4: mock(() =>
          config.resolve4 instanceof Error
            ? Promise.reject(config.resolve4)
            : Promise.resolve(config.resolve4 ?? []),
        ),
        resolve6: mock(() =>
          config.resolve6 instanceof Error
            ? Promise.reject(config.resolve6)
            : Promise.resolve(config.resolve6 ?? []),
        ),
        resolveCname: mock(() =>
          config.resolveCname instanceof Error
            ? Promise.reject(config.resolveCname)
            : Promise.resolve(config.resolveCname ?? []),
        ),
        resolveMx: mock(() =>
          config.resolveMx instanceof Error
            ? Promise.reject(config.resolveMx)
            : Promise.resolve(config.resolveMx ?? []),
        ),
        resolveTxt: mock(() =>
          config.resolveTxt instanceof Error
            ? Promise.reject(config.resolveTxt)
            : Promise.resolve(config.resolveTxt ?? []),
        ),
        resolveNs: mock(() =>
          config.resolveNs instanceof Error
            ? Promise.reject(config.resolveNs)
            : Promise.resolve(config.resolveNs ?? []),
        ),
      }) as DnsResolver;
  };

  describe("createClient", () => {
    it("should return a connected client", async () => {
      const strategy = new DnsHealthCheckStrategy(createMockResolver());
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      expect(connectedClient.client).toBeDefined();
      expect(connectedClient.client.exec).toBeDefined();
      expect(connectedClient.close).toBeDefined();
    });

    it("should allow closing the client", async () => {
      const strategy = new DnsHealthCheckStrategy(createMockResolver());
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      expect(() => connectedClient.close()).not.toThrow();
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

      const connectedClient = await strategy.createClient({
        nameserver: "8.8.8.8",
        timeout: 5000,
      });

      // Execute to trigger resolver setup
      await connectedClient.client.exec({
        hostname: "example.com",
        recordType: "A",
      });

      expect(setServersMock).toHaveBeenCalledWith(["8.8.8.8"]);

      connectedClient.close();
    });
  });

  describe("client.exec", () => {
    it("should return resolved values for successful A record resolution", async () => {
      const strategy = new DnsHealthCheckStrategy(
        createMockResolver({ resolve4: ["1.2.3.4", "5.6.7.8"] }),
      );
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      const result = await connectedClient.client.exec({
        hostname: "example.com",
        recordType: "A",
      });

      expect(result.values).toEqual(["1.2.3.4", "5.6.7.8"]);

      connectedClient.close();
    });

    it("should return error for DNS error", async () => {
      const strategy = new DnsHealthCheckStrategy(
        createMockResolver({ resolve4: new Error("NXDOMAIN") }),
      );
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      const result = await connectedClient.client.exec({
        hostname: "nonexistent.example.com",
        recordType: "A",
      });

      expect(result.error).toContain("NXDOMAIN");

      connectedClient.close();
    });

    it("should resolve MX records correctly", async () => {
      const strategy = new DnsHealthCheckStrategy(
        createMockResolver({
          resolveMx: [
            { priority: 0, exchange: "mail1.example.com" },
            { priority: 10, exchange: "mail2.example.com" },
          ],
        }),
      );
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      const result = await connectedClient.client.exec({
        hostname: "example.com",
        recordType: "MX",
      });

      expect(result.values).toContain("0 mail1.example.com");

      connectedClient.close();
    });
  });

  describe("mergeResult", () => {
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

      // Merge runs incrementally
      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgResolutionTime.avg).toBe(15);
      expect(aggregated.failureCount.count).toBe(0);
      expect(aggregated.errorCount.count).toBe(0);
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

      // Merge runs incrementally
      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);

      expect(aggregated.errorCount.count).toBe(1);
      expect(aggregated.failureCount.count).toBe(2);
    });
  });
});
