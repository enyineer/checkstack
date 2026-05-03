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
