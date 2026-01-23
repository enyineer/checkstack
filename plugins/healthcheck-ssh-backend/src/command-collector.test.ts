import { describe, expect, it, mock } from "bun:test";
import { CommandCollector, type CommandConfig } from "./command-collector";
import type { SshTransportClient } from "@checkstack/healthcheck-ssh-common";

describe("CommandCollector", () => {
  const createMockClient = (
    response: {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
    } = {}
  ): SshTransportClient => ({
    exec: mock(() =>
      Promise.resolve({
        exitCode: response.exitCode ?? 0,
        stdout: response.stdout ?? "",
        stderr: response.stderr ?? "",
      })
    ),
  });

  describe("execute", () => {
    it("should execute command successfully", async () => {
      const collector = new CommandCollector();
      const client = createMockClient({
        exitCode: 0,
        stdout: "Hello World",
      });

      const result = await collector.execute({
        config: { command: "echo 'Hello World'" },
        client,
        pluginId: "test",
      });

      expect(result.result.exitCode).toBe(0);
      expect(result.result.stdout).toBe("Hello World");
      expect(result.result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should return non-zero exit code for failed command", async () => {
      const collector = new CommandCollector();
      const client = createMockClient({
        exitCode: 1,
        stderr: "Command not found",
      });

      const result = await collector.execute({
        config: { command: "nonexistent-command" },
        client,
        pluginId: "test",
      });

      expect(result.result.exitCode).toBe(1);
      expect(result.result.stderr).toBe("Command not found");
    });

    it("should pass command to client", async () => {
      const collector = new CommandCollector();
      const client = createMockClient();

      await collector.execute({
        config: { command: "ls -la /tmp" },
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith("ls -la /tmp");
    });
  });

  describe("mergeResult", () => {
    it("should calculate average execution time and success rate", () => {
      const collector = new CommandCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            exitCode: 0,
            stdout: "",
            stderr: "",
            executionTimeMs: 50,
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            exitCode: 0,
            stdout: "",
            stderr: "",
            executionTimeMs: 100,
          },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgExecutionTimeMs.avg).toBe(75);
      expect(aggregated.successRate.rate).toBe(100);
    });

    it("should calculate success rate based on exit codes", () => {
      const collector = new CommandCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            exitCode: 0,
            stdout: "",
            stderr: "",
            executionTimeMs: 50,
          },
        },
        {
          id: "2",
          status: "unhealthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            exitCode: 1,
            stdout: "",
            stderr: "",
            executionTimeMs: 100,
          },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.successRate.rate).toBe(50);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new CommandCollector();

      expect(collector.id).toBe("command");
      expect(collector.displayName).toBe("Shell Command");
      expect(collector.allowMultiple).toBe(true);
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});
