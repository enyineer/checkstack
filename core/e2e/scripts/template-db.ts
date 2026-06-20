/**
 * E2E template-database builder.
 *
 * The per-spec-file DB reset (in `start-e2e-server.ts`) used to DROP + CREATE an
 * EMPTY database, forcing the backend to re-run ALL migrations on every boot
 * (~100+ migration files across ~25 plugin schemas). This builds a fully-
 * migrated TEMPLATE database ONCE per run, so each reset becomes a Postgres
 * `CREATE DATABASE ... TEMPLATE` file-copy and the backend's boot-time
 * migrations become a no-op (drizzle sees every migration already applied).
 *
 * The template is built by booting the REAL backend once against an empty DB -
 * i.e. running the exact production migration path (core migrations + each
 * plugin's migrations, via the plugin-loader) plus its idempotent role/
 * access-rule seeding. It is therefore generated from the CURRENT schema every
 * run and can never drift; there is no checked-in dump to maintain. No admin
 * user is created (onboarding stays a per-file step), so the per-file "fresh DB"
 * onboarding flow is unchanged.
 */
import { SQL } from "bun";
import path from "node:path";

export const TEMPLATE_DB_NAME =
  process.env.CHECKSTACK_E2E_TEMPLATE_DB_NAME ?? "checkstack_e2e_template";

// A dedicated port for the one-time build boot, distinct from the per-file
// server port (3100) so the two never collide.
const TEMPLATE_BUILD_PORT = process.env.CHECKSTACK_E2E_TEMPLATE_PORT ?? "3199";
const READY_TIMEOUT_MS = 180_000;
const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function maintenanceUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.pathname = "/postgres";
  return u.toString();
}

function urlForDb(baseUrl: string, dbName: string): string {
  const u = new URL(baseUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

/**
 * Terminate every connection to `dbName` and wait until none remain, so the
 * database can be used as a `CREATE DATABASE ... TEMPLATE` source (which fails
 * if any session is connected to it).
 */
async function drainConnections(baseUrl: string, dbName: string): Promise<void> {
  const sql = new SQL(maintenanceUrl(baseUrl), { max: 1 });
  try {
    await sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${dbName} AND pid <> pg_backend_pid()`;
    for (let i = 0; i < 40; i++) {
      const rows =
        await sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = ${dbName}`;
      if (rows[0].n === 0) break;
      await Bun.sleep(250);
    }
  } finally {
    await sql.end();
  }
}

/**
 * Build the e2e TEMPLATE database once. Idempotent: drops any prior template
 * first. Throws on failure (a missing/broken template would silently fall the
 * suite back to slow per-file migration, so a build failure must be loud).
 */
export async function buildTemplateDatabase({
  databaseUrl,
}: {
  databaseUrl: string;
}): Promise<void> {
  console.log(
    `[e2e] building template database "${TEMPLATE_DB_NAME}" (one-time migrate)...`,
  );
  const startedAt = Date.now();

  // 1. Fresh, empty template database.
  const admin = new SQL(maintenanceUrl(databaseUrl), { max: 1 });
  try {
    await admin.unsafe(
      `DROP DATABASE IF EXISTS "${TEMPLATE_DB_NAME}" WITH (FORCE)`,
    );
    await admin.unsafe(`CREATE DATABASE "${TEMPLATE_DB_NAME}"`);
  } finally {
    await admin.end();
  }

  // 2. Boot the real backend against it so it runs the production migration path
  //    (+ idempotent seeding). We only need it to reach readiness, then stop it.
  const base = `http://localhost:${TEMPLATE_BUILD_PORT}`;
  const backend = Bun.spawn({
    cmd: ["bun", path.join("core", "backend", "src", "index.ts")],
    cwd: repoRoot,
    stdio: ["inherit", "inherit", "inherit"],
    env: {
      ...process.env,
      DATABASE_URL: urlForDb(databaseUrl, TEMPLATE_DB_NAME),
      PORT: TEMPLATE_BUILD_PORT,
      BASE_URL: base,
      INTERNAL_URL: base,
      CHECKSTACK_FRONTEND_DIST: path.join(repoRoot, "core", "frontend", "dist"),
    },
  });

  try {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
      if (backend.exitCode !== null) {
        throw new Error(
          `template backend exited before readiness (code ${backend.exitCode})`,
        );
      }
      try {
        const res = await fetch(`${base}/.checkstack/ready`);
        if (res.ok) break;
      } catch {
        // Backend not listening yet; keep polling.
      }
      if (Date.now() > deadline) {
        throw new Error(
          `template backend did not become ready within ${READY_TIMEOUT_MS / 1000}s`,
        );
      }
      await Bun.sleep(500);
    }
  } finally {
    backend.kill("SIGKILL");
    await backend.exited;
  }

  // 3. Drain the (SIGKILLed) backend's now-dead connections so the template has
  //    zero sessions and can serve as a `CREATE DATABASE ... TEMPLATE` source.
  await drainConnections(databaseUrl, TEMPLATE_DB_NAME);

  console.log(
    `[e2e] template "${TEMPLATE_DB_NAME}" ready in ${Math.round(
      (Date.now() - startedAt) / 1000,
    )}s; per-file resets now clone it (migrations become a no-op).`,
  );
}
