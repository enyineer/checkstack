import { describe, expect, it } from "bun:test";
import { BuildHistoryCollector } from "./build-history";
import type {
  JenkinsTransportClient,
  JenkinsResponse,
} from "../transport-client";

describe("BuildHistoryCollector", () => {
  const collector = new BuildHistoryCollector();

  const createMockClient = (
    response: JenkinsResponse
  ): JenkinsTransportClient => ({
    exec: async () => response,
  });

  it("should collect build history successfully", async () => {
    const mockClient = createMockClient({
      statusCode: 200,
      data: {
        builds: [
          { number: 10, result: "SUCCESS", duration: 60000 },
          { number: 9, result: "SUCCESS", duration: 55000 },
          { number: 8, result: "FAILURE", duration: 40000 },
          { number: 7, result: "UNSTABLE", duration: 70000 },
          { number: 6, result: "SUCCESS", duration: 65000 },
        ],
      },
    });

    const result = await collector.execute({
      config: { jobName: "my-job", buildCount: 10 },
      client: mockClient,
      pluginId: "healthcheck-jenkins",
    });

    expect(result.error).toBeUndefined();
    expect(result.result.totalBuilds).toBe(5);
    expect(result.result.successCount).toBe(3);
    expect(result.result.failureCount).toBe(1);
    expect(result.result.unstableCount).toBe(1);
    expect(result.result.successRate).toBe(60);
    expect(result.result.avgDurationMs).toBe(58000);
    expect(result.result.minDurationMs).toBe(40000);
    expect(result.result.maxDurationMs).toBe(70000);
    expect(result.result.lastSuccessBuildNumber).toBe(10);
    expect(result.result.lastFailureBuildNumber).toBe(8);
  });

  it("should handle empty builds array", async () => {
    const mockClient = createMockClient({
      statusCode: 200,
      data: { builds: [] },
    });

    const result = await collector.execute({
      config: { jobName: "new-job", buildCount: 10 },
      client: mockClient,
      pluginId: "healthcheck-jenkins",
    });

    expect(result.error).toBeUndefined();
    expect(result.result.totalBuilds).toBe(0);
    expect(result.result.successRate).toBe(0);
  });

  it("should aggregate correctly", () => {
    const runs: Parameters<typeof collector.mergeResult>[1][] = [
      {
        status: "healthy" as const,
        latencyMs: 100,
        metadata: {
          totalBuilds: 10,
          successCount: 8,
          failureCount: 1,
          unstableCount: 1,
          abortedCount: 0,
          successRate: 80,
          avgDurationMs: 60000,
          minDurationMs: 40000,
          maxDurationMs: 80000,
        },
      },
      {
        status: "healthy" as const,
        latencyMs: 100,
        metadata: {
          totalBuilds: 10,
          successCount: 6,
          failureCount: 2,
          unstableCount: 1,
          abortedCount: 1,
          successRate: 60,
          avgDurationMs: 80000,
          minDurationMs: 50000,
          maxDurationMs: 100000,
        },
      },
    ];

    let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

    expect(aggregated.avgSuccessRate.avg).toBe(70);
    expect(aggregated.avgBuildDuration.avg).toBe(70000);
  });
});
