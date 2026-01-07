import { describe, expect, it, mock } from "bun:test";
import { ScriptHealthCheckStrategy, ScriptExecutor } from "./strategy";

describe("ScriptHealthCheckStrategy", () => {
  // Helper to create mock Script executor
  const createMockExecutor = (
    config: {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      timedOut?: boolean;
      error?: Error;
    } = {}
  ): ScriptExecutor => ({
    execute: mock(() =>
      config.error
        ? Promise.reject(config.error)
        : Promise.resolve({
            exitCode: config.exitCode ?? 0,
            stdout: config.stdout ?? "",
            stderr: config.stderr ?? "",
            timedOut: config.timedOut ?? false,
          })
    ),
  });

  describe("execute", () => {
    it("should return healthy for successful script execution", async () => {
      const strategy = new ScriptHealthCheckStrategy(
        createMockExecutor({ exitCode: 0, stdout: "OK" })
      );

      const result = await strategy.execute({
        command: "/usr/bin/true",
        timeout: 5000,
      });

      expect(result.status).toBe("healthy");
      expect(result.metadata?.executed).toBe(true);
      expect(result.metadata?.success).toBe(true);
      expect(result.metadata?.exitCode).toBe(0);
    });

    it("should return unhealthy for non-zero exit code", async () => {
      const strategy = new ScriptHealthCheckStrategy(
        createMockExecutor({ exitCode: 1, stderr: "Error" })
      );

      const result = await strategy.execute({
        command: "/usr/bin/false",
        timeout: 5000,
      });

      expect(result.status).toBe("unhealthy");
      expect(result.metadata?.exitCode).toBe(1);
      expect(result.metadata?.success).toBe(false);
    });

    it("should return unhealthy for timeout", async () => {
      const strategy = new ScriptHealthCheckStrategy(
        createMockExecutor({ timedOut: true, exitCode: -1 })
      );

      const result = await strategy.execute({
        command: "sleep",
        args: ["60"],
        timeout: 1000,
      });

      expect(result.status).toBe("unhealthy");
      expect(result.message).toContain("timed out");
      expect(result.metadata?.timedOut).toBe(true);
    });

    it("should return unhealthy for execution error", async () => {
      const strategy = new ScriptHealthCheckStrategy(
        createMockExecutor({ error: new Error("Command not found") })
      );

      const result = await strategy.execute({
        command: "nonexistent-command",
        timeout: 5000,
      });

      expect(result.status).toBe("unhealthy");
      expect(result.message).toContain("Command not found");
      expect(result.metadata?.executed).toBe(false);
    });

    it("should pass executionTime assertion when below threshold", async () => {
      const strategy = new ScriptHealthCheckStrategy(createMockExecutor());

      const result = await strategy.execute({
        command: "/usr/bin/true",
        timeout: 5000,
        assertions: [
          { field: "executionTime", operator: "lessThan", value: 5000 },
        ],
      });

      expect(result.status).toBe("healthy");
    });

    it("should pass exitCode assertion", async () => {
      const strategy = new ScriptHealthCheckStrategy(
        createMockExecutor({ exitCode: 0 })
      );

      const result = await strategy.execute({
        command: "/usr/bin/true",
        timeout: 5000,
        assertions: [{ field: "exitCode", operator: "equals", value: 0 }],
      });

      expect(result.status).toBe("healthy");
    });

    it("should fail exitCode assertion when non-zero", async () => {
      const strategy = new ScriptHealthCheckStrategy(
        createMockExecutor({ exitCode: 2 })
      );

      const result = await strategy.execute({
        command: "/usr/bin/false",
        timeout: 5000,
        assertions: [{ field: "exitCode", operator: "equals", value: 0 }],
      });

      expect(result.status).toBe("unhealthy");
      expect(result.message).toContain("Assertion failed");
    });

    it("should pass stdout assertion", async () => {
      const strategy = new ScriptHealthCheckStrategy(
        createMockExecutor({ stdout: "Service is running" })
      );

      const result = await strategy.execute({
        command: "/usr/bin/echo",
        args: ["Service is running"],
        timeout: 5000,
        assertions: [
          { field: "stdout", operator: "contains", value: "running" },
        ],
      });

      expect(result.status).toBe("healthy");
    });

    it("should pass with arguments and env vars", async () => {
      const mockExecutor = createMockExecutor({ exitCode: 0 });
      const strategy = new ScriptHealthCheckStrategy(mockExecutor);

      await strategy.execute({
        command: "./check.sh",
        args: ["--verbose", "--env=prod"],
        cwd: "/opt/scripts",
        env: { API_KEY: "secret" },
        timeout: 5000,
      });

      expect(mockExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "./check.sh",
          args: ["--verbose", "--env=prod"],
          cwd: "/opt/scripts",
          env: { API_KEY: "secret" },
        })
      );
    });
  });

  describe("aggregateResult", () => {
    it("should calculate averages correctly", () => {
      const strategy = new ScriptHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            executed: true,
            executionTimeMs: 50,
            exitCode: 0,
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
            executed: true,
            executionTimeMs: 100,
            exitCode: 0,
            success: true,
            timedOut: false,
          },
        },
      ];

      const aggregated = strategy.aggregateResult(runs);

      expect(aggregated.avgExecutionTime).toBe(75);
      expect(aggregated.successRate).toBe(100);
      expect(aggregated.errorCount).toBe(0);
      expect(aggregated.timeoutCount).toBe(0);
    });

    it("should count errors and timeouts", () => {
      const strategy = new ScriptHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "unhealthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            executed: false,
            executionTimeMs: 100,
            success: false,
            timedOut: false,
            error: "Command not found",
          },
        },
        {
          id: "2",
          status: "unhealthy" as const,
          latencyMs: 1000,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            executed: true,
            executionTimeMs: 1000,
            exitCode: -1,
            success: false,
            timedOut: true,
          },
        },
      ];

      const aggregated = strategy.aggregateResult(runs);

      expect(aggregated.errorCount).toBe(1);
      expect(aggregated.timeoutCount).toBe(1);
      expect(aggregated.successRate).toBe(0);
    });
  });
});
