import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import type { Server } from "bun";
import { ContainerHealthCheckStrategy } from "./strategy";
import {
  ContainerStatusCollector,
  ContainerStatsCollector,
} from "./collectors";

// ============================================================================
// INTEGRATION TEST - real HTTP + real unix socket, no Docker daemon needed
// ============================================================================
//
// Stands up an in-process HTTP/unix-socket server that answers the subset of
// the Docker Engine API the strategy uses, then drives the REAL strategy +
// collectors end to end over the REAL default fetch (no injected mock). This
// exercises the actual transport (endpoint resolution, HTTP, unix socket,
// JSON parsing, collector execution) that the unit tests bypass, while staying
// in the fast lane: it owns a loopback server, needs no external service, and
// runs unchanged in CI.

/** The subset of the Docker Engine / Podman libpod REST API we depend on. */
function dockerApiHandler(req: Request): Response {
  const { pathname } = new URL(req.url);

  if (pathname === "/_ping") {
    return new Response("OK");
  }

  // A running, healthy container with a HEALTHCHECK defined.
  if (pathname === "/containers/web/json") {
    return Response.json({
      State: {
        Status: "running",
        Running: true,
        ExitCode: 0,
        OOMKilled: false,
        Health: { Status: "healthy" },
      },
      RestartCount: 1,
    });
  }

  // A container that exited (OOM-killed, non-zero exit).
  if (pathname === "/containers/db/json") {
    return Response.json({
      State: {
        Status: "exited",
        Running: false,
        ExitCode: 137,
        OOMKilled: true,
      },
      RestartCount: 5,
    });
  }

  // A real stats snapshot (two CPU reads so the delta is measurable).
  if (pathname === "/containers/web/stats") {
    return Response.json({
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
    });
  }

  // Anything else: the runtime's "no such container" (a COMPLETED 404).
  return new Response("no such container", { status: 404 });
}

describe("container transport integration (real HTTP)", () => {
  let server: Server<undefined>;
  let endpoint: string;

  beforeAll(() => {
    server = Bun.serve({ port: 0, fetch: dockerApiHandler });
    endpoint = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  it("inspects a running container end to end (status collector)", async () => {
    const strategy = new ContainerHealthCheckStrategy();
    const connected = await strategy.createClient({
      endpoint,
      container: "web",
      timeout: 2000,
    });
    try {
      const { result, error } = await new ContainerStatusCollector().execute({
        config: {},
        client: connected.client,
        pluginId: "healthcheck-container",
      });
      expect(error).toBeUndefined();
      expect(result).toMatchObject({
        exists: true,
        running: true,
        state: "running",
        health: "healthy",
        restartCount: 1,
      });
      // The connect phase was really measured over the wire.
      expect(connected.timings?.connectMs).toBeGreaterThanOrEqual(0);
    } finally {
      connected.close();
    }
  });

  it("computes cpu/memory over the wire (stats collector)", async () => {
    const strategy = new ContainerHealthCheckStrategy();
    const connected = await strategy.createClient({
      endpoint,
      container: "web",
      timeout: 2000,
    });
    try {
      const { result, error } = await new ContainerStatsCollector().execute({
        config: {},
        client: connected.client,
        pluginId: "healthcheck-container",
      });
      expect(error).toBeUndefined();
      expect(result.cpuPercent).toBe(20); // (100/1000) * 2 * 100
      expect(result.memoryUsageBytes).toBe(400); // 500 - 100 cache
      expect(result.memoryPercent).toBe(40);
    } finally {
      connected.close();
    }
  });

  it("reports an exited container as metrics, not a failure", async () => {
    const strategy = new ContainerHealthCheckStrategy();
    const connected = await strategy.createClient({
      endpoint,
      container: "db",
      timeout: 2000,
    });
    try {
      const { result, error } = await new ContainerStatusCollector().execute({
        config: {},
        client: connected.client,
        pluginId: "healthcheck-container",
      });
      expect(error).toBeUndefined();
      expect(result).toMatchObject({
        exists: true,
        running: false,
        state: "exited",
        exitCode: 137,
        oomKilled: true,
      });
    } finally {
      connected.close();
    }
  });

  it("reports a missing container as exists:false without throwing (real 404)", async () => {
    const strategy = new ContainerHealthCheckStrategy();
    const connected = await strategy.createClient({
      endpoint,
      container: "does-not-exist",
      timeout: 2000,
    });
    try {
      const { result, error } = await new ContainerStatusCollector().execute({
        config: {},
        client: connected.client,
        pluginId: "healthcheck-container",
      });
      expect(error).toBeUndefined();
      expect(result.exists).toBe(false);
      expect(result.running).toBeUndefined();
    } finally {
      connected.close();
    }
  });

  it("throws on an unreachable endpoint (connection refused)", async () => {
    const strategy = new ContainerHealthCheckStrategy();
    // Port 1 is not listening: a real connect failure -> transport failure.
    await expect(
      strategy.createClient({
        endpoint: "http://localhost:1",
        container: "web",
        timeout: 500,
      }),
    ).rejects.toThrow();
  });
});

describe("container transport integration (real unix socket)", () => {
  let server: Server<undefined>;
  let socketPath: string;

  beforeAll(() => {
    // Short filename keeps the path under the ~104-char sun_path limit.
    socketPath = join(tmpdir(), `csc-${process.pid}.sock`);
    rmSync(socketPath, { force: true });
    server = Bun.serve({ unix: socketPath, fetch: dockerApiHandler });
  });

  afterAll(() => {
    server.stop(true);
    rmSync(socketPath, { force: true });
  });

  it("talks to the runtime over a unix socket (the mounted-proxy / rootless-podman path)", async () => {
    const strategy = new ContainerHealthCheckStrategy();
    const connected = await strategy.createClient({
      endpoint: `unix://${socketPath}`,
      container: "web",
      timeout: 2000,
    });
    try {
      const { result, error } = await new ContainerStatusCollector().execute({
        config: {},
        client: connected.client,
        pluginId: "healthcheck-container",
      });
      expect(error).toBeUndefined();
      expect(result).toMatchObject({ exists: true, running: true });
    } finally {
      connected.close();
    }
  });
});
