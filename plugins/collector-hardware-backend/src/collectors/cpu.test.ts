import { describe, expect, it, mock } from "bun:test";
import { CpuCollector, type CpuConfig } from "./cpu";
import type { SshTransportClient } from "@checkstack/healthcheck-ssh-common";

describe("CpuCollector", () => {
  const createMockClient = (
    responses: {
      stat1?: { stdout: string };
      stat2?: { stdout: string };
      loadavg?: { stdout: string };
      nproc?: { stdout: string };
    } = {},
  ): SshTransportClient => {
    let callCount = 0;
    return {
      exec: mock((cmd: string) => {
        if (cmd.includes("/proc/stat")) {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              exitCode: 0,
              stdout:
                responses.stat1?.stdout ?? "cpu 100 0 50 800 50 0 0 0 0 0",
              stderr: "",
            });
          }
          return Promise.resolve({
            exitCode: 0,
            stdout: responses.stat2?.stdout ?? "cpu 150 0 100 850 50 0 0 0 0 0",
            stderr: "",
          });
        }
        if (cmd.includes("/proc/loadavg")) {
          return Promise.resolve({
            exitCode: 0,
            stdout: responses.loadavg?.stdout ?? "0.50 0.75 1.00 1/100 12345",
            stderr: "",
          });
        }
        if (cmd.includes("nproc")) {
          return Promise.resolve({
            exitCode: 0,
            stdout: responses.nproc?.stdout ?? "4\n",
            stderr: "",
          });
        }
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      }),
    };
  };

  describe("execute", () => {
    it("should collect CPU usage", async () => {
      const collector = new CpuCollector();
      const client = createMockClient();

      const result = await collector.execute({
        config: { includeLoadAverage: false, includeCoreCount: false },
        client,
        pluginId: "test",
      });

      expect(result.result.usagePercent).toBeDefined();
      expect(result.result.usagePercent).toBeGreaterThanOrEqual(0);
      expect(result.result.usagePercent).toBeLessThanOrEqual(100);
    });

    it("should include load averages when configured", async () => {
      const collector = new CpuCollector();
      const client = createMockClient({
        loadavg: { stdout: "1.50 2.00 3.00 1/200 12345" },
      });

      const result = await collector.execute({
        config: { includeLoadAverage: true, includeCoreCount: false },
        client,
        pluginId: "test",
      });

      expect(result.result.loadAvg1m).toBe(1.5);
      expect(result.result.loadAvg5m).toBe(2);
      expect(result.result.loadAvg15m).toBe(3);
    });

    it("should include core count when configured", async () => {
      const collector = new CpuCollector();
      const client = createMockClient({ nproc: { stdout: "8\n" } });

      const result = await collector.execute({
        config: { includeLoadAverage: false, includeCoreCount: true },
        client,
        pluginId: "test",
      });

      expect(result.result.coreCount).toBe(8);
    });
  });

  describe("mergeResult", () => {
    it("should calculate average and max CPU usage", () => {
      const collector = new CpuCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { usagePercent: 25, loadAvg1m: 1.0 },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { usagePercent: 75, loadAvg1m: 2.0 },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgUsagePercent.avg).toBe(50);
      expect(aggregated.maxUsagePercent.max).toBe(75);
      // (1.0 + 2.0) / 2 = 1.5
      expect(aggregated.avgLoadAvg1m.avg).toBe(1.5);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new CpuCollector();

      expect(collector.id).toBe("cpu");
      expect(collector.displayName).toBe("CPU Metrics");
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});
