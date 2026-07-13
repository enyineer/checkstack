/**
 * REAL two-process satellite -> core telemetry end-to-end test.
 *
 * Proves the satellite telemetry protocol works over the ACTUAL wire between a
 * real satellite AGENT process and a real CORE backend process - nothing
 * stubbed. The path exercised is exactly the production one:
 *
 *   shipper --HTTP--> satellite agent's local native-log receiver (/ingest)
 *          --ws://--> core (real csat_ auth handshake, telemetry_batch envelope)
 *          --------->  core's logstream capability handler (verifies the ckls_
 *                      stream token, re-clamps + ingests through the shared
 *                      pipeline) --> lands in the core DB (log_events).
 *
 * The assertion is a DB read against the core's own database: the posted line
 * must appear in `plugin_logstream.log_events` for the seeded stream.
 *
 * GUARD: skipped unless CHECKSTACK_SATELLITE_E2E=1, so the default `bun test`
 * suite never spawns processes or touches a database. It is ALSO excluded from
 * `bun run test` twice over (scripts/run-tests.ts drops `core/e2e/**` and every
 * `*.it.test.*`). Run it explicitly:
 *
 *   CHECKSTACK_SATELLITE_E2E=1 bun --env-file=.env test core/e2e/satellite-telemetry.e2e.it.test.ts
 *
 * Prerequisites: the dev Postgres from `docker-compose-dev.yml` reachable via
 * the `.env` DATABASE_URL (the isolated `checkstack_satellite_e2e` database is
 * dropped + recreated here and migrated by the booted backend). Redis is not
 * required - a single isolated instance falls back to in-memory providers.
 */

import { describe, it, expect } from "bun:test";
import { SQL } from "bun";
import net from "node:net";
import path from "node:path";
import { z } from "zod";
import { createSourceTokenKit } from "@checkstack/ingest-utils";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  TOKEN_PREFIX,
  TOKEN_DISPLAY_PREFIX_LENGTH,
} from "@checkstack/logstream-common";

const ENABLED = process.env.CHECKSTACK_SATELLITE_E2E === "1";
const REPO_ROOT = path.resolve(import.meta.dir, "..", "..");
const E2E_DB_NAME =
  process.env.CHECKSTACK_SATELLITE_E2E_DB ?? "checkstack_satellite_e2e";

// Generous ceilings: the booted backend runs every plugin's migrations at
// startup, and the agent dynamically loads its health-check strategies before
// connecting. Both are cold-start costs paid once.
const BACKEND_READY_TIMEOUT_MS = 120_000;
const AGENT_READY_TIMEOUT_MS = 60_000;
const LANDED_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 240_000;

// ---------------------------------------------------------------------------
// Small process/IO helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Grab an ephemeral free TCP port by binding :0 and reading the assignment. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() =>
          reject(new Error("could not determine a free port")),
        );
      }
    });
  });
}

/**
 * Wraps a spawned child, streaming its stdout+stderr into one growing log
 * buffer (echoed with a label for the run output) and letting callers await a
 * marker line via `waitFor`.
 */
class ChildProcess {
  private log = "";
  private readonly waiters: Array<{ re: RegExp; resolve: () => void }> = [];
  readonly proc: Bun.Subprocess<"ignore", "pipe", "pipe">;

  constructor(
    private readonly label: string,
    proc: Bun.Subprocess<"ignore", "pipe", "pipe">,
  ) {
    this.proc = proc;
    void this.pump(proc.stdout);
    void this.pump(proc.stderr);
  }

  private async pump(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        this.log += text;
        for (const line of text.split("\n")) {
          if (line.trim().length > 0) console.log(`[${this.label}] ${line}`);
        }
        for (let i = this.waiters.length - 1; i >= 0; i -= 1) {
          const waiter = this.waiters[i];
          if (waiter.re.test(this.log)) {
            this.waiters.splice(i, 1);
            waiter.resolve();
          }
        }
      }
    } catch {
      // Stream closed (process killed on teardown); nothing to do.
    }
  }

  waitFor(re: RegExp, timeoutMs: number): Promise<void> {
    if (re.test(this.log)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((w) => w.resolve === wrapped);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(
          new Error(
            `${this.label}: timed out after ${timeoutMs}ms waiting for ${re}\n` +
              `--- ${this.label} log tail ---\n${this.log.slice(-2000)}`,
          ),
        );
      }, timeoutMs);
      const wrapped = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.waiters.push({ re, resolve: wrapped });
    });
  }

  async kill(): Promise<void> {
    this.proc.kill();
    try {
      await this.proc.exited;
    } catch {
      // Already gone.
    }
  }
}

