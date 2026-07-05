import { describe, expect, it } from "bun:test";
import {
  resolveEndpoint,
  computeCpuPercent,
  distillStats,
  createRuntimeApi,
  type ContainerFetch,
} from "./runtime-api";

describe("resolveEndpoint", () => {
  it("treats an http(s) URL as a base URL with no unix socket", () => {
    expect(resolveEndpoint("http://socket-proxy:2375")).toEqual({
      baseUrl: "http://socket-proxy:2375",
    });
    expect(resolveEndpoint("https://proxy:2376/")).toEqual({
      baseUrl: "https://proxy:2376",
    });
  });

  it("treats a unix:// URL as a socket path with a placeholder host", () => {
    expect(resolveEndpoint("unix:///run/user/1000/podman/podman.sock")).toEqual(
      {
        baseUrl: "http://localhost",
        unixSocketPath: "/run/user/1000/podman/podman.sock",
      },
    );
  });

  it("treats a bare filesystem path as a socket path", () => {
    expect(resolveEndpoint("/var/run/docker.sock")).toEqual({
      baseUrl: "http://localhost",
      unixSocketPath: "/var/run/docker.sock",
    });
  });
});

describe("computeCpuPercent", () => {
  it("applies the Docker CPU formula across online CPUs", () => {
    const pct = computeCpuPercent({
      cpu_stats: {
        cpu_usage: { total_usage: 200 },
        system_cpu_usage: 2000,
        online_cpus: 4,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 1000,
      },
    });
    // (100/1000) * 4 * 100 = 40
    expect(pct).toBe(40);
  });

  it("returns undefined when deltas are unmeasurable", () => {
    expect(computeCpuPercent({})).toBeUndefined();
    expect(
      computeCpuPercent({
        cpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
        precpu_stats: {
          cpu_usage: { total_usage: 100 },
          system_cpu_usage: 1000,
        },
      }),
    ).toBeUndefined();
  });
});

describe("distillStats", () => {
  it("subtracts cache from usage and derives memory percent", () => {
    const result = distillStats({
      memory_stats: {
        usage: 300,
        limit: 1000,
        stats: { cache: 100 },
      },
    });
    expect(result.memoryUsageBytes).toBe(200);
    expect(result.memoryLimitBytes).toBe(1000);
    expect(result.memoryPercent).toBe(20);
  });
});

/** Build a mock fetch returning a fixed status + JSON body per path. */
function mockFetch(
  routes: Record<string, { status: number; body?: unknown }>,
): ContainerFetch {
  return (url) => {
    const path = url.replace("http://localhost", "").replace(
      "http://socket-proxy:2375",
      "",
    );
    const match = Object.keys(routes).find((r) => path.startsWith(r));
    if (!match) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    const route = routes[match];
    return Promise.resolve(
      new Response(route.body === undefined ? "" : JSON.stringify(route.body), {
        status: route.status,
      }),
    );
  };
}

describe("createRuntimeApi.ping", () => {
  it("resolves when the endpoint answers /_ping", async () => {
    const api = createRuntimeApi({
      endpoint: "http://socket-proxy:2375",
      container: "web",
      timeoutMs: 1000,
      fetchImpl: mockFetch({ "/_ping": { status: 200 } }),
    });
    await expect(api.ping()).resolves.toBeUndefined();
  });

  it("throws (transport failure) on a non-ok ping, e.g. a denied proxy", async () => {
    const api = createRuntimeApi({
      endpoint: "http://socket-proxy:2375",
      container: "web",
      timeoutMs: 1000,
      fetchImpl: mockFetch({ "/_ping": { status: 403 } }),
    });
    await expect(api.ping()).rejects.toThrow();
  });

  it("throws when fetch itself rejects (connection refused)", async () => {
    const api = createRuntimeApi({
      endpoint: "http://socket-proxy:2375",
      container: "web",
      timeoutMs: 1000,
      fetchImpl: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    await expect(api.ping()).rejects.toThrow("ECONNREFUSED");
  });
});

describe("createRuntimeApi.inspect", () => {
  it("maps a running container's inspect into assertable metrics", async () => {
    const api = createRuntimeApi({
      endpoint: "http://socket-proxy:2375",
      container: "web",
      timeoutMs: 1000,
      fetchImpl: mockFetch({
        "/containers/web/json": {
          status: 200,
          body: {
            State: {
              Status: "running",
              Running: true,
              ExitCode: 0,
              OOMKilled: false,
              Health: { Status: "healthy" },
            },
            RestartCount: 2,
          },
        },
      }),
    });
    expect(await api.inspect()).toEqual({
      exists: true,
      state: "running",
      running: true,
      health: "healthy",
      exitCode: 0,
      restartCount: 2,
      oomKilled: false,
    });
  });

  it("returns exists:false for a 404 (missing container is NOT a transport failure)", async () => {
    const api = createRuntimeApi({
      endpoint: "http://socket-proxy:2375",
      container: "gone",
      timeoutMs: 1000,
      fetchImpl: mockFetch({ "/containers/gone/json": { status: 404 } }),
    });
    expect(await api.inspect()).toEqual({ exists: false });
  });

  it("throws on a non-404 error status (e.g. proxy denies the endpoint)", async () => {
    const api = createRuntimeApi({
      endpoint: "http://socket-proxy:2375",
      container: "web",
      timeoutMs: 1000,
      fetchImpl: mockFetch({ "/containers/web/json": { status: 403 } }),
    });
    await expect(api.inspect()).rejects.toThrow();
  });
});

describe("createRuntimeApi.stats", () => {
  it("returns empty stats for a 404 without throwing", async () => {
    const api = createRuntimeApi({
      endpoint: "http://socket-proxy:2375",
      container: "gone",
      timeoutMs: 1000,
      fetchImpl: mockFetch({ "/containers/gone/stats": { status: 404 } }),
    });
    expect(await api.stats()).toEqual({});
  });

  it("distils cpu and memory from a stats snapshot", async () => {
    const api = createRuntimeApi({
      endpoint: "http://socket-proxy:2375",
      container: "web",
      timeoutMs: 1000,
      fetchImpl: mockFetch({
        "/containers/web/stats": {
          status: 200,
          body: {
            cpu_stats: {
              cpu_usage: { total_usage: 200 },
              system_cpu_usage: 2000,
              online_cpus: 2,
            },
            precpu_stats: {
              cpu_usage: { total_usage: 100 },
              system_cpu_usage: 1000,
            },
            memory_stats: { usage: 500, limit: 1000, stats: { cache: 100 } },
          },
        },
      }),
    });
    const stats = await api.stats();
    expect(stats.cpuPercent).toBe(20); // (100/1000)*2*100
    expect(stats.memoryUsageBytes).toBe(400);
    expect(stats.memoryPercent).toBe(40);
  });
});
