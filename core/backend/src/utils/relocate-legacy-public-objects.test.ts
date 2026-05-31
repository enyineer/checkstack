import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readPluginOwnedObjects,
  relocateLegacyPublicObjects,
  type RelocationClient,
} from "./relocate-legacy-public-objects";

/**
 * A fake client that answers catalog membership queries from in-memory schema
 * maps and records the `ALTER ... SET SCHEMA` statements it is asked to run.
 */
function makeFakeClient(state: {
  // schema -> relations present, with relkind
  relations: Record<string, Record<string, string>>;
  // schema -> type names present
  types: Record<string, Set<string>>;
}) {
  const altered: string[] = [];
  const client: RelocationClient = {
    async query<T = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: T[] }> {
      if (text.startsWith("ALTER ")) {
        altered.push(text);
        return { rows: [] };
      }
      // Catalog lookups are parameterized: relations use pg_class, types pg_type.
      if (text.includes("pg_class")) {
        const wantsTarget = text.includes("n.nspname = $1");
        const schema = wantsTarget ? (values?.[0] as string) : "public";
        const names = (wantsTarget ? values?.[1] : values?.[0]) as string[];
        const present = state.relations[schema] ?? {};
        const rows = names
          .filter((n) => n in present)
          .map((n) => ({ relname: n, relkind: present[n] }));
        return { rows: rows as T[] };
      }
      if (text.includes("pg_type")) {
        const wantsTarget = text.includes("n.nspname = $1");
        const schema = wantsTarget ? (values?.[0] as string) : "public";
        const names = (wantsTarget ? values?.[1] : values?.[0]) as string[];
        const present = state.types[schema] ?? new Set<string>();
        const rows = names
          .filter((n) => present.has(n))
          .map((n) => ({ typname: n }));
        return { rows: rows as T[] };
      }
      return { rows: [] };
    },
  };
  return { client, altered };
}

