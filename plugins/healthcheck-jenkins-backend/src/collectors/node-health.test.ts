import { describe, expect, it } from "bun:test";
import { NodeHealthCollector } from "./node-health";
import type {
  JenkinsTransportClient,
  JenkinsRequest,
  JenkinsResponse,
} from "../transport-client";

describe("NodeHealthCollector", () => {
  const collector = new NodeHealthCollector();

  it("should collect all nodes info", async () => {
    const mockClient: JenkinsTransportClient = {
      exec: async () => ({
        statusCode: 200,
        data: {
          busyExecutors: 3,
          totalExecutors: 10,
          computer: [
            {
              displayName: "master",
              offline: false,
              numExecutors: 2,
              idle: true,
            },
            {
              displayName: "agent-1",
              offline: false,
              numExecutors: 4,
              idle: false,
            },
            {
              displayName: "agent-2",
              offline: true,
              numExecutors: 4,
              idle: true,
            },
          ],
        },
      }),
    };

    const result = await collector.execute({
      config: {},
      client: mockClient,
      pluginId: "healthcheck-jenkins",
    });

    expect(result.result.totalNodes).toBe(3);
    expect(result.result.onlineNodes).toBe(2);
    expect(result.result.offlineNodes).toBe(1);
    expect(result.result.busyExecutors).toBe(3);
    expect(result.result.totalExecutors).toBe(10);
    expect(result.result.executorUtilization).toBe(30);
    // Error for offline nodes
    expect(result.error).toContain("1 of 3 nodes offline");
  });

  it("should collect single node info", async () => {
    let capturedPath = "";
    const mockClient: JenkinsTransportClient = {
      exec: async (req: JenkinsRequest) => {
        capturedPath = req.path;
        return {
          statusCode: 200,
          data: {
            displayName: "agent-1",
            offline: false,
            numExecutors: 4,
            idle: false,
          },
        };
      },
    };

    const result = await collector.execute({
      config: { nodeName: "agent-1" },
      client: mockClient,
      pluginId: "healthcheck-jenkins",
    });

    expect(capturedPath).toContain("/computer/agent-1/api/json");
    expect(result.result.totalNodes).toBe(1);
    expect(result.result.onlineNodes).toBe(1);
    expect(result.result.nodeDisplayName).toBe("agent-1");
    expect(result.error).toBeUndefined();
  });

  it("should report error for offline single node", async () => {
    const mockClient: JenkinsTransportClient = {
      exec: async () => ({
        statusCode: 200,
        data: {
          displayName: "agent-1",
          offline: true,
          offlineCauseReason: "Connection lost",
          numExecutors: 4,
        },
      }),
    };

    const result = await collector.execute({
      config: { nodeName: "agent-1" },
      client: mockClient,
      pluginId: "healthcheck-jenkins",
    });

    expect(result.result.offlineNodes).toBe(1);
    expect(result.result.nodeOffline).toBe(true);
    expect(result.error).toContain("Connection lost");
  });

  it("should aggregate correctly", () => {
    const runs: Parameters<typeof collector.mergeResult>[1][] = [
      {
        status: "healthy" as const,
        latencyMs: 100,
        metadata: {
          totalNodes: 6,
          onlineNodes: 5,
          offlineNodes: 1,
          busyExecutors: 10,
          idleExecutors: 10,
          totalExecutors: 20,
          executorUtilization: 50,
        },
      },
      {
        status: "healthy" as const,
        latencyMs: 100,
        metadata: {
          totalNodes: 5,
          onlineNodes: 3,
          offlineNodes: 2,
          busyExecutors: 14,
          idleExecutors: 6,
          totalExecutors: 20,
          executorUtilization: 70,
        },
      },
    ];

    let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

    expect(aggregated.avgOnlineNodes.avg).toBe(4);
    expect(aggregated.avgUtilization.avg).toBe(60);
    expect(aggregated.minOnlineNodes.min).toBe(3);
  });
});
