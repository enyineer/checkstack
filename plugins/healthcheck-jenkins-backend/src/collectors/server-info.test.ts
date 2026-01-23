import { describe, expect, it } from "bun:test";
import { ServerInfoCollector } from "./server-info";
import type {
  JenkinsTransportClient,
  JenkinsResponse,
} from "../transport-client";

describe("ServerInfoCollector", () => {
  const collector = new ServerInfoCollector();

  const createMockClient = (
    response: JenkinsResponse,
  ): JenkinsTransportClient => ({
    exec: async () => response,
  });

  it("should collect server info successfully", async () => {
    const mockClient = createMockClient({
      statusCode: 200,
      jenkinsVersion: "2.426.1",
      data: {
        mode: "NORMAL",
        numExecutors: 4,
        usableWorkers: 3,
        jobs: [{ name: "job1" }, { name: "job2" }, { name: "job3" }],
      },
    });

    const result = await collector.execute({
      config: {},
      client: mockClient,
      pluginId: "healthcheck-jenkins",
    });

    expect(result.error).toBeUndefined();
    expect(result.result.jenkinsVersion).toBe("2.426.1");
    expect(result.result.mode).toBe("NORMAL");
    expect(result.result.numExecutors).toBe(4);
    expect(result.result.usableWorkers).toBe(3);
    expect(result.result.totalJobs).toBe(3);
  });

  it("should handle API error", async () => {
    const mockClient = createMockClient({
      statusCode: 401,
      data: null,
      error: "HTTP 401: Unauthorized",
    });

    const result = await collector.execute({
      config: {},
      client: mockClient,
      pluginId: "healthcheck-jenkins",
    });

    expect(result.error).toBe("HTTP 401: Unauthorized");
  });

  it("should aggregate results correctly", () => {
    const runs: Parameters<typeof collector.mergeResult>[1][] = [
      {
        status: "healthy" as const,
        latencyMs: 100,
        metadata: {
          jenkinsVersion: "2.426.1",
          mode: "NORMAL",
          numExecutors: 4,
          usableWorkers: 3,
          totalJobs: 10,
        },
      },
      {
        status: "healthy" as const,
        latencyMs: 100,
        metadata: {
          jenkinsVersion: "2.426.1",
          mode: "NORMAL",
          numExecutors: 6,
          usableWorkers: 5,
          totalJobs: 12,
        },
      },
    ];

    let aggregated = collector.mergeResult(undefined, runs[0]);
    aggregated = collector.mergeResult(aggregated, runs[1]);

    expect(aggregated.avgExecutors.avg).toBe(5);
    expect(aggregated.avgTotalJobs.avg).toBe(11);
  });
});
