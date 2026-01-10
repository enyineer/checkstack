import { describe, expect, it, mock } from "bun:test";
import { SshHealthCheckStrategy, SshClient } from "./strategy";

describe("SshHealthCheckStrategy", () => {
  // Helper to create mock SSH client
  const createMockClient = (
    config: {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      execError?: Error;
      connectError?: Error;
    } = {}
  ): SshClient => ({
    connect: mock(() =>
      config.connectError
        ? Promise.reject(config.connectError)
        : Promise.resolve({
            exec: mock(() =>
              config.execError
                ? Promise.reject(config.execError)
                : Promise.resolve({
                    exitCode: config.exitCode ?? 0,
                    stdout: config.stdout ?? "",
                    stderr: config.stderr ?? "",
                  })
            ),
            end: mock(() => {}),
          })
    ),
  });

  describe("createClient", () => {
    it("should return a connected client for successful connection", async () => {
      const strategy = new SshHealthCheckStrategy(createMockClient());

      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 22,
        username: "user",
        password: "secret",
        timeout: 5000,
      });

      expect(connectedClient.client).toBeDefined();
      expect(connectedClient.client.exec).toBeDefined();
      expect(connectedClient.close).toBeDefined();

      connectedClient.close();
    });

    it("should throw for connection error", async () => {
      const strategy = new SshHealthCheckStrategy(
        createMockClient({ connectError: new Error("Connection refused") })
      );

      await expect(
        strategy.createClient({
          host: "localhost",
          port: 22,
          username: "user",
          password: "secret",
          timeout: 5000,
        })
      ).rejects.toThrow("Connection refused");
    });
  });

  describe("client.exec", () => {
    it("should execute command successfully", async () => {
      const strategy = new SshHealthCheckStrategy(
        createMockClient({ exitCode: 0, stdout: "OK" })
      );
      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 22,
        username: "user",
        password: "secret",
        timeout: 5000,
      });

      // SSH transport client takes a string command
      const result = await connectedClient.client.exec("echo OK");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("OK");

      connectedClient.close();
    });

    it("should return non-zero exit code for failed command", async () => {
      const strategy = new SshHealthCheckStrategy(
        createMockClient({ exitCode: 1, stderr: "Error" })
      );
      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 22,
        username: "user",
        password: "secret",
        timeout: 5000,
      });

      const result = await connectedClient.client.exec("exit 1");

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("Error");

      connectedClient.close();
    });
  });

  describe("aggregateResult", () => {
    it("should calculate averages correctly", () => {
      const strategy = new SshHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: true,
            connectionTimeMs: 50,
            exitCode: 0,
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: true,
            connectionTimeMs: 100,
            exitCode: 0,
          },
        },
      ];

      const aggregated = strategy.aggregateResult(runs);

      expect(aggregated.avgConnectionTime).toBe(75);
      expect(aggregated.successRate).toBe(100);
      expect(aggregated.errorCount).toBe(0);
    });

    it("should count errors", () => {
      const strategy = new SshHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "unhealthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: false,
            connectionTimeMs: 100,
            error: "Connection refused",
          },
        },
      ];

      const aggregated = strategy.aggregateResult(runs);

      expect(aggregated.errorCount).toBe(1);
      expect(aggregated.successRate).toBe(0);
    });
  });
});
