import { describe, expect, it } from "bun:test";
import type { ExecCommand, ExecResult, ExecRunner } from "./exec.ts";
import {
  buildPreviewDatabaseUrl,
  copyDataCmd,
  databaseExistsCmd,
  dropDatabaseCmd,
  ensureSnapshot,
  resolveDbCopyConfig,
} from "./db-copy.ts";

describe("buildPreviewDatabaseUrl", () => {
  it("swaps only the database name", () => {
    expect(
      buildPreviewDatabaseUrl({
        databaseUrl: "postgres://checkstack:checkstack@localhost:5432/checkstack",
        previewDb: "checkstack_preview",
      }),
    ).toBe("postgres://checkstack:checkstack@localhost:5432/checkstack_preview");
  });

  it("preserves a query string", () => {
    expect(
      buildPreviewDatabaseUrl({
        databaseUrl: "postgres://u:p@h:5432/db?sslmode=require",
        previewDb: "db_preview",
      }),
    ).toBe("postgres://u:p@h:5432/db_preview?sslmode=require");
  });
});

describe("resolveDbCopyConfig", () => {
  it("derives user/db from DATABASE_URL and defaults the preview name", () => {
    const config = resolveDbCopyConfig({
      env: { DATABASE_URL: "postgres://me:pw@localhost:5432/appdb" },
    });
    expect(config.user).toBe("me");
    expect(config.sourceDb).toBe("appdb");
    expect(config.previewDb).toBe("appdb_preview");
    expect(config.service).toBe("postgres");
  });

  it("prefers explicit POSTGRES_* env over the URL", () => {
    const config = resolveDbCopyConfig({
      env: {
        DATABASE_URL: "postgres://me:pw@localhost:5432/appdb",
        POSTGRES_USER: "checkstack",
        POSTGRES_DB: "checkstack",
      },
    });
    expect(config.user).toBe("checkstack");
    expect(config.sourceDb).toBe("checkstack");
  });
});

const config = resolveDbCopyConfig({
  env: { DATABASE_URL: "postgres://checkstack:checkstack@localhost:5432/checkstack" },
});
const cmdOf = (c: ExecCommand) => `${c.command} ${c.args.join(" ")}`;

describe("command builders", () => {
  it("run through docker compose exec against the compose postgres", () => {
    expect(cmdOf(databaseExistsCmd(config))).toContain(
      "docker compose -f docker-compose-dev.yml exec -T postgres psql",
    );
  });

  it("drops with FORCE to terminate lingering connections", () => {
    expect(cmdOf(dropDatabaseCmd(config))).toContain(
      'DROP DATABASE IF EXISTS "checkstack_preview" WITH (FORCE)',
    );
  });

  it("copies via an in-container pg_dump | psql pipe", () => {
    const cmd = copyDataCmd(config);
    expect(cmd.args).toContain("sh");
    expect(cmd.args.at(-1)).toBe(
      "pg_dump -U checkstack checkstack | psql -U checkstack -d checkstack_preview",
    );
  });
});

function fakeExec(responder: (c: ExecCommand) => Partial<ExecResult>): {
  exec: ExecRunner;
  calls: ExecCommand[];
} {
  const calls: ExecCommand[] = [];
  return {
    calls,
    exec: {
      run(command) {
        calls.push(command);
        const r = responder(command);
        return Promise.resolve({
          code: r.code ?? 0,
          stdout: r.stdout ?? "",
          stderr: r.stderr ?? "",
        });
      },
    },
  };
}

describe("ensureSnapshot", () => {
  it("reuses an existing snapshot when not fresh", async () => {
    const { exec, calls } = fakeExec((c) =>
      c.args.includes("-tAc") && c.args.at(-1)?.includes("pg_database")
        ? { stdout: "1\n" }
        : {},
    );
    const result = await ensureSnapshot({ exec, config });
    expect(result.created).toBe(false);
    // Only the existence check ran; no drop/create.
    expect(calls.map(cmdOf).some((c) => c.includes("DROP DATABASE"))).toBe(false);
  });

  it("re-snapshots when fresh even if one exists", async () => {
    const { exec, calls } = fakeExec((c) =>
      c.args.includes("-tAc") && c.args.at(-1)?.includes("pg_database")
        ? { stdout: "1\n" }
        : {},
    );
    const result = await ensureSnapshot({ exec, config, fresh: true });
    expect(result.created).toBe(true);
    const ran = calls.map(cmdOf);
    expect(ran.some((c) => c.includes("DROP DATABASE"))).toBe(true);
    expect(ran.some((c) => c.includes("CREATE DATABASE"))).toBe(true);
    expect(ran.some((c) => c.includes("pg_dump"))).toBe(true);
  });

  it("snapshots when none exists", async () => {
    const { exec } = fakeExec(() => ({ stdout: "" }));
    const result = await ensureSnapshot({ exec, config });
    expect(result.created).toBe(true);
  });
});
