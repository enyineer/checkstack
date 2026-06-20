/**
 * Ephemeral-Postgres wrapper for the E2E suite (boot-once model).
 *
 * Spins up a throwaway `postgres:16-alpine` via Testcontainers, injects its
 * connection string as `DATABASE_URL`, and runs Playwright ONCE: the webServer
 * (`start-e2e-server.ts`) boots the backend + resets the dedicated
 * `checkstack_e2e` DB a single time, then all data-isolated specs run in
 * parallel against it. So `bun run test:e2e` is fully self-contained everywhere
 * - the only prerequisite is a reachable Docker daemon.
 *
 * CI shards with Playwright's native `--shard=i/N` (passed through as args); each
 * shard is its own runner with its own ephemeral Postgres and a single boot.
 *
 * Why this works without touching the rest of the harness: Bun's `--env-file`
 * does NOT override variables already present in the environment, so the
 * `DATABASE_URL` set here survives down through `playwright test` -> the
 * `webServer` command (`start-e2e-server.ts`), which still loads `.env` for the
 * OTHER secrets (BETTER_AUTH_SECRET, etc.) but keeps this container's
 * `DATABASE_URL`.
 *
 * Run via: `bun --env-file=../../.env scripts/with-e2e-postgres.ts [playwright args]`
 * e.g. `... with-e2e-postgres.ts --shard=1/3` or `... with-e2e-postgres.ts catalog`.
 */
import path from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

// Disable the Testcontainers Ryuk reaper. Ryuk keeps a persistent TCP socket
// open to its sidecar container for the whole process lifetime and relies on
// `socket.unref()` so it does not keep the event loop alive. The Bun runtime
// does NOT honor that `unref`, so after the suite finishes and the container is
// stopped, that one socket keeps this process alive forever - which is the
// teardown "stuck at stopping ephemeral Postgres..." hang (in CI the step pipes
// us through `tee`, which only ends when our stdout closes). We do not need the
// reaper: the `finally` below deterministically stops + removes the container on
// every exit path, and CI runners are ephemeral, so there is nothing to reap.
// Must be set before the first `.start()` (Testcontainers reads it lazily then).
process.env.TESTCONTAINERS_RYUK_DISABLED = "true";

// Mirror the credentials the repo has always used so the connection string
// shape is identical to the previous compose / service-container setup.
const POSTGRES_IMAGE = "postgres:16-alpine";
const POSTGRES_USER = "checkstack";
const POSTGRES_PASSWORD = "checkstack";
const POSTGRES_DB = "checkstack";

const e2eDir = path.resolve(import.meta.dir, "..");

console.log(`[e2e] starting ephemeral ${POSTGRES_IMAGE} via Testcontainers...`);

const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
  .withUsername(POSTGRES_USER)
  .withPassword(POSTGRES_PASSWORD)
  .withDatabase(POSTGRES_DB)
  .start();

// `getConnectionUri()` points at the maintenance database; `start-e2e-server.ts`
// derives the dedicated `checkstack_e2e` and `/postgres` URLs from it.
const databaseUrl = container.getConnectionUri();
console.log(`[e2e] Postgres ready at ${container.getHost()}:${container.getPort()}`);

try {
  // Run Playwright ONCE - the backend boots a single time and the data-isolated
  // specs run in parallel. Extra args (e.g. `--shard=1/3`, a spec filter) are
  // forwarded verbatim.
  const child = Bun.spawn({
    cmd: ["bunx", "playwright", "test", ...process.argv.slice(2)],
    cwd: e2eDir,
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  process.exitCode = (await child.exited) ?? 0;
} finally {
  console.log("[e2e] stopping ephemeral Postgres...");
  // Force an immediate kill (0s grace) instead of a graceful stop. By teardown
  // the ephemeral Postgres still holds the e2e backend's connections: that
  // backend is SIGKILLed by Playwright at webServer teardown, so Postgres only
  // reaps the now-dead sockets much later. A graceful `docker stop` (SIGTERM ->
  // Postgres "smart" shutdown) would block waiting for those connections to
  // drain until the grace period elapses - which stalls teardown, especially on
  // Docker Desktop. The container is throwaway, so there is nothing to flush:
  // kill it outright. `stop()` removes the container by default, so nothing is
  // leaked even with Ryuk disabled.
  await container.stop({ timeout: 0 });
  console.log("[e2e] teardown complete.");
}
