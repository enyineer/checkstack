/**
 * Tests for the `Versioned<T>` config helper, focused on the
 * assume-v1-on-read parse paths used by configs that are stored
 * UNVERSIONED (raw, nested in a larger JSON blob).
 */
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  Versioned,
  assertMigrationChainFromV1,
  type Migration,
} from "./config-versioning";

// A v1 config: a single object schema, no migrations.
const v1Schema = z.object({
  url: z.string(),
  method: z.enum(["GET", "POST"]).default("GET"),
});

const v1Config = new Versioned({ version: 1, schema: v1Schema });

// A v1 -> v2 config that DROPS a removed `sandbox` key, mirroring the
// real run_script/run_shell migration.
const v2Schema = z.object({
  script: z.string(),
});

const dropSandboxMigration: Migration<Record<string, unknown>, unknown> = {
  fromVersion: 1,
  toVersion: 2,
  description: "Drop removed `sandbox` key",
  migrate: ({ sandbox: _sandbox, ...rest }) => rest,
};

const v2Config = new Versioned({
  version: 2,
  schema: v2Schema,
  migrations: [dropSandboxMigration],
});

describe("parseAssumingV1", () => {
  it("validates a v1-no-migration config (just validate)", async () => {
    const result = await v1Config.parseAssumingV1({ url: "https://x.test" });
    expect(result).toEqual({ url: "https://x.test", method: "GET" });
  });

  it("runs the migration chain for a v>1 config and drops a removed key", async () => {
    const result = await v2Config.parseAssumingV1({
      script: "echo hi",
      sandbox: "off",
    });
    expect(result).toEqual({ script: "echo hi" });
  });

  it("is idempotent: a fresh config without the removed key is unchanged", async () => {
    const result = await v2Config.parseAssumingV1({ script: "echo hi" });
    expect(result).toEqual({ script: "echo hi" });
  });

  it("strips unknown keys leniently (does NOT reject typos)", async () => {
    const result = await v1Config.parseAssumingV1({
      url: "https://x.test",
      methodd: "GET",
    });
    expect(result).toEqual({ url: "https://x.test", method: "GET" });
    expect(result).not.toHaveProperty("methodd");
  });

  it("rejects a genuine validation error (missing required field)", async () => {
    await expect(
      v1Config.parseAssumingV1({ method: "GET" }),
    ).rejects.toThrow();
  });
});

describe("parseStrictAssumingV1", () => {
  it("validates a clean v1-no-migration config", async () => {
    const result = await v1Config.parseStrictAssumingV1({
      url: "https://x.test",
    });
    expect(result).toEqual({ url: "https://x.test", method: "GET" });
  });

  it("migrates a removed key away, then strict-validates cleanly", async () => {
    const result = await v2Config.parseStrictAssumingV1({
      script: "echo hi",
      sandbox: "off",
    });
    expect(result).toEqual({ script: "echo hi" });
  });

  it("is idempotent for a fresh config without the removed key", async () => {
    const result = await v2Config.parseStrictAssumingV1({ script: "echo hi" });
    expect(result).toEqual({ script: "echo hi" });
  });

  it("rejects a genuine unknown-key typo the migration does NOT account for", async () => {
    await expect(
      v1Config.parseStrictAssumingV1({
        url: "https://x.test",
        methodd: "GET",
      }),
    ).rejects.toThrow();
  });

  it("rejects an unknown key on the migrated (v2) shape", async () => {
    await expect(
      v2Config.parseStrictAssumingV1({ script: "echo hi", typo: 1 }),
    ).rejects.toThrow();
  });

  it("falls back to a normal parse for non-object schemas", async () => {
    const unionConfig = new Versioned({
      version: 1,
      schema: z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]),
    });
    const result = await unionConfig.parseStrictAssumingV1({ a: "x" });
    expect(result).toEqual({ a: "x" });
  });
});

describe("construction-time migration-chain guard", () => {
  it("throws for a version>1 config with no migrations", () => {
    expect(
      () => new Versioned({ version: 2, schema: v2Schema, migrations: [] }),
    ).toThrow();
  });

  it("constructs fine for a version 2 config with a complete v1->v2 chain", () => {
    expect(
      () =>
        new Versioned({
          version: 2,
          schema: v2Schema,
          migrations: [dropSandboxMigration],
        }),
    ).not.toThrow();
  });

  it("constructs fine for a version 1 config with no migrations", () => {
    expect(() => new Versioned({ version: 1, schema: v1Schema })).not.toThrow();
  });

  it("throws for a broken chain (gap / non-+1 step)", () => {
    expect(
      () =>
        new Versioned({
          version: 4,
          schema: v2Schema,
          migrations: [
            { fromVersion: 1, toVersion: 2, description: "a", migrate: (d) => d },
            { fromVersion: 3, toVersion: 4, description: "c", migrate: (d) => d },
          ],
        }),
    ).toThrow();
  });
});

describe("validateMigrationChainFromV1", () => {
  it("passes for a v1 config with no migrations", () => {
    expect(v1Config.validateMigrationChainFromV1()).toBeUndefined();
  });

  it("passes for a v2 config with a complete 1->2 chain", () => {
    expect(v2Config.validateMigrationChainFromV1()).toBeUndefined();
  });

  // NOTE: the "missing covering migration" and "gapped chain" cases now
  // throw at CONSTRUCTION (see the construction-time guard above), so they
  // can no longer be exercised via a constructed instance. The pure
  // structural method itself is covered transitively by the guard tests
  // and by the passing cases below.
});

describe("assertMigrationChainFromV1", () => {
  const step = (fromVersion: number, toVersion: number): Migration => ({
    fromVersion,
    toVersion,
    description: `${fromVersion}->${toVersion}`,
    migrate: (d) => d,
  });

  it("passes for a v1 config with no migrations", () => {
    expect(() =>
      assertMigrationChainFromV1({ version: 1, migrations: [] }),
    ).not.toThrow();
  });

  it("passes for a complete contiguous chain (1->2->3)", () => {
    expect(() =>
      assertMigrationChainFromV1({
        version: 3,
        migrations: [step(2, 3), step(1, 2)],
      }),
    ).not.toThrow();
  });

  it("throws for a version>1 config with no migrations", () => {
    expect(() =>
      assertMigrationChainFromV1({ version: 2, migrations: [] }),
    ).toThrow(/incomplete/);
  });

  it("throws for a chain that does not reach the target version", () => {
    expect(() =>
      assertMigrationChainFromV1({ version: 3, migrations: [step(1, 2)] }),
    ).toThrow(/incomplete: reaches version 2/);
  });

  it("throws for a gap in the chain", () => {
    expect(() =>
      assertMigrationChainFromV1({
        version: 4,
        migrations: [step(1, 2), step(3, 4)],
      }),
    ).toThrow(/chain broken: expected migration from version 2/);
  });

  it("throws for a non-+1 step", () => {
    expect(() =>
      assertMigrationChainFromV1({
        version: 3,
        migrations: [step(1, 3)],
      }),
    ).toThrow(/increment version by 1/);
  });
});
