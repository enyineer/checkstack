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

  describe("createClient", () => {
    it("should return a connected client", async () => {
      const strategy = new ScriptHealthCheckStrategy(createMockExecutor());
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      expect(connectedClient.client).toBeDefined();
      expect(connectedClient.client.exec).toBeDefined();
      expect(connectedClient.close).toBeDefined();
    });

    it("should allow closing the client", async () => {
      const strategy = new ScriptHealthCheckStrategy(createMockExecutor());
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      expect(() => connectedClient.close()).not.toThrow();
    });
  });

  describe("client.exec", () => {
    it("should return successful result for successful script execution", async () => {
      const strategy = new ScriptHealthCheckStrategy(
        createMockExecutor({ exitCode: 0, stdout: "OK" })
      );
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      const result = await connectedClient.client.exec({
        command: "/usr/bin/true",
        args: [],
        timeout: 5000,
      });

      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);

      connectedClient.close();
    });

    it("should return non-zero exit code for failed script", async () => {
      const strategy = new ScriptHealthCheckStrategy(
        createMockExecutor({ exitCode: 1, stderr: "Error" })
      );
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      const result = await connectedClient.client.exec({
        command: "/usr/bin/false",
        args: [],
        timeout: 5000,
      });

      expect(result.exitCode).toBe(1);

      connectedClient.close();
    });

    it("should indicate timeout for timed out script", async () => {
      const strategy = new ScriptHealthCheckStrategy(
        createMockExecutor({ timedOut: true, exitCode: -1 })
      );
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      const result = await connectedClient.client.exec({
        command: "sleep",
        args: ["60"],
        timeout: 1000,
      });

      expect(result.timedOut).toBe(true);

      connectedClient.close();
    });

    it("should return error for execution error", async () => {
      const strategy = new ScriptHealthCheckStrategy(
        createMockExecutor({ error: new Error("Command not found") })
      );
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      const result = await connectedClient.client.exec({
        command: "nonexistent-command",
        args: [],
        timeout: 5000,
      });

      expect(result.error).toContain("Command not found");

      connectedClient.close();
    });

    it("should pass arguments, cwd, and env to executor", async () => {
      const mockExecutor = createMockExecutor({ exitCode: 0 });
      const strategy = new ScriptHealthCheckStrategy(mockExecutor);
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      await connectedClient.client.exec({
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

      connectedClient.close();
    });
  });

  describe("mergeResult", () => {
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

      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgExecutionTime.avg).toBe(75);
      expect(aggregated.successRate.rate).toBe(100);
      expect(aggregated.errorCount.count).toBe(0);
      expect(aggregated.timeoutCount.count).toBe(0);
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

      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);

      expect(aggregated.errorCount.count).toBe(1);
      expect(aggregated.timeoutCount.count).toBe(1);
      expect(aggregated.successRate.rate).toBe(0);
    });
  });
});
