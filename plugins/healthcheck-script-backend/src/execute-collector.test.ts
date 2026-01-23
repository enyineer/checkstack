import { describe, expect, it, mock } from "bun:test";
import { ExecuteCollector, type ExecuteConfig } from "./execute-collector";
import type { ScriptTransportClient } from "./transport-client";

describe("ExecuteCollector", () => {
  const createMockClient = (
    response: {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      timedOut?: boolean;
      error?: string;
    } = {}
  ): ScriptTransportClient => ({
    exec: mock(() =>
      Promise.resolve({
        exitCode: response.exitCode ?? 0,
        stdout: response.stdout ?? "",
        stderr: response.stderr ?? "",
        timedOut: response.timedOut ?? false,
        error: response.error,
      })
    ),
  });

  describe("execute", () => {
    it("should execute script successfully", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient({ exitCode: 0, stdout: "Hello World" });

      const result = await collector.execute({
        config: { command: "echo", args: ["Hello", "World"], timeout: 5000 },
        client,
        pluginId: "test",
      });

      expect(result.result.exitCode).toBe(0);
      expect(result.result.stdout).toBe("Hello World");
      expect(result.result.success).toBe(true);
      expect(result.result.timedOut).toBe(false);
      expect(result.result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it("should return error for failed script", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient({
        exitCode: 1,
        stderr: "Command not found",
      });

      const result = await collector.execute({
        config: { command: "nonexistent", args: [], timeout: 5000 },
        client,
        pluginId: "test",
      });

      expect(result.result.exitCode).toBe(1);
      expect(result.result.success).toBe(false);
      expect(result.error).toContain("Exit code: 1");
    });

    it("should handle timeout", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient({ timedOut: true, exitCode: -1 });

      const result = await collector.execute({
        config: { command: "sleep", args: ["999"], timeout: 100 },
        client,
        pluginId: "test",
      });

      expect(result.result.timedOut).toBe(true);
      expect(result.result.success).toBe(false);
    });

    it("should pass correct parameters to client", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient();

      await collector.execute({
        config: {
          command: "/usr/bin/check",
          args: ["--verbose"],
          cwd: "/tmp",
          env: { MY_VAR: "value" },
          timeout: 3000,
        },
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith({
        command: "/usr/bin/check",
        args: ["--verbose"],
        cwd: "/tmp",
        env: { MY_VAR: "value" },
        timeout: 3000,
      });
    });
  });

  describe("mergeResult", () => {
    it("should calculate average execution time and success rate", () => {
      const collector = new ExecuteCollector();
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
            success: true,
            timedOut: false,
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
            success: true,
            timedOut: false,
          },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgExecutionTimeMs.avg).toBe(75);
      expect(aggregated.successRate.rate).toBe(100);
    });

    it("should calculate success rate correctly", () => {
      const collector = new ExecuteCollector();
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
            success: true,
            timedOut: false,
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
            success: false,
            timedOut: false,
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
      const collector = new ExecuteCollector();

      expect(collector.id).toBe("execute");
      expect(collector.displayName).toBe("Execute Script");
      expect(collector.allowMultiple).toBe(true);
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});
