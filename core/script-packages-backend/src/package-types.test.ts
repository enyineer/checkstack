import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ManifestEntry } from "@checkstack/script-packages-common";
import { rollupPackageTypes } from "./package-types";

describe("rollupPackageTypes", () => {
  let nm: string;
  beforeEach(async () => {
    nm = path.join(await mkdtemp(path.join(tmpdir(), "cs-types-")), "node_modules");
    await mkdir(nm, { recursive: true });
  });
  afterEach(async () => {
    await rm(path.dirname(nm), { recursive: true, force: true });
  });

  async function pkg(name: string, files: Record<string, string>) {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(nm, name, rel);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, content);
    }
  }

  const entry = (name: string, version = "1.0.0"): ManifestEntry => ({
    name,
    version,
    integrity: `sha-${name}`,
  });

  test("wraps a package's bundled .d.ts in declare module", async () => {
    await pkg("cool", { "index.d.ts": "export function hi(): string;" });
    const [types] = await rollupPackageTypes({
      nodeModulesDir: nm,
      manifest: [entry("cool")],
    });
    expect(types?.name).toBe("cool");
    expect(types?.dts).toContain('declare module "cool"');
    expect(types?.dts).toContain("export function hi(): string;");
  });

  test("includes @types companion declarations", async () => {
    await pkg("bare", { "index.js": "module.exports = {};" });
    await writeFile(
      path.join(nm, "@types", "bare", "index.d.ts"),
      "export const fromTypes: number;",
    ).catch(async () => {
      await mkdir(path.join(nm, "@types", "bare"), { recursive: true });
      await writeFile(
        path.join(nm, "@types", "bare", "index.d.ts"),
        "export const fromTypes: number;",
      );
    });
    const [types] = await rollupPackageTypes({
      nodeModulesDir: nm,
      manifest: [entry("bare")],
    });
    expect(types?.dts).toContain("fromTypes");
  });

  test("returns empty dts for a package without types (still runs)", async () => {
    await pkg("notyped", { "index.js": "module.exports = 1;" });
    const [types] = await rollupPackageTypes({
      nodeModulesDir: nm,
      manifest: [entry("notyped")],
    });
    expect(types?.dts).toBe("");
  });

  test("dedupes the manifest to unique names", async () => {
    await pkg("dup", { "index.d.ts": "export const x: 1;" });
    const result = await rollupPackageTypes({
      nodeModulesDir: nm,
      manifest: [entry("dup"), entry("dup", "1.0.1")],
    });
    expect(result).toHaveLength(1);
  });

  test("missing package dir yields empty dts, never throws", async () => {
    const [types] = await rollupPackageTypes({
      nodeModulesDir: nm,
      manifest: [entry("ghost")],
    });
    expect(types?.dts).toBe("");
  });
});
