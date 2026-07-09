import { describe, expect, it, mock } from "bun:test";
import { renderTemplatableConfig } from "@checkstack/backend-api";
import { QueryCollector, type QueryConfig } from "./query-collector";
import type { MysqlTransportClient } from "./transport-client";

describe("QueryCollector", () => {
  const createMockClient = (
    response: {
      rowCount?: number;
      error?: string;
    } = {},
  ): MysqlTransportClient => ({
    exec: mock(() =>
      Promise.resolve({
        rowCount: response.rowCount ?? 1,
        error: response.error,
      }),
    ),
  });

  describe("execute", () => {
    it("should execute query successfully", async () => {
      const collector = new QueryCollector();
      const client = createMockClient({ rowCount: 5 });

      const result = await collector.execute({
        config: { query: "SELECT * FROM users" },
        client,
        pluginId: "test",
      });

      expect(result.result.rowCount).toBe(5);
      expect(result.result.success).toBe(true);
      expect(result.result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it("should return error for failed query", async () => {
      const collector = new QueryCollector();
      const client = createMockClient({ error: "Table not found" });

      const result = await collector.execute({
        config: { query: "SELECT * FROM nonexistent" },
        client,
        pluginId: "test",
      });

      expect(result.result.success).toBe(false);
      expect(result.error).toBe("Table not found");
    });

    it("should pass query to client", async () => {
      const collector = new QueryCollector();
      const client = createMockClient();

      await collector.execute({
        config: { query: "SELECT COUNT(*) FROM orders" },
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith({
        query: "SELECT COUNT(*) FROM orders",
      });
    });
  });

  describe("environment templating", () => {
    // `query` is `x-templatable`, so the executor renders `{{ environment.* }}`
    // into it PER environment before execute. These tests exercise that render
    // pass and the post-render empty-query guard together.
    const renderQuery = (query: string, environment: Record<string, unknown>) => {
      const collector = new QueryCollector();
      const rendered = renderTemplatableConfig({
        config: { query },
        schema: collector.config.schema,
        context: { environment, check: {}, system: {} },
      });
      return (rendered as { query: string }).query;
    };

    it("renders a {{ environment.query }} template against the env fields", () => {
      expect(
        renderQuery("{{ environment.query }}", {
          query: "SELECT COUNT(*) FROM prod_users",
        }),
      ).toBe("SELECT COUNT(*) FROM prod_users");
    });

    it("runs the rendered query against the client", async () => {
      const collector = new QueryCollector();
      const client = createMockClient({ rowCount: 3 });
      const query = renderQuery("{{ environment.query }}", {
        query: "SELECT 1",
      });

      const result = await collector.execute({
        config: { query },
        client,
        pluginId: "test",
      });

      expect(result.error).toBeUndefined();
      expect(client.exec).toHaveBeenCalledWith({ query: "SELECT 1" });
    });

    it("returns a transport failure when the query renders empty (no env)", async () => {
      const collector = new QueryCollector();
      const client = createMockClient();
      // An env-less run resolves `{{ environment.query }}` to "" (strict:false).
      const query = renderQuery("{{ environment.query }}", {});
      expect(query).toBe("");

      const result = await collector.execute({
        config: { query },
        client,
        pluginId: "test",
      });

      expect(result.error).toContain("Rendered query is empty");
      expect(result.result.success).toBe(false);
      // A config error must not run the query.
      expect(client.exec).not.toHaveBeenCalled();
    });

    it("returns a transport failure for a whitespace-only rendered query", async () => {
      const collector = new QueryCollector();
      const client = createMockClient();

      const result = await collector.execute({
        config: { query: "   " },
        client,
        pluginId: "test",
      });

      expect(result.error).toContain("Rendered query is empty");
      expect(client.exec).not.toHaveBeenCalled();
    });
  });

  describe("mergeResult", () => {
    it("should calculate average execution time and success rate", () => {
      const collector = new QueryCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { rowCount: 1, executionTimeMs: 50, success: true },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 15,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { rowCount: 5, executionTimeMs: 100, success: true },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgExecutionTimeMs.avg).toBe(75);
      expect(aggregated.successRate.rate).toBe(100);
    });

    it("should calculate success rate correctly", () => {
      const collector = new QueryCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { rowCount: 1, executionTimeMs: 50, success: true },
        },
        {
          id: "2",
          status: "unhealthy" as const,
          latencyMs: 15,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { rowCount: 0, executionTimeMs: 100, success: false },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.successRate.rate).toBe(50);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new QueryCollector();

      expect(collector.id).toBe("query");
      expect(collector.displayName).toBe("SQL Query");
      expect(collector.allowMultiple).toBe(true);
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});
