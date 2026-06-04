/**
 * Runs the authenticated E2E suite with per-file isolation.
 *
 * Each spec file is executed in its OWN `playwright test` invocation. That
 * matters because the harness resets the dedicated e2e database once per backend
 * boot (i.e. once per invocation), not per file - so running every file in a
 * single invocation would let one area's data (e.g. catalog systems) leak into
 * another area's empty-state assertions (e.g. the dependency map's "no systems"
 * state). Isolating per file gives every spec a clean, migration-fresh database
 * and a freshly onboarded admin (the `setup` project runs each invocation).
 *
 * Connection hygiene: a full backend boot opens many Postgres connections, and a
 * Playwright-killed backend does NOT release them promptly (the process is
 * SIGKILLed, so Postgres only reaps the sockets much later). Booting ~20 backends
 * back-to-back would therefore accumulate connections and exhaust Postgres
 * (wedging it, and on Docker Desktop the whole VM). So between files we actively
 * DRAIN the e2e database's connections (terminate them server-side and wait for
 * zero) - capping concurrent usage at roughly a single backend's worth.
 *
 * Run with the repo env so DATABASE_URL is available for the drain step:
 *   bun --env-file=../../.env scripts/run-all.ts [pattern]
 *   pattern: optional substring filter on spec filenames (e.g. "catalog").
 * Exits non-zero if any file fails.
 */
import { SQL } from "bun";
import { readdirSync } from "node:fs";
import path from "node:path";

const E2E_DB_NAME = process.env.CHECKSTACK_E2E_DB_NAME ?? "checkstack_e2e";
const e2eDir = path.resolve(import.meta.dir, "..");
const testsDir = path.join(e2eDir, "tests");
const filter = process.argv[2];

function maintenanceUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      "DATABASE_URL is not set - run with `bun --env-file=../../.env scripts/run-all.ts`",
    );
  }
  const u = new URL(raw);
  u.pathname = "/postgres";
  return u.toString();
}

/** Kill anything bound to the e2e port and wait until it is actually free. */
function freePort(): void {
  Bun.spawnSync({
    cmd: ["sh", "-c", "lsof -ti:3100 | xargs kill -9 2>/dev/null; true"],
  });
  for (let i = 0; i < 40; i++) {
    const r = Bun.spawnSync({ cmd: ["sh", "-c", "lsof -ti:3100 >/dev/null 2>&1"] });
    if (r.exitCode !== 0) return; // nothing listening
    Bun.sleepSync(250);
  }
}

/**
 * Terminate every connection to the e2e database and wait until none remain, so
 * a killed backend's leaked connections never accumulate across invocations.
 * Best-effort: a single short-lived maintenance connection (max: 1).
 */
async function drainE2eConnections(): Promise<void> {
  const sql = new SQL(maintenanceUrl(), { max: 1 });
  try {
    await sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${E2E_DB_NAME} AND pid <> pg_backend_pid()`;
    for (let i = 0; i < 40; i++) {
      const rows = await sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = ${E2E_DB_NAME}`;
      if (rows[0].n === 0) break;
      await Bun.sleep(250);
    }
  } catch {
    // The DB may not exist yet (first run) or already be idle - nothing to drain.
  } finally {
    await sql.end();
  }
}

const specs = readdirSync(testsDir)
  .filter((f) => f.endsWith(".spec.ts"))
  .filter((f) => !filter || f.includes(filter))
  .toSorted();

if (specs.length === 0) {
  throw new Error(
    `No spec files found in ${testsDir}${filter ? ` matching "${filter}"` : ""}`,
  );
}

console.log(`Running ${specs.length} spec file(s) in isolation:\n  ${specs.join("\n  ")}\n`);

const failed: string[] = [];

for (const spec of specs) {
  console.log(`\n========== ${spec} ==========`);
  freePort();
  await drainE2eConnections();

  const proc = Bun.spawnSync({
    cmd: ["bunx", "playwright", "test", path.join("tests", spec), "--reporter=line"],
    cwd: e2eDir,
    stdio: ["inherit", "inherit", "inherit"],
  });

  if (proc.exitCode !== 0) failed.push(spec);
}

// Final cleanup so a finished run leaves Postgres idle.
freePort();
await drainE2eConnections();

console.log("\n================ summary ================");
console.log(`passed: ${specs.length - failed.length}/${specs.length}`);
if (failed.length > 0) {
  console.log(`FAILED: ${failed.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("all spec files green");
}