describe("relocateLegacyPublicObjects", () => {
  it("moves tables and enums that live in public into the plugin schema", async () => {
    const { client, altered } = makeFakeClient({
      relations: {
        public: {
          health_check_configurations: "r",
          health_check_auto_incidents: "r",
        },
        plugin_healthcheck: {},
      },
      types: {
        public: new Set(["health_check_status", "bucket_size"]),
        plugin_healthcheck: new Set(),
      },
    });

    const { moved } = await relocateLegacyPublicObjects({
      client,
      schema: "plugin_healthcheck",
      owned: {
        relations: [
          "health_check_configurations",
          "health_check_auto_incidents",
          "health_check_state_transitions", // not in public yet -> skipped
        ],
        types: ["health_check_status", "bucket_size"],
      },
    });

    expect(altered).toEqual([
      'ALTER TABLE public."health_check_configurations" SET SCHEMA "plugin_healthcheck"',
      'ALTER TABLE public."health_check_auto_incidents" SET SCHEMA "plugin_healthcheck"',
      'ALTER TYPE public."health_check_status" SET SCHEMA "plugin_healthcheck"',
      'ALTER TYPE public."bucket_size" SET SCHEMA "plugin_healthcheck"',
    ]);
    expect(moved).toContain("table health_check_configurations");
    expect(moved).toContain("type health_check_status");
  });

  it("is idempotent: skips objects already in the plugin schema or absent from public", async () => {
    const { client, altered } = makeFakeClient({
      relations: {
        public: {},
        plugin_healthcheck: { health_check_configurations: "r" },
      },
      types: {
        public: new Set(),
        plugin_healthcheck: new Set(["health_check_status"]),
      },
    });

    const { moved } = await relocateLegacyPublicObjects({
      client,
      schema: "plugin_healthcheck",
      owned: {
        relations: ["health_check_configurations"],
        types: ["health_check_status"],
      },
    });

    expect(altered).toEqual([]);
    expect(moved).toEqual([]);
  });

  it("skips objects present in BOTH public and the plugin schema (no collision ALTER)", async () => {
    // A half-finished prior run (or a manual move) can leave an object in both
    // schemas. Moving it again would error with "relation already exists in
    // schema", so it must be skipped.
    const { client, altered } = makeFakeClient({
      relations: {
        public: { health_check_runs: "r" },
        plugin_healthcheck: { health_check_runs: "r" },
      },
      types: {
        public: new Set(["health_check_status"]),
        plugin_healthcheck: new Set(["health_check_status"]),
      },
    });

    const { moved } = await relocateLegacyPublicObjects({
      client,
      schema: "plugin_healthcheck",
      owned: {
        relations: ["health_check_runs"],
        types: ["health_check_status"],
      },
    });

    expect(altered).toEqual([]);
    expect(moved).toEqual([]);
  });

  it("uses the right ALTER keyword per object kind (view, matview, sequence)", async () => {
    const { client, altered } = makeFakeClient({
      relations: {
        public: { my_view: "v", my_matview: "m", my_seq: "S", my_table: "r" },
        plugin_x: {},
      },
      types: { public: new Set(), plugin_x: new Set() },
    });

    await relocateLegacyPublicObjects({
      client,
      schema: "plugin_x",
      owned: {
        relations: ["my_view", "my_matview", "my_seq", "my_table"],
        types: [],
      },
    });

    expect(altered).toEqual([
      'ALTER VIEW public."my_view" SET SCHEMA "plugin_x"',
      'ALTER MATERIALIZED VIEW public."my_matview" SET SCHEMA "plugin_x"',
      'ALTER SEQUENCE public."my_seq" SET SCHEMA "plugin_x"',
      'ALTER TABLE public."my_table" SET SCHEMA "plugin_x"',
    ]);
  });

  it("never relocates into the public schema", async () => {
    const { client, altered } = makeFakeClient({
      relations: { public: { foo: "r" } },
      types: {},
    });

    const { moved } = await relocateLegacyPublicObjects({
      client,
      schema: "public",
      owned: { relations: ["foo"], types: [] },
    });

    expect(altered).toEqual([]);
    expect(moved).toEqual([]);
  });
});

describe("readPluginOwnedObjects", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "owned-objects-"));
    fs.mkdirSync(path.join(dir, "meta"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeSnapshot = (name: string, body: unknown) =>
    fs.writeFileSync(
      path.join(dir, "meta", name),
      JSON.stringify(body),
      "utf8",
    );

  it("unions object names across ALL snapshots (incl. created-then-dropped)", () => {
    // Early snapshot: a table that a later migration drops.
    writeSnapshot("0000_snapshot.json", {
      tables: {
        "public.kept": { name: "kept", schema: "" },
        "public.dropped_later": { name: "dropped_later", schema: "" },
      },
      enums: { "public.status": { name: "status", schema: "public" } },
    });
    // Latest snapshot: no longer lists the dropped table, adds a new one.
    writeSnapshot("0001_snapshot.json", {
      tables: {
        "public.kept": { name: "kept", schema: "" },
        "public.added": { name: "added", schema: "" },
      },
      enums: { "public.status": { name: "status", schema: "public" } },
    });

    const owned = readPluginOwnedObjects(dir);

    expect(new Set(owned.relations)).toEqual(
      new Set(["kept", "dropped_later", "added"]),
    );
    expect(owned.types).toEqual(["status"]);
  });

  it("ignores objects declared in an explicit non-default schema", () => {
    writeSnapshot("0000_snapshot.json", {
      tables: {
        "public.in_public": { name: "in_public", schema: "" },
        "other.elsewhere": { name: "elsewhere", schema: "other" },
      },
    });

    const owned = readPluginOwnedObjects(dir);
    expect(owned.relations).toEqual(["in_public"]);
  });

  it("returns empty when there is no meta folder", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "no-meta-"));
    try {
      expect(readPluginOwnedObjects(empty)).toEqual({
        relations: [],
        types: [],
      });
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
