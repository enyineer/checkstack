import { describe, expect, it, mock } from "bun:test";
import { ScriptHealthCheckStrategy, ScriptExecutor } from "./strategy";

describe("ScriptHealthCheckStrategy", () => {
  const createMockExecutor = (
    config: {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      timedOut?: boolean;
      error?: Error;
    } = {},
  ): ScriptExecutor => ({
    execute: mock(() =>
      config.error
        ? Promise.reject(config.error)
        : Promise.resolve({
            exitCode: config.exitCode ?? 0,
            stdout: config.stdout ?? "",
            stderr: config.stderr ?? "",
            timedOut: config.timedOut ?? false,
          }),
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
        createMockExecutor({ exitCode: 0, stdout: "OK" }),
      );
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      const result = await connectedClient.client.exec({
        script: "true",
        timeout: 5000,
      });

      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);

      connectedClient.close();
    });

    it("should return non-zero exit code for failed script", async () => {
      const strategy = new ScriptHealthCheckStrategy(
        createMockExecutor({ exitCode: 1, stderr: "Error" }),
      );
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      const result = await connectedClient.client.exec({
        script: "false",
        timeout: 5000,
      });

      expect(result.exitCode).toBe(1);

      connectedClient.close();
    });

    it("should indicate timeout for timed out script", async () => {
      const strategy = new ScriptHealthCheckStrategy(
        createMockExecutor({ timedOut: true, exitCode: -1 }),
      );
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      const result = await connectedClient.client.exec({
        script: "sleep 60",
        timeout: 1000,
      });

      expect(result.timedOut).toBe(true);

      connectedClient.close();
    });

    it("should return error for execution error", async () => {
      const strategy = new ScriptHealthCheckStrategy(
        createMockExecutor({ error: new Error("Command not found") }),
      );
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      const result = await connectedClient.client.exec({
        script: "no-such-binary-anywhere",
        timeout: 5000,
      });

      expect(result.error).toContain("Command not found");

      connectedClient.close();
    });

    it("should pass script, cwd and env through to executor", async () => {
      const mockExecutor = createMockExecutor({ exitCode: 0 });
      const strategy = new ScriptHealthCheckStrategy(mockExecutor);
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      await connectedClient.client.exec({
        script: "./check.sh --verbose --env=prod",
        cwd: "/opt/scripts",
        env: { API_KEY: "secret" },
        timeout: 5000,
      });

      expect(mockExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          script: "./check.sh --verbose --env=prod",
          cwd: "/opt/scripts",
          env: { API_KEY: "secret" },
        }),
      );

      connectedClient.close();
    });
  });

  describe("mergeResult", () => {
    // Build a run in the exact shape the queue executor STORES for a
    // collector-based script check: the run's overall outcome is carried by
    // `status` / `latencyMs`, and each collector's per-run result lives under
    // `metadata.collectors[<entryId>]`. Success/error are TRANSPORT metrics -
    // `_collectorError` (a genuine transport failure) and `timedOut`, NOT the
    // assertion outcome `_assertionFailed`, which only downgrades `status`. The
    // pre-collector top-level `metadata.success` / `metadata.executionTimeMs`
    // shape is NOT what production produces - encoding it here was exactly why
    // the "0% / 0ms" aggregate bug shipped undetected.
    const storedRun = ({
      status,
      latencyMs,
      executionTimeMs,
      success,
      timedOut = false,
      collectorError,
      assertionFailed,
      entryId = "entry-1",
      collectorId = "inline-script",
    }: {
      status: "healthy" | "unhealthy" | "degraded";
      latencyMs: number;
      executionTimeMs: number;
      success: boolean;
      timedOut?: boolean;
      /** Genuine transport error string (→ stored `_collectorError`). */
      collectorError?: string;
      /** Assertion failure message (→ stored `_assertionFailed`); NOT an error. */
      assertionFailed?: string;
      entryId?: string;
      collectorId?: string;
    }) => ({
      status,
      latencyMs,
      metadata: {
        connected: true,
        connectionTimeMs: 1,
        collectors: {
          [entryId]: {
            _collectorId: collectorId,
            _collectorError: collectorError,
            _assertionFailed: assertionFailed,
            success,
            executionTimeMs,
            timedOut,
          },
        },
      },
    });

    it("aggregates transport success rate and execution time", () => {
      const strategy = new ScriptHealthCheckStrategy();
      const runs = [
        storedRun({
          status: "healthy",
          latencyMs: 100,
          executionTimeMs: 50,
          success: true,
        }),
        storedRun({
          status: "healthy",
          latencyMs: 150,
          executionTimeMs: 100,
          success: true,
        }),
      ];

      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);

      // Strategy-level execution time is the run's wall-clock latency.
      expect(aggregated.avgExecutionTime.avg).toBe(125);
      expect(aggregated.successRate.rate).toBe(100);
      expect(aggregated.errorCount.count).toBe(0);
      expect(aggregated.timeoutCount.count).toBe(0);
    });

    it("regression: does NOT report 0% / 0ms for real collector-based runs", () => {
      // Reproduces the original bug: the per-run charts read ~34ms but the
      // aggregate tiles read 0% / 0ms. Feed 25 transport-successful runs (all
      // with real latency) exactly as the raw-tier aggregation does.
      const strategy = new ScriptHealthCheckStrategy();
      let aggregated = strategy.mergeResult(
        undefined,
        storedRun({
          status: "healthy",
          latencyMs: 34,
          executionTimeMs: 34,
          success: true,
        }),
      );
      for (let i = 0; i < 24; i++) {
        aggregated = strategy.mergeResult(
          aggregated,
          storedRun({
            status: "healthy",
            latencyMs: 34,
            executionTimeMs: 34,
            success: true,
          }),
        );
      }

      expect(aggregated.successRate.rate).toBe(100);
      // Real execution time, NOT 0.
      expect(aggregated.avgExecutionTime.avg).toBe(34);
      expect(aggregated.avgExecutionTime.avg).not.toBe(0);
    });

    it("does NOT count assertion failures as transport errors", () => {
      // The user's real case: 13 of 25 runs fail an assertion (→ `unhealthy`)
      // but the probe RAN every time (no `_collectorError`, no timeout). Success
      // Rate must stay 100%, Errors and Timeouts must stay 0 - assertion health
      // is a separate concern (surfaced by the per-assertion tiles).
      const strategy = new ScriptHealthCheckStrategy();
      let aggregated: ReturnType<typeof strategy.mergeResult> | undefined;
      for (let i = 0; i < 25; i++) {
        const failsAssertion = i < 13;
        aggregated = strategy.mergeResult(
          aggregated,
          storedRun({
            status: failsAssertion ? "unhealthy" : "healthy",
            latencyMs: 34,
            executionTimeMs: 34,
            // A completed probe: `success` (exit 0) may still be true; the
            // assertion is what failed.
            success: true,
            assertionFailed: failsAssertion ? "exitCode equals 0" : undefined,
          }),
        );
      }

      expect(aggregated?.successRate.rate).toBe(100);
      expect(aggregated?.errorCount.count).toBe(0);
      expect(aggregated?.timeoutCount.count).toBe(0);
    });

    it("counts a genuine transport error and lowers the success rate", () => {
      const strategy = new ScriptHealthCheckStrategy();
      const runs = [
        storedRun({
          status: "healthy",
          latencyMs: 30,
          executionTimeMs: 30,
          success: true,
        }),
        // Genuine transport failure: the probe could not complete.
        storedRun({
          status: "unhealthy",
          latencyMs: 5,
          executionTimeMs: 0,
          success: false,
          collectorError: "spawn ENOENT",
        }),
      ];

      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);

      expect(aggregated.successRate.rate).toBe(50);
      expect(aggregated.errorCount.count).toBe(1);
      expect(aggregated.timeoutCount.count).toBe(0);
    });

    it("counts a timeout as both a transport error and a timeout", () => {
      const strategy = new ScriptHealthCheckStrategy();
      // Both collectors set `error` on timeout; assert timeout is a transport
      // failure even if only the `timedOut` flag were present.
      const aggregated = strategy.mergeResult(
        undefined,
        storedRun({
          status: "unhealthy",
          latencyMs: 1000,
          executionTimeMs: 1000,
          success: false,
          timedOut: true,
          collectorError: "Script execution timed out",
        }),
      );

      expect(aggregated.successRate.rate).toBe(0);
      expect(aggregated.errorCount.count).toBe(1);
      expect(aggregated.timeoutCount.count).toBe(1);
    });
  });

  describe("config migration (assume-v1-on-read)", () => {
    const strategy = new ScriptHealthCheckStrategy();

    it("migrates a genuine v1 blob (command/args/...) down to {timeout}", async () => {
      const migrated = await strategy.config.parseAssumingV1({
        command: "/usr/bin/uptime",
        args: ["-p"],
        cwd: "/tmp",
        env: { FOO: "bar" },
        timeout: 9000,
      });
      expect(migrated).toEqual({ timeout: 9000 });
    });

    it("is idempotent: an already-current {timeout} blob is unchanged", async () => {
      const migrated = await strategy.config.parseAssumingV1({ timeout: 2500 });
      expect(migrated).toEqual({ timeout: 2500 });
    });

    it("has a complete v1->version migration chain", () => {
      expect(strategy.config.validateMigrationChainFromV1()).toBeUndefined();
    });
  });
});
