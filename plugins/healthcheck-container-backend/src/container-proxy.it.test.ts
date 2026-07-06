import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ContainerHealthCheckStrategy } from "./strategy";
import {
  ContainerStatusCollector,
  ContainerStatsCollector,
} from "./collectors";

// ============================================================================
// REAL SOCKET-PROXY CONSTELLATION - env-gated integration test
// ============================================================================
//
// This stands up the ACTUAL deployment the feature documents:
//
//   [ real docker daemon ] --(:ro socket)--> [ lscr.io/linuxserver/socket-proxy
//                                              CONTAINERS=1 INFO=1 POST=0 ]
//                                                    ^ published on localhost
//                            our REAL strategy/collectors  ---> the proxy
//
// and asserts BOTH halves of the security posture that the fast Bun.serve
// integration test cannot: (1) our strategy reads a real container's state and
// stats THROUGH the proxy, and (2) the proxy's read-only `POST=0` actually
// blocks a write (kill), so a compromised instance cannot control the host.
//
// Gated behind CHECKSTACK_IT (the real-services lane) AND a live docker daemon,
// so the fast `bun test` lane never runs it (the runner also excludes
// `*.it.test.ts`). In CI it runs in the `integration` job, which is on
// `ubuntu-latest` with a real docker daemon available.

const PID = process.pid;
const TARGET = `cs-proxy-it-target-${PID}`;
const PROXY = `cs-proxy-it-proxy-${PID}`;
const PROXY_IMAGE = "lscr.io/linuxserver/socket-proxy:latest";
const TARGET_IMAGE = "alpine:3.20";

interface DockerResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function docker(args: string[], timeoutMs = 60_000): DockerResult {
  const res = Bun.spawnSync(["docker", ...args], { timeout: timeoutMs });
  return {
    ok: res.exitCode === 0,
    stdout: (res.stdout?.toString() ?? "").trim(),
    stderr: (res.stderr?.toString() ?? "").trim(),
  };
}

const dockerAvailable = docker(["info"], 15_000).ok;

/** Poll the proxy's /_ping until it answers or the deadline passes. */
async function waitForProxy(endpoint: string, deadlineMs: number): Promise<void> {
  const start = Date.now();
  let lastError = "never reached";
  while (Date.now() - start < deadlineMs) {
    try {
      const res = await fetch(`${endpoint}/_ping`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return;
      lastError = `status ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(500);
  }
  throw new Error(`socket-proxy did not become ready: ${lastError}`);
}

describe.skipIf(!process.env.CHECKSTACK_IT || !dockerAvailable)(
  "container health check against a real socket-proxy",
  () => {
    let endpoint = "";

    beforeAll(async () => {
      // Clean any leftovers from a previous interrupted run.
      docker(["rm", "-f", TARGET, PROXY]);

      // A long-lived target container to inspect.
      const target = docker([
        "run",
        "-d",
        "--name",
        TARGET,
        TARGET_IMAGE,
        "sleep",
        "600",
      ]);
      if (!target.ok) {
        throw new Error(`failed to start target container: ${target.stderr}`);
      }

      // The read-only socket-proxy in front of the host docker socket, exactly
      // as the docs prescribe: CONTAINERS=1 INFO=1 POST=0, socket mounted :ro.
      // Publish 2375 to a random localhost port so the test can reach it.
      const proxy = docker([
        "run",
        "-d",
        "--name",
        PROXY,
        "-p",
        "127.0.0.1::2375",
        "-e",
        "CONTAINERS=1",
        "-e",
        "INFO=1",
        "-e",
        "POST=0",
        "-v",
        "/var/run/docker.sock:/var/run/docker.sock:ro",
        PROXY_IMAGE,
      ]);
      if (!proxy.ok) {
        throw new Error(`failed to start socket-proxy: ${proxy.stderr}`);
      }

      const portLine = docker(["port", PROXY, "2375/tcp"]);
      if (!portLine.ok || !portLine.stdout) {
        throw new Error(`could not read proxy port: ${portLine.stderr}`);
      }
      // e.g. "127.0.0.1:49153"
      const hostPort = portLine.stdout.split("\n")[0].split(":").pop();
      endpoint = `http://127.0.0.1:${hostPort}`;

      await waitForProxy(endpoint, 60_000);
    }, 180_000);

    afterAll(() => {
      docker(["rm", "-f", TARGET, PROXY]);
    });

    it("reads a real container's status THROUGH the proxy", async () => {
      const connected = await new ContainerHealthCheckStrategy().createClient({
        endpoint,
        container: TARGET,
        timeout: 5000,
      });
      try {
        const { result, error } = await new ContainerStatusCollector().execute({
          config: {},
          client: connected.client,
          pluginId: "healthcheck-container",
        });
        expect(error).toBeUndefined();
        expect(result.exists).toBe(true);
        expect(result.running).toBe(true);
        expect(result.state).toBe("running");
      } finally {
        connected.close();
      }
    });

    it("reads real stats THROUGH the proxy", async () => {
      const connected = await new ContainerHealthCheckStrategy().createClient({
        endpoint,
        container: TARGET,
        timeout: 5000,
      });
      try {
        const { result, error } = await new ContainerStatsCollector().execute({
          config: {},
          client: connected.client,
          pluginId: "healthcheck-container",
        });
        expect(error).toBeUndefined();
        // A live container always has a memory limit; cpu may be ~0 when idle.
        expect(result.memoryLimitBytes).toBeGreaterThan(0);
        expect(
          result.cpuPercent === undefined || result.cpuPercent >= 0,
        ).toBe(true);
      } finally {
        connected.close();
      }
    });

    it("reports a missing container as exists:false through the proxy", async () => {
      const connected = await new ContainerHealthCheckStrategy().createClient({
        endpoint,
        container: `no-such-${PID}`,
        timeout: 5000,
      });
      try {
        const { result, error } = await new ContainerStatusCollector().execute({
          config: {},
          client: connected.client,
          pluginId: "healthcheck-container",
        });
        expect(error).toBeUndefined();
        expect(result.exists).toBe(false);
      } finally {
        connected.close();
      }
    });

    it("the read-only proxy (POST=0) BLOCKS a write, so we cannot control the host", async () => {
      // A kill is POST /containers/{id}/kill. The proxy must refuse it (403),
      // and the target must still be running afterwards.
      const res = await fetch(`${endpoint}/containers/${TARGET}/kill`, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(403);

      const connected = await new ContainerHealthCheckStrategy().createClient({
        endpoint,
        container: TARGET,
        timeout: 5000,
      });
      try {
        const { result } = await new ContainerStatusCollector().execute({
          config: {},
          client: connected.client,
          pluginId: "healthcheck-container",
        });
        expect(result.running).toBe(true); // the blocked kill did nothing
      } finally {
        connected.close();
      }
    });
  },
);
