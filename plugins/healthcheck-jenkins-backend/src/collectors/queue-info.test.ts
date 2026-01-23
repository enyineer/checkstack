import { describe, expect, it } from "bun:test";
import { QueueInfoCollector } from "./queue-info";
import type {
  JenkinsTransportClient,
  JenkinsResponse,
} from "../transport-client";

describe("QueueInfoCollector", () => {
  const collector = new QueueInfoCollector();

  const createMockClient = (
    response: JenkinsResponse
  ): JenkinsTransportClient => ({
    exec: async () => response,
  });

  it("should collect queue info successfully", async () => {
    const now = Date.now();
    const mockClient = createMockClient({
      statusCode: 200,
      data: {
        items: [
          {
            id: 1,
            blocked: false,
            buildable: true,
            stuck: false,
            inQueueSince: now - 5000,
          },
          {
            id: 2,
            blocked: true,
            buildable: false,
            stuck: false,
            inQueueSince: now - 10000,
          },
          {
            id: 3,
            blocked: false,
            buildable: true,
            stuck: true,
            inQueueSince: now - 30000,
          },
        ],
      },
    });

    const result = await collector.execute({
      config: {},
      client: mockClient,
      pluginId: "healthcheck-jenkins",
    });

    expect(result.result.queueLength).toBe(3);
    expect(result.result.blockedCount).toBe(1);
    expect(result.result.buildableCount).toBe(2);
    expect(result.result.stuckCount).toBe(1);
    expect(result.result.oldestWaitingMs).toBeGreaterThanOrEqual(30000);
    // Error should be set because stuck > 0
    expect(result.error).toContain("stuck");
  });

  it("should report no error for empty queue", async () => {
    const mockClient = createMockClient({
      statusCode: 200,
      data: { items: [] },
    });

    const result = await collector.execute({
      config: {},
      client: mockClient,
      pluginId: "healthcheck-jenkins",
    });

    expect(result.error).toBeUndefined();
    expect(result.result.queueLength).toBe(0);
  });

  it("should aggregate correctly", () => {
    const runs: Parameters<typeof collector.mergeResult>[1][] = [
      {
        status: "healthy" as const,
        latencyMs: 100,
        metadata: {
          queueLength: 5,
          blockedCount: 1,
          buildableCount: 4,
          stuckCount: 0,
          oldestWaitingMs: 15000,
          avgWaitingMs: 10000,
        },
      },
      {
        status: "healthy" as const,
        latencyMs: 100,
        metadata: {
          queueLength: 3,
          blockedCount: 0,
          buildableCount: 3,
          stuckCount: 0,
          oldestWaitingMs: 25000,
          avgWaitingMs: 20000,
        },
      },
    ];

    let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

    expect(aggregated.avgQueueLength.avg).toBe(4);
    expect(aggregated.maxQueueLength.max).toBe(5);
    expect(aggregated.avgWaitTime.avg).toBe(15000);
  });
});
