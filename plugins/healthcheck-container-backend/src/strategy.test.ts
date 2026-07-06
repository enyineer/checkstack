import { describe, expect, it } from "bun:test";
import { ContainerHealthCheckStrategy } from "./strategy";
import type { ContainerFetch } from "./runtime-api";

function fetchStub(
  routes: Record<string, { status: number; body?: unknown }>,
): ContainerFetch {
  return (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const match = Object.keys(routes).find((r) => path.startsWith(r));
    if (!match) {
      return Promise.resolve(new Response("", { status: 404 }));
    }
    const route = routes[match];
    return Promise.resolve(
      new Response(route.body === undefined ? "" : JSON.stringify(route.body), {
        status: route.status,
      }),
    );
  };
}

describe("ContainerHealthCheckStrategy", () => {
  it("exposes containerization category and setup instructions", () => {
    const strategy = new ContainerHealthCheckStrategy();
    expect(strategy.id).toBe("container");
    expect(strategy.category).toBe("containerization");
    expect(strategy.setupInstructions).toContain("socket-proxy");
    expect(strategy.setupInstructions).toContain("read-only");
  });

  it("connects (pings) and execs inspect + stats through the client", async () => {
    const strategy = new ContainerHealthCheckStrategy(
      fetchStub({
        "/_ping": { status: 200 },
        "/containers/web/json": {
          status: 200,
          body: { State: { Status: "running", Running: true }, RestartCount: 0 },
        },
        "/containers/web/stats": {
          status: 200,
          body: { memory_stats: { usage: 100, limit: 1000, stats: {} } },
        },
      }),
    );

    const connected = await strategy.createClient({
      endpoint: "http://socket-proxy:2375",
      container: "web",
      timeout: 1000,
    });

    const inspect = await connected.client.exec({ type: "inspect" });
    expect(inspect).toMatchObject({ type: "inspect", running: true });

    const stats = await connected.client.exec({ type: "stats" });
    expect(stats).toMatchObject({ type: "stats", memoryPercent: 10 });

    expect(connected.timings?.connectMs).toBeGreaterThanOrEqual(0);
    connected.close();
  });

  it("throws (transport failure) when the runtime endpoint is unreachable", async () => {
    const strategy = new ContainerHealthCheckStrategy(
      fetchStub({ "/_ping": { status: 502 } }),
    );
    await expect(
      strategy.createClient({
        endpoint: "http://socket-proxy:2375",
        container: "web",
        timeout: 1000,
      }),
    ).rejects.toThrow();
  });
});
