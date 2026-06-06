import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { InstalledArtifact } from "@checkstack/backend-api";
import { rootLogger } from "../../logger";
import { extractPackageJson } from "./tarball-utils";

const execAsync = promisify(exec);

/**
 * Shared post-fetch installer used by every per-source installer.
 *
 * Writes the tarball bytes to a tmpfile and runs `bun install <file>` into
 * the runtime dir. Lifecycle scripts are blocked by default
 * (`--ignore-scripts`); plugins can opt in via
 * `package.json#checkstack.allowInstallScripts: true` — surfaced in the
 * install warning UI.
 */
export async function installFromArtifact({
  tarball,
  pluginName,
  allowInstallScripts,
  runtimeDir,
}: {
  tarball: Uint8Array;
  pluginName: string;
  allowInstallScripts?: boolean;
  runtimeDir: string;
}): Promise<InstalledArtifact> {
  await fs.mkdir(runtimeDir, { recursive: true });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "checkstack-plugin-"));
  const tarPath = path.join(tmpDir, "plugin.tgz");
  try {
    await fs.writeFile(tarPath, tarball);

    const ignoreScripts = allowInstallScripts ? "" : "--ignore-scripts";
    const cmd = `bun install "${tarPath}" --cwd "${runtimeDir}" --no-save ${ignoreScripts}`.trim();

    rootLogger.info(`📦 Running: ${cmd}`);
    const { stderr } = await execAsync(cmd);
    if (stderr) rootLogger.debug(stderr);

    // After install, validate the installed package.json matches what we
    // expected. The pkg dir under node_modules can be a scoped path
    // (`@scope/name`), so resolve via the tarball's package.json name.
    const expected = await extractPackageJson(tarball);
    if (expected.name !== pluginName) {
      throw new Error(
        `Tarball name mismatch: expected '${pluginName}', got '${expected.name}'`,
      );
    }

    const pkgDir = path.join(runtimeDir, "node_modules", expected.name);
    const installedPkgJson = JSON.parse(
      await fs.readFile(path.join(pkgDir, "package.json"), "utf8"),
    );

    return {
      name: installedPkgJson.name,
      path: pkgDir,
      version: installedPkgJson.version,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Install every package of a multi-package bundle so that intra-bundle
 * dependencies (a sibling depending on `@scope/other-sibling`) resolve from
 * the co-shipped tarballs instead of being fetched from a registry — those
 * siblings live inside the bundle and are typically not published anywhere.
 *
 * `bun install a.tgz b.tgz` does NOT make one CLI-provided tarball satisfy
 * another's named dependency range; bun still resolves `@scope/sibling@^x`
 * against the registry and 404s. The reliable mechanism is a throwaway
 * manifest that lists every sibling as a `file:` dependency AND pins every
 * sibling name in `overrides` to that same `file:` tarball, so any sibling's
 * range is forced to the local tarball. External deps (`@checkstack/*` and
 * their transitive deps) still resolve from the registry as normal.
 *
 * We install into a temp root (a manifest-driven install would PRUNE the
 * shared runtime dir down to just this bundle), then merge the resulting
 * `node_modules` into `runtimeDir/node_modules` additively — bun's default
 * layout is hoisted real directories (no symlinks), so a recursive copy is a
 * safe per-entry merge that leaves previously-installed plugins intact.
 *
 * `allowInstallScripts` is bundle-wide: `--ignore-scripts` is all-or-nothing
 * for one command, so callers pass the primary package's opt-in (the package
 * the operator chose to trust).
 */
export async function installBundleFromArtifacts({
  packages,
  allowInstallScripts,
  runtimeDir,
}: {
  packages: Array<{ tarball: Uint8Array; pluginName: string }>;
  allowInstallScripts?: boolean;
  runtimeDir: string;
}): Promise<InstalledArtifact[]> {
  if (packages.length === 0) {
    throw new Error("installBundleFromArtifacts: no packages to install");
  }
  await fs.mkdir(runtimeDir, { recursive: true });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "checkstack-bundle-"));
  try {
    const stageDir = path.join(tmpDir, "stage");
    const rootDir = path.join(tmpDir, "root");
    await fs.mkdir(stageDir, { recursive: true });
    await fs.mkdir(rootDir, { recursive: true });

    // Stage each tarball and validate its name up front.
    const dependencies: Record<string, string> = {};
    const overrides: Record<string, string> = {};
    for (const [i, pkg] of packages.entries()) {
      const expected = await extractPackageJson(pkg.tarball);
      if (expected.name !== pkg.pluginName) {
        throw new Error(
          `Tarball name mismatch: expected '${pkg.pluginName}', got '${expected.name}'`,
        );
      }
      const tarPath = path.join(stageDir, `pkg-${i}.tgz`);
      await fs.writeFile(tarPath, pkg.tarball);
      const fileSpecifier = `file:${tarPath}`;
      dependencies[expected.name] = fileSpecifier;
      overrides[expected.name] = fileSpecifier;
    }

    await fs.writeFile(
      path.join(rootDir, "package.json"),
      JSON.stringify(
        { name: "_checkstack-bundle-install", version: "0.0.0", dependencies, overrides },
        undefined,
        2,
      ),
    );

    const ignoreScripts = allowInstallScripts ? "" : "--ignore-scripts";
    const cmd =
      `bun install --cwd "${rootDir}" --no-save ${ignoreScripts}`.trim();
    rootLogger.info(`📦 Running (bundle): ${cmd}`);
    const { stderr } = await execAsync(cmd);
    if (stderr) rootLogger.debug(stderr);

    // Merge the resolved tree into the shared runtime dir, per top-level
    // entry, so existing plugins' node_modules entries are preserved.
    const srcModules = path.join(rootDir, "node_modules");
    const destModules = path.join(runtimeDir, "node_modules");
    await fs.mkdir(destModules, { recursive: true });
    for (const entry of await fs.readdir(srcModules)) {
      await fs.cp(
        path.join(srcModules, entry),
        path.join(destModules, entry),
        { recursive: true, force: true },
      );
    }

    const installed: InstalledArtifact[] = [];
    for (const pkg of packages) {
      const pkgDir = path.join(destModules, pkg.pluginName);
      const installedPkgJson = JSON.parse(
        await fs.readFile(path.join(pkgDir, "package.json"), "utf8"),
      );
      installed.push({
        name: installedPkgJson.name,
        path: pkgDir,
        version: installedPkgJson.version,
      });
    }
    return installed;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
