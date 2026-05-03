import path from "node:path";
import fs from "node:fs";
import semver from "semver";
import type { InstallPackageMetadata } from "@checkstack/common";
import type { CompatibilityIssue } from "@checkstack/pluginmanager-common";
import { rootLogger } from "../logger";

/**
 * Builds a snapshot of every `@checkstack/*` package the current process
 * can resolve, with its installed `version`. Used as the source of truth
 * for compatibility checks.
 *
 * We don't need a separate "core version" — every package version is its
 * own contract.
 */
export function loadCheckstackPackageVersions({
  workspaceRoot,
  runtimeDir,
}: {
  workspaceRoot: string;
  runtimeDir: string;
}): Map<string, string> {
  const versions = new Map<string, string>();

  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgJsonPath = path.join(dir, entry.name, "package.json");
      if (!fs.existsSync(pkgJsonPath)) continue;
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
        if (
          typeof pkg.name === "string" &&
          pkg.name.startsWith("@checkstack/") &&
          typeof pkg.version === "string"
         && // First-write wins: monorepo source wins over runtime_plugins
          !versions.has(pkg.name)) {
            versions.set(pkg.name, pkg.version);
          }
      } catch (error) {
        rootLogger.debug(`Failed to read ${pkgJsonPath}`, error);
      }
    }
  };

  walk(path.join(workspaceRoot, "core"));
  walk(path.join(workspaceRoot, "plugins"));
  walk(path.join(runtimeDir, "node_modules"));
  walk(path.join(runtimeDir, "node_modules", "@checkstack"));

  return versions;
}

/**
 * Check that every `@checkstack/*` dep declared by a plugin (and its bundle
 * siblings) is satisfiable from the loaded package set OR from another
 * package in the same install bundle.
 *
 * Returns an empty array when compatible, a populated array of issues otherwise.
 */
export function checkCompatibility({
  packages,
  loadedVersions,
}: {
  packages: InstallPackageMetadata[];
  loadedVersions: Map<string, string>;
}): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];

  // Bundle-internal deps: plugins in the same install set satisfy each other.
  const bundleVersions = new Map<string, string>();
  for (const pkg of packages) {
    bundleVersions.set(pkg.name, pkg.version);
  }

  for (const pkg of packages) {
    const deps = pkg.dependencies ?? {};
    for (const [depName, declaredRange] of Object.entries(deps)) {
      if (!depName.startsWith("@checkstack/")) continue;

      // Skip workspace ranges — these only appear in monorepo source files,
      // never in published tarballs (the pack CLI rewrites them). If we see
      // one here it's a sign the plugin wasn't packed via our CLI.
      if (declaredRange.startsWith("workspace:")) {
        issues.push({
          pluginName: pkg.name,
          kind: "version-mismatch",
          dependency: depName,
          declared: declaredRange,
          message: `Plugin '${pkg.name}' depends on '${depName}' with unresolved 'workspace:*' range. Re-pack with '@checkstack/scripts plugin-pack' which resolves workspace ranges to concrete versions.`,
        });
        continue;
      }

      const bundleVersion = bundleVersions.get(depName);
      if (bundleVersion !== undefined) {
        if (!semver.satisfies(bundleVersion, declaredRange)) {
          issues.push({
            pluginName: pkg.name,
            kind: "version-mismatch",
            dependency: depName,
            declared: declaredRange,
            actual: bundleVersion,
            message: `Plugin '${pkg.name}' requires ${depName}@${declaredRange} but the bundle ships ${bundleVersion}.`,
          });
        }
        continue;
      }

      const loadedVersion = loadedVersions.get(depName);
      if (loadedVersion === undefined) {
        issues.push({
          pluginName: pkg.name,
          kind: "missing-dependency",
          dependency: depName,
          declared: declaredRange,
          message: `Plugin '${pkg.name}' depends on '${depName}' which is not loaded by this platform and is not part of the install bundle.`,
        });
        continue;
      }

      if (!semver.satisfies(loadedVersion, declaredRange)) {
        issues.push({
          pluginName: pkg.name,
          kind: "version-mismatch",
          dependency: depName,
          declared: declaredRange,
          actual: loadedVersion,
          message: `Plugin '${pkg.name}' requires ${depName}@${declaredRange} but this platform has ${loadedVersion}.`,
        });
      }
    }
  }

  return issues;
}
