/**
 * Syncs TypeScript project references in the root tsconfig.json
 * by scanning all packages in core/ and plugins/ directories.
 */

import { readdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = path.join(import.meta.dirname, "..");
const TSCONFIG_PATH = path.join(ROOT_DIR, "tsconfig.json");

interface TsConfigReference {
  path: string;
}

interface RootTsConfig {
  files: string[];
  references: TsConfigReference[];
}

async function findPackagesWithTsConfig(baseDir: string): Promise<string[]> {
  const packages: string[] = [];
  const entries = await readdir(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const packagePath = path.join(baseDir, entry.name);
    const tsconfigPath = path.join(packagePath, "tsconfig.json");

    try {
      const stats = await stat(tsconfigPath);
      if (stats.isFile()) {
        packages.push(packagePath);
      }
    } catch {
      // No tsconfig.json in this directory, skip
    }
  }

  return packages;
}

async function main(): Promise<void> {
  const coreDir = path.join(ROOT_DIR, "core");
  const pluginsDir = path.join(ROOT_DIR, "plugins");

  // Find all packages with tsconfig.json
  const [corePackages, pluginPackages] = await Promise.all([
    findPackagesWithTsConfig(coreDir),
    findPackagesWithTsConfig(pluginsDir),
  ]);

  const allPackages = [...corePackages, ...pluginPackages].toSorted();

  // Build references array
  const references: TsConfigReference[] = allPackages.map((packagePath) => ({
    path: `./${path.relative(ROOT_DIR, packagePath)}`,
  }));

  // Create root tsconfig
  const rootTsConfig: RootTsConfig = {
    files: [],
    references,
  };

  // Write tsconfig.json
  await writeFile(
    TSCONFIG_PATH,
     
    JSON.stringify(rootTsConfig, null, 2) + "\n",
    "utf8"
  );

  console.log(
    `✓ Updated tsconfig.json with ${references.length} project references`
  );
}

try {
  await main();
} catch (error) {
  console.error("Failed to sync tsconfig references:", error);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}
