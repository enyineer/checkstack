/**
 * Integration test for `installBundleFromArtifacts`: a bundle whose primary
 * depends on a sibling must install WITHOUT reaching a registry — the sibling
 * ships inside the bundle and is (deliberately) not published anywhere.
 *
 * The packages use a `@cstest/*` scope that exists on no registry, and the
 * registry env is pointed at an unroutable address, so a successful install
 * can only mean bun resolved the intra-bundle dependency from the co-provided
 * tarball. Before the bundle-aware co-install fix, each sibling was installed
 * via its own `bun install <one.tgz>`, which 404s on the sibling dep.
 *
 * Shells out to a real `bun install`, so it's gated behind `CHECKSTACK_IT=1`
 * (the same gate as the other integration tests) to keep the default unit
 * lane fast and network-free.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { installBundleFromArtifacts } from "./install-from-tarball";

async function shellTar(args: {
  cwd: string;
  tarPath: string;
  entries: string[];
}): Promise<void> {
  const proc = Bun.spawn(["tar", "-czf", args.tarPath, ...args.entries], {
    cwd: args.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`tar exited with status ${exitCode}: ${stderr}`);
  }
}

async function buildTarball(pkgJson: Record<string, unknown>): Promise<Uint8Array> {
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), "bundle-install-test-"));
  try {
    const pkgDir = path.join(stage, "package");
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify(pkgJson, undefined, 2),
    );
    await fs.writeFile(path.join(pkgDir, "index.js"), "module.exports = {};");
    const tarPath = path.join(stage, "out.tgz");
    await shellTar({ cwd: stage, tarPath, entries: ["package"] });
    return new Uint8Array(await fs.readFile(tarPath));
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "installBundleFromArtifacts (real bun install)",
  () => {
    let runtimeDir: string;
    let savedRegistry: string | undefined;

    beforeAll(async () => {
      runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "bundle-runtime-"));
      // Force any registry round-trip to fail fast, so a passing install
      // proves the sibling dep resolved from the co-provided tarball.
      savedRegistry = process.env.BUN_CONFIG_REGISTRY;
      process.env.BUN_CONFIG_REGISTRY = "http://127.0.0.1:1/";
    });

    afterAll(async () => {
      if (savedRegistry === undefined) delete process.env.BUN_CONFIG_REGISTRY;
      else process.env.BUN_CONFIG_REGISTRY = savedRegistry;
      await fs.rm(runtimeDir, { recursive: true, force: true });
    });

    it("resolves an intra-bundle sibling dependency without a registry", async () => {
      const common = await buildTarball({
        name: "@cstest/widget-common",
        version: "0.0.1",
        description: "test common",
        author: "test",
        license: "Elastic-2.0",
        checkstack: { type: "common", pluginId: "widget" },
      });
      // The primary DEPENDS on the (unpublished) sibling — the exact shape
      // that 404s when installed one-tarball-at-a-time.
      const backend = await buildTarball({
        name: "@cstest/widget-backend",
        version: "0.0.1",
        description: "test backend",
        author: "test",
        license: "Elastic-2.0",
        dependencies: { "@cstest/widget-common": "^0.0.1" },
        checkstack: { type: "backend", pluginId: "widget" },
      });

      const installed = await installBundleFromArtifacts({
        packages: [
          { tarball: common, pluginName: "@cstest/widget-common" },
          { tarball: backend, pluginName: "@cstest/widget-backend" },
        ],
        runtimeDir,
      });

      expect(installed.map((i) => i.name).sort()).toEqual([
        "@cstest/widget-backend",
        "@cstest/widget-common",
      ]);
      // Both packages physically landed under the runtime dir's node_modules.
      for (const name of ["@cstest/widget-common", "@cstest/widget-backend"]) {
        const pkgJsonPath = path.join(
          runtimeDir,
          "node_modules",
          name,
          "package.json",
        );
        expect(await fs.exists(pkgJsonPath)).toBe(true);
      }
    }, 60_000);
  },
);
