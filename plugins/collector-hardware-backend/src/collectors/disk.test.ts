import { describe, expect, it, mock } from "bun:test";
import { DiskCollector, type DiskConfig } from "./disk";
import type { SshTransportClient } from "@checkstack/healthcheck-ssh-common";

describe("DiskCollector", () => {
  const createMockClient = (
    dfOutput: string = "/dev/sda1 100G 45G 55G 45% /"
  ): SshTransportClient => ({
    exec: mock(() =>
      Promise.resolve({
        exitCode: 0,
        stdout: dfOutput,
        stderr: "",
      })
    ),
  });

  describe("execute", () => {
    it("should collect disk usage for mount point", async () => {
      const collector = new DiskCollector();
      const client = createMockClient("/dev/sda1     100G   45G   55G  45% /");

      const result = await collector.execute({
        config: { mountPoint: "/" },
        client,
        pluginId: "test",
      });

      expect(result.result.filesystem).toBe("/dev/sda1");
      expect(result.result.totalGb).toBe(100);
      expect(result.result.usedGb).toBe(45);
      expect(result.result.availableGb).toBe(55);
      expect(result.result.usedPercent).toBe(45);
      expect(result.result.mountPoint).toBe("/");
    });

    it("should handle different mount points", async () => {
      const collector = new DiskCollector();
      const client = createMockClient(
        "/dev/sdb1     500G   200G   300G  40% /data"
      );

      const result = await collector.execute({
        config: { mountPoint: "/data" },
        client,
        pluginId: "test",
      });

      expect(result.result.filesystem).toBe("/dev/sdb1");
      expect(result.result.totalGb).toBe(500);
      expect(result.result.usedPercent).toBe(40);
      expect(result.result.mountPoint).toBe("/data");
    });

    it("should pass mount point to df command", async () => {
      const collector = new DiskCollector();
      const client = createMockClient();

      await collector.execute({
        config: { mountPoint: "/var" },
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith("df -BG /var | tail -1");
    });
  });

  describe("mergeResult", () => {
    it("should calculate average and max disk usage", () => {
      const collector = new DiskCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            filesystem: "/dev/sda1",
            totalGb: 100,
            usedGb: 30,
            availableGb: 70,
            usedPercent: 30,
            mountPoint: "/",
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            filesystem: "/dev/sda1",
            totalGb: 100,
            usedGb: 50,
            availableGb: 50,
            usedPercent: 50,
            mountPoint: "/",
          },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgUsedPercent.avg).toBe(40);
      expect(aggregated.maxUsedPercent.max).toBe(50);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new DiskCollector();

      expect(collector.id).toBe("disk");
      expect(collector.displayName).toBe("Disk Metrics");
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});
