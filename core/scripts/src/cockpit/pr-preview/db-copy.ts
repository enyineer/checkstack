import type { ExecCommand, ExecRunner } from "./exec.ts";

/**
 * Everything needed to snapshot the dev database into an ephemeral copy inside
 * the compose postgres container. The copy shares the SAME server/credentials
 * (so encrypted secrets in the copy still decrypt with the shared `.env` key);
 * only the database NAME differs.
 */
export interface DbCopyConfig {
  /** Compose file the dev postgres runs under. */
  readonly composeFile: string;
  /** Compose service name of the postgres container. */
  readonly service: string;
  /** Postgres superuser/role to connect as. */
  readonly user: string;
  /** The live dev database to copy FROM. */
  readonly sourceDb: string;
  /** The ephemeral database to copy INTO (dropped on wipe). */
  readonly previewDb: string;
  /** The dev DATABASE_URL, used to derive the preview URL. */
  readonly databaseUrl: string;
}

/** Parse `postgres://user:pass@host:port/dbname` loosely (dbname + user only). */
function parseDbUrl(url: string): { user?: string; dbName?: string } {
  const match = /^[^:]+:\/\/(?:([^:@/]+)(?::[^@/]*)?@)?[^/]+\/([^/?#]+)/.exec(
    url,
  );
  return { user: match?.[1], dbName: match?.[2] };
}

/** Replace the database name in a postgres URL, preserving everything else. */
export function buildPreviewDatabaseUrl({
  databaseUrl,
  previewDb,
}: {
  databaseUrl: string;
  previewDb: string;
}): string {
  // Swap the last path segment (the db name), keeping any ?query intact.
  return databaseUrl.replace(
    /\/([^/?#]+)(\?[^#]*)?$/,
    (_all, _db, query = "") => `/${previewDb}${query}`,
  );
}

/**
 * Resolve the db-copy config from the environment, with dev defaults. Pure.
 */
export function resolveDbCopyConfig({
  env,
  composeFile = "docker-compose-dev.yml",
  service = "postgres",
  previewDbName,
}: {
  env: Readonly<Record<string, string | undefined>>;
  composeFile?: string;
  service?: string;
  previewDbName?: string;
}): DbCopyConfig {
  const databaseUrl =
    env.DATABASE_URL ?? "postgres://checkstack:checkstack@localhost:5432/checkstack";
  const parsed = parseDbUrl(databaseUrl);
  const user = env.POSTGRES_USER ?? parsed.user ?? "checkstack";
  const sourceDb = env.POSTGRES_DB ?? parsed.dbName ?? "checkstack";
  const previewDb = previewDbName ?? `${sourceDb}_preview`;
  return { composeFile, service, user, sourceDb, previewDb, databaseUrl };
}

/** `docker compose -f <file> exec -T <service> <args...>`. */
function composeExec(
  config: DbCopyConfig,
  args: readonly string[],
): ExecCommand {
  return {
    command: "docker",
    args: [
      "compose",
      "-f",
      config.composeFile,
      "exec",
      "-T",
      config.service,
      ...args,
    ],
  };
}

/** `psql` invocation inside the container connected to the given database. */
function psql(config: DbCopyConfig, db: string, sql: string): ExecCommand {
  return composeExec(config, ["psql", "-U", config.user, "-d", db, "-tAc", sql]);
}

export function databaseExistsCmd(config: DbCopyConfig): ExecCommand {
  return psql(
    config,
    "postgres",
    `SELECT 1 FROM pg_database WHERE datname='${config.previewDb}'`,
  );
}

export function dropDatabaseCmd(config: DbCopyConfig): ExecCommand {
  // WITH (FORCE) terminates any lingering connections so the drop cannot hang.
  return psql(
    config,
    "postgres",
    `DROP DATABASE IF EXISTS "${config.previewDb}" WITH (FORCE)`,
  );
}

export function createDatabaseCmd(config: DbCopyConfig): ExecCommand {
  return psql(config, "postgres", `CREATE DATABASE "${config.previewDb}"`);
}

export function copyDataCmd(config: DbCopyConfig): ExecCommand {
  // pg_dump the source and pipe straight into the fresh preview db, all inside
  // the container so no dump ever touches the host filesystem.
  const script = `pg_dump -U ${config.user} ${config.sourceDb} | psql -U ${config.user} -d ${config.previewDb}`;
  return composeExec(config, ["sh", "-c", script]);
}

/** Whether the ephemeral preview database currently exists. */
export async function snapshotExists({
  exec,
  config,
}: {
  exec: ExecRunner;
  config: DbCopyConfig;
}): Promise<boolean> {
  const result = await exec.run(databaseExistsCmd(config));
  return result.stdout.trim() === "1";
}

/** Drop the ephemeral preview database (used by --wipe and by --fresh). */
export async function wipeSnapshot({
  exec,
  config,
}: {
  exec: ExecRunner;
  config: DbCopyConfig;
}): Promise<void> {
  await exec.run(dropDatabaseCmd(config));
}

/** Drop-if-exists, create empty, then copy the dev data into the preview db. */
export async function createSnapshot({
  exec,
  config,
  onStep,
}: {
  exec: ExecRunner;
  config: DbCopyConfig;
  onStep?: (message: string) => void;
}): Promise<void> {
  onStep?.(`Dropping any existing ${config.previewDb}...`);
  const dropped = await exec.run(dropDatabaseCmd(config));
  if (dropped.code !== 0) {
    throw new Error(`Failed to drop ${config.previewDb}: ${dropped.stderr.trim()}`);
  }
  onStep?.(`Creating ${config.previewDb}...`);
  const created = await exec.run(createDatabaseCmd(config));
  if (created.code !== 0) {
    throw new Error(`Failed to create ${config.previewDb}: ${created.stderr.trim()}`);
  }
  onStep?.(`Copying ${config.sourceDb} -> ${config.previewDb}...`);
  const copied = await exec.run(copyDataCmd(config));
  if (copied.code !== 0) {
    throw new Error(`Failed to copy data: ${copied.stderr.trim()}`);
  }
}

/**
 * Ensure a usable preview snapshot exists. With `fresh`, always re-snapshots;
 * otherwise reuses an existing copy and only snapshots when none exists.
 */
export async function ensureSnapshot({
  exec,
  config,
  fresh = false,
  onStep,
}: {
  exec: ExecRunner;
  config: DbCopyConfig;
  fresh?: boolean;
  onStep?: (message: string) => void;
}): Promise<{ created: boolean }> {
  const exists = await snapshotExists({ exec, config });
  if (exists && !fresh) {
    onStep?.(`Reusing existing ${config.previewDb} snapshot.`);
    return { created: false };
  }
  await createSnapshot({ exec, config, onStep });
  return { created: true };
}
