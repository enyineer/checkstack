/**
 * E2E backend launcher.
 *
 * Boots the real Checkstack backend (real better-auth, NOT dev-auth) against an
 * ISOLATED, freshly-reset Postgres database so authenticated UI flows can be
 * driven end-to-end without touching the developer's working database.
 *
 * Why a launcher (vs. inlining env in the Playwright `webServer.command`):
 *  - We must DROP + CREATE the dedicated e2e database *before* the backend runs
 *    its boot-time migrations, and the backend reads `DATABASE_URL` at import
 *    time - so the reset has to happen first.
 *  - It keeps the DB password out of the static config string: we derive the
 *    e2e connection from the `DATABASE_URL` already loaded from `.env`.
 *
 * The backend is started as its OWN process (not `import`ed): it exports a Bun
 * default-export server (`export default { port, fetch }`), which Bun only
 * auto-starts when the module is the entrypoint. Importing it would run init
 * (and its boot-time self-S2S calls) WITHOUT ever opening the HTTP port.
 *
 * Run via: `bun --env-file=<repo>/.env core/e2e/scripts/start-e2e-server.ts`
 */
import { SQL } from "bun";
import path from "node:path";
import { TEMPLATE_DB_NAME } from "./template-db";

const E2E_DB_NAME = process.env.CHECKSTACK_E2E_DB_NAME ?? "checkstack_e2e";
const PORT = process.env.PORT ?? "3100";
const BASE = `http://localhost:${PORT}`;

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function requireDatabaseUrl(): URL {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      "DATABASE_URL is not set - run this launcher with `bun --env-file=<repo>/.env`",
    );
  }
  return new URL(raw);
}

/**
 * Drop and recreate the dedicated e2e database so every run starts from a clean,
 * migration-fresh schema. Connects to the maintenance `postgres` database (you
 * cannot drop the database you are connected to). `WITH (FORCE)` evicts any
 * connections a previous run left open.
 *
 * Fast path: when the migrated TEMPLATE database exists (built once by
 * `with-e2e-postgres.ts`), clone it with `CREATE DATABASE ... TEMPLATE` - a
 * Postgres file copy, so the backend's boot-time migrations all no-op (drizzle
 * sees them already applied). Fallback: when no template exists (e.g. running
 * this launcher directly via `test:e2e:file` without the wrapper), create an
 * empty DB and let the backend migrate from scratch, exactly as before.
 */
async function resetE2eDatabase(dbUrl: URL): Promise<string> {
  const adminUrl = new URL(dbUrl.toString());
  adminUrl.pathname = "/postgres";

  // Only one short-lived connection is needed for the DDL; keep the pool at 1 so
  // the reset never adds to connection pressure.
  const admin = new SQL(adminUrl.toString(), { max: 1 });
  try {
    // Database identifiers cannot be parameterized; the names are fixed
    // constants (no user input), so interpolating them into DDL is safe here.
    await admin.unsafe(`DROP DATABASE IF EXISTS "${E2E_DB_NAME}" WITH (FORCE)`);
    const templateRows =
      await admin`SELECT 1 FROM pg_database WHERE datname = ${TEMPLATE_DB_NAME}`;
    const createSql =
      templateRows.length > 0
        ? `CREATE DATABASE "${E2E_DB_NAME}" TEMPLATE "${TEMPLATE_DB_NAME}"`
        : `CREATE DATABASE "${E2E_DB_NAME}"`;
    await admin.unsafe(createSql);
  } finally {
    await admin.end();
  }

  const e2eUrl = new URL(dbUrl.toString());
  e2eUrl.pathname = `/${E2E_DB_NAME}`;
  return e2eUrl.toString();
}

const dbUrl = requireDatabaseUrl();
const e2eDatabaseUrl = await resetE2eDatabase(dbUrl);

console.log(
  `[e2e] reset database "${E2E_DB_NAME}", booting backend on ${BASE}`,
);

// Start the backend as its own entrypoint so Bun's default-export server opens
// the HTTP port. Inherit the parent env (which already carries .env secrets like
// BETTER_AUTH_SECRET / ENCRYPTION_MASTER_KEY) and override the e2e-specific bits.
const backend = Bun.spawn({
  cmd: ["bun", path.join("core", "backend", "src", "index.ts")],
  cwd: repoRoot,
  stdio: ["inherit", "inherit", "inherit"],
  env: {
    ...process.env,
    DATABASE_URL: e2eDatabaseUrl,
    PORT,
    BASE_URL: BASE,
    INTERNAL_URL: BASE,
    CHECKSTACK_FRONTEND_DIST: path.join(repoRoot, "core", "frontend", "dist"),
    // CHECKSTACK_DOCS_DIST left unset: backend defaults to the repo docs/dist.
    // No CHECKSTACK_DEV_AUTH: the real auth/session path is exercised.
  },
});

// Forward termination from Playwright (which manages this process' lifecycle) to
// the backend child so we don't leak the port between runs.
const stop = () => backend.kill();
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

// Mirror the backend's exit code without `process.exit()` (lint: no-process-exit):
// once the child exits and nothing else keeps the loop alive, the launcher ends
// with this code. Playwright then sees the webServer process exit.
process.exitCode = (await backend.exited) ?? 0;
