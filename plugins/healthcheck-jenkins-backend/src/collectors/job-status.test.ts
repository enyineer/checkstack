import { describe, expect, it } from "bun:test";
import { JobStatusCollector } from "./job-status";
import type {
  JenkinsTransportClient,
  JenkinsResponse,
} from "../transport-client";

describe("JobStatusCollector", () => {
  const collector = new JobStatusCollector();

  const createMockClient = (
    response: JenkinsResponse,
  ): JenkinsTransportClient => ({
    exec: async () => response,
  });

  it("should collect job status successfully", async () => {
    const mockClient = createMockClient({
      statusCode: 200,
      data: {
        name: "my-job",
        buildable: true,
        color: "blue",
        inQueue: false,
        lastBuild: {
          number: 42,
          result: "SUCCESS",
          duration: 60000,
          timestamp: Date.now() - 3600000, // 1 hour ago
        },
      },
    });

    const result = await collector.execute({
      config: { jobName: "my-job", checkLastBuild: true },
      client: mockClient,
      pluginId: "healthcheck-jenkins",
    });

    expect(result.error).toBeUndefined();
    expect(result.result.jobName).toBe("my-job");
    expect(result.result.buildable).toBe(true);
    expect(result.result.color).toBe("blue");
    expect(result.result.lastBuildNumber).toBe(42);
    expect(result.result.lastBuildResult).toBe("SUCCESS");
    expect(result.result.lastBuildDurationMs).toBe(60000);
    expect(result.result.timeSinceLastBuildMs).toBeGreaterThan(0);
  });

  it("should report error for failed build", async () => {
    const mockClient = createMockClient({
      statusCode: 200,
      data: {
        name: "failing-job",
        buildable: true,
        color: "red",
        inQueue: false,
        lastBuild: {
          number: 10,
          result: "FAILURE",
          duration: 30000,
          timestamp: Date.now() - 1800000,
        },
      },
    });

    const result = await collector.execute({
      config: { jobName: "failing-job", checkLastBuild: true },
      client: mockClient,
      pluginId: "healthcheck-jenkins",
    });

    expect(result.error).toBe("Last build: FAILURE");
    expect(result.result.lastBuildResult).toBe("FAILURE");
  });

  it("should handle folder paths correctly", async () => {
    let capturedPath = "";
    const mockClient: JenkinsTransportClient = {
      exec: async (req) => {
        capturedPath = req.path;
        return {
          statusCode: 200,
          data: { name: "nested-job", buildable: true, color: "blue" },
        };
      },
    };

    await collector.execute({
      config: { jobName: "folder/subfolder/nested-job", checkLastBuild: false },
      client: mockClient,
      pluginId: "healthcheck-jenkins",
    });

    expect(capturedPath).toBe(
      "/job/folder/job/subfolder/job/nested-job/api/json",
    );
  });

  it("should aggregate success rate correctly", () => {
    const runs: Parameters<typeof collector.mergeResult>[1][] = [
      {
        status: "healthy" as const,
        latencyMs: 100,
        metadata: {
          jobName: "my-job",
          buildable: true,
          inQueue: false,
          color: "blue",
          lastBuildResult: "SUCCESS",
          lastBuildDurationMs: 60000,
        },
      },
      {
        status: "healthy" as const,
        latencyMs: 100,
        metadata: {
          jobName: "my-job",
          buildable: true,
          inQueue: false,
          color: "blue",
          lastBuildResult: "SUCCESS",
          lastBuildDurationMs: 80000,
        },
      },
      {
        status: "unhealthy" as const,
        latencyMs: 100,
        metadata: {
          jobName: "my-job",
          buildable: true,
          inQueue: false,
          color: "red",
          lastBuildResult: "FAILURE",
          lastBuildDurationMs: 40000,
        },
      },
    ];

    let aggregated = collector.mergeResult(undefined, runs[0]);
    aggregated = collector.mergeResult(aggregated, runs[1]);
    aggregated = collector.mergeResult(aggregated, runs[2]);

    expect(aggregated.successRate.rate).toBe(67); // 2/3
    expect(aggregated.avgBuildDurationMs.avg).toBe(60000); // (60000+80000+40000)/3
    expect(aggregated.buildableRate.rate).toBe(100);
  });
});