/** Poll an HTTP URL until it answers 200, or throw once the deadline passes. */
async function waitForHttp200(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "no attempt";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
      last = `status ${res.status}`;
    } catch (error) {
      last = String(error);
    }
    await sleep(500);
  }
  throw new Error(
    `${url} did not become ready within ${timeoutMs}ms (last: ${last})`,
  );
}

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

describe.skipIf(!ENABLED)("satellite <-> core telemetry (real two-process)", () => {
  it(
    "forwards a native log posted to the agent all the way into core's logstream storage",
    async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error(
          "DATABASE_URL is not set - run with `bun --env-file=.env test ...`",
        );
      }

      // Derive the isolated e2e database + a maintenance connection for DDL.
      const e2eUrl = new URL(databaseUrl);
      e2eUrl.pathname = `/${E2E_DB_NAME}`;
      const adminUrl = new URL(databaseUrl);
      adminUrl.pathname = "/postgres";

      let backend: ChildProcess | undefined;
      let agent: ChildProcess | undefined;
      let seedSql: SQL | undefined;

      // Reset the e2e database up front (DROP + CREATE on the maintenance db).
      const adminReset = new SQL(adminUrl.toString(), { max: 1 });
      try {
        await adminReset.unsafe(
          `DROP DATABASE IF EXISTS "${E2E_DB_NAME}" WITH (FORCE)`,
        );
        await adminReset.unsafe(`CREATE DATABASE "${E2E_DB_NAME}"`);
      } finally {
        await adminReset.end();
      }

      try {
        const corePort = await getFreePort();
        const receiverPort = await getFreePort();
        const coreBaseUrl = `http://127.0.0.1:${corePort}`;

        // --- 1. Boot the REAL core backend as its own process ----------------
        // It runs every plugin's migrations against the fresh e2e database at
        // startup (that is what creates the plugin_* schemas we seed into).
        backend = new ChildProcess(
          "core",
          Bun.spawn({
            cmd: ["bun", path.join("core", "backend", "src", "index.ts")],
            cwd: REPO_ROOT,
            stdout: "pipe",
            stderr: "pipe",
            env: {
              ...process.env,
              DATABASE_URL: e2eUrl.toString(),
              PORT: String(corePort),
              BASE_URL: coreBaseUrl,
              INTERNAL_URL: coreBaseUrl,
              CHECKSTACK_FRONTEND_DIST: path.join(
                REPO_ROOT,
                "core",
                "frontend",
                "dist",
              ),
            },
          }),
        );

        await waitForHttp200(
          `${coreBaseUrl}/.checkstack/ready`,
          BACKEND_READY_TIMEOUT_MS,
        );

        // --- 2. Seed the satellite (csat_) and the log stream (ckls_) ---------
        // Directly into the schemas the booted backend just migrated. The
        // satellite token uses the SAME bcrypt shape the real createSatellite
        // does, so core's validateToken verifies it on the real auth path; the
        // ckls_ stream token is minted with the real source-token kit.
        seedSql = new SQL(e2eUrl.toString(), { max: 2 });

        const satelliteRandom = crypto.getRandomValues(new Uint8Array(32));
        const csatToken = `csat_${Buffer.from(satelliteRandom).toString("base64url")}`;
        const csatHash = await Bun.password.hash(csatToken, {
          algorithm: "bcrypt",
          cost: 10,
        });
        const insertedSatellite = z
          .array(z.object({ id: z.string() }))
          .parse(
            await seedSql`
              INSERT INTO plugin_satellite.satellites (name, region, tags, token_hash)
              VALUES (${"sat-e2e"}, ${"e2e"}, ${"{}"}::jsonb, ${csatHash})
              RETURNING id
            `,
          );
        const satelliteId = insertedSatellite[0]?.id;
        if (!satelliteId) throw new Error("failed to seed satellite row");

        const streamId = `sat-e2e-stream-${crypto.randomUUID()}`;
        await seedSql`
          INSERT INTO plugin_logstream.log_streams (id, name, config)
          VALUES (${streamId}, ${"Satellite E2E"}, ${JSON.stringify(DEFAULT_LOG_STREAM_CONFIG)}::jsonb)
        `;

        const tokenKit = createSourceTokenKit({
          prefix: TOKEN_PREFIX,
          displayPrefixLength: TOKEN_DISPLAY_PREFIX_LENGTH,
        });
        const streamToken = tokenKit.generateToken({ resourceId: streamId });
        await seedSql`
          INSERT INTO plugin_logstream.log_stream_tokens
            (id, stream_id, name, token_hash, token_prefix)
          VALUES (
            ${`sat-e2e-token-${crypto.randomUUID()}`},
            ${streamId},
            ${"sat-e2e shipper"},
            ${streamToken.tokenHash},
            ${streamToken.tokenPrefix}
          )
        `;

        // --- 3. Spawn the REAL satellite agent process -----------------------
        agent = new ChildProcess(
          "agent",
          Bun.spawn({
            cmd: ["bun", path.join("core", "satellite", "src", "index.ts")],
            cwd: REPO_ROOT,
            stdout: "pipe",
            stderr: "pipe",
            env: {
              ...process.env,
              CHECKSTACK_CORE_URL: coreBaseUrl,
              CHECKSTACK_SATELLITE_CLIENT_ID: satelliteId,
              CHECKSTACK_SATELLITE_TOKEN: csatToken,
              CHECKSTACK_SATELLITE_TELEMETRY: "1",
              CHECKSTACK_SATELLITE_LOG_RECEIVERS: "1",
              CHECKSTACK_SATELLITE_RECEIVER_PORT: String(receiverPort),
              CHECKSTACK_SATELLITE_RECEIVER_HOST: "127.0.0.1",
            },
          }),
        );

        // Wait until the agent (a) authenticated over the real WS handshake and
        // (b) opened its local receiver port.
        await agent.waitFor(/Authenticated as /, AGENT_READY_TIMEOUT_MS);
        await agent.waitFor(
          /telemetry HTTP receiver on/,
          AGENT_READY_TIMEOUT_MS,
        );
        // Confirm the receiver actually accepts a connection before posting.
        await waitForHttp200Or4xx(
          `http://127.0.0.1:${receiverPort}/ingest`,
          AGENT_READY_TIMEOUT_MS,
        );

        // --- 4. POST one native log to the agent's receiver ------------------
        const marker = `sat-e2e-marker-${crypto.randomUUID()}`;
        const post = await fetch(`http://127.0.0.1:${receiverPort}/ingest`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${streamToken.secret}`,
            "content-type": "application/x-ndjson",
          },
          body: JSON.stringify({ level: "error", message: marker }),
        });
        expect(post.status).toBe(202);

        // --- 5. Poll core's DB until the line lands --------------------------
        const rowCountSchema = z.array(z.object({ n: z.number() }));
        let landed = 0;
        const deadline = Date.now() + LANDED_TIMEOUT_MS;
        while (Date.now() < deadline) {
          const rows = rowCountSchema.parse(
            await seedSql`
              SELECT count(*)::int AS n
              FROM plugin_logstream.log_events
              WHERE stream_id = ${streamId} AND body = ${marker}
            `,
          );
          landed = rows[0]?.n ?? 0;
          if (landed > 0) break;
          await sleep(500);
        }

        // --- 6. Assert it landed via the real end-to-end wire ----------------
        expect(landed).toBeGreaterThan(0);
      } finally {
        await agent?.kill();
        await backend?.kill();
        await seedSql?.end();

        // Drop the ephemeral e2e database (backend connections are gone now).
        const adminDrop = new SQL(adminUrl.toString(), { max: 1 });
        try {
          await adminDrop.unsafe(
            `DROP DATABASE IF EXISTS "${E2E_DB_NAME}" WITH (FORCE)`,
          );
        } finally {
          await adminDrop.end();
        }
      }
    },
    TEST_TIMEOUT_MS,
  );
});

/**
 * Poll a URL until it answers ANY HTTP status (200 or a 4xx like the receiver's
 * 401/405 for a bare GET) - proving the socket is accepting connections - or
 * throw once the deadline passes.
 */
async function waitForHttp200Or4xx(
  url: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "no attempt";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      // Any HTTP response means the listener is up and routing.
      if (res.status > 0) return;
    } catch (error) {
      last = String(error);
    }
    await sleep(300);
  }
  throw new Error(
    `${url} did not accept connections within ${timeoutMs}ms (last: ${last})`,
  );
}
