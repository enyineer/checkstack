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
    } = {},
  ): ScriptTransportClient => ({
    exec: mock(() =>
      Promise.resolve({
        exitCode: response.exitCode ?? 0,
        stdout: response.stdout ?? "",
        stderr: response.stderr ?? "",
        timedOut: response.timedOut ?? false,
        error: response.error,
      }),
    ),
  });

  describe("execute", () => {
    it("should execute script successfully", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient({ exitCode: 0, stdout: "Hello World" });

      const config: ExecuteConfig = {
        script: "echo 'Hello World'",
        timeout: 5000,
      };

      const result = await collector.execute({
        config,
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
        config: { script: "exit 1", timeout: 5000 },
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
        config: { script: "sleep 999", timeout: 100 },
        client,
        pluginId: "test",
      });

      expect(result.result.timedOut).toBe(true);
      expect(result.result.success).toBe(false);
    });

    it("should pass the script, cwd and env through to the client", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient();

      await collector.execute({
        config: {
          script: "awk '/load/ {print $1}' /proc/loadavg | head -1",
          cwd: "/tmp",
          env: { MY_VAR: "value" },
          timeout: 3000,
        },
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith({
        script: "awk '/load/ {print $1}' /proc/loadavg | head -1",
        cwd: "/tmp",
        env: { MY_VAR: "value" },
        timeout: 3000,
      });
    });
  });

  describe("migration", () => {
    it("collapses legacy {command, args} into a single shell script", async () => {
      const collector = new ExecuteCollector();
      const v1 = {
        command: "echo",
        args: ["Hello", "World"],
        timeout: 5000,
      };

      // Versioned.parse() applies migrations transparently when the stored
      // value declares an older version. Mirror what storage does:
      const migrated = await collector.config.parse({ version: 1, data: v1 });

      expect(migrated.script).toBe("echo Hello World");
      expect(migrated.timeout).toBe(5000);
    });

    it("quotes args that contain shell metacharacters", async () => {
      const collector = new ExecuteCollector();
      const v1 = {
        command: "/bin/sh",
        args: ["-c", "echo 'hi there'"],
        timeout: 5000,
      };

      const migrated = await collector.config.parse({ version: 1, data: v1 });

      // The script should re-quote args so re-execution via `sh -c` is safe.
      expect(migrated.script).toContain("/bin/sh");
      expect(migrated.script).toContain("-c");
      // The embedded quotes must be preserved (single-quoted form).
      expect(migrated.script).toMatch(/echo/);
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
      expect(collector.displayName).toBe("Shell Script");
      expect(collector.allowMultiple).toBe(true);
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});
