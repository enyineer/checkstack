/**
 * Shared workspace-package discovery for the repo's build scripts.
 *
 * Both the tsconfig-reference generator (`generate-tsconfig-references.ts`) and
 * the satellite image prune (`prune-for-satellite.ts`) need the same thing: the
 * set of workspace packages and their `@checkstack/*` dependencies, read from
 * the root `package.json` workspaces globs. They previously each had their own
 * copy of this walk, which is exactly the kind of thing that drifts (one adds a
 * workspace glob, dedup rule, or dep source the other misses). This module is
 * the single source of truth for "what packages exist and what do they depend
 * on"; each caller derives only the projection it needs.
 */
import { Glob } from "bun";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** A workspace package as read from disk, before any caller-specific shaping. */
export interface WorkspacePackage {
  /** Package name, e.g. `@checkstack/backend-api`. */
  name: string;
  /** Absolute path to the package dir. */
  absDir: string;
  /** Repo-relative dir, e.g. `core/backend-api`. */
  relDir: string;
  /** Raw `dependencies` map (runtime). */
  dependencies: Record<string, string>;
  /** Raw `devDependencies` map. */
  devDependencies: Record<string, string>;
  /** Whether the package has a `tsconfig.json`. */
  hasTsconfig: boolean;
  /** The `extends` value of its `tsconfig.json`, if any (e.g. `astro/tsconfigs/...`). */
  tsconfigExtends?: string;
}

interface RawPackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[];
}

/**
 * Discover every workspace package under the root `package.json` `workspaces`
 * globs. Deduplicates by package name (first match wins). Packages without a
 * `package.json` or a `name` are skipped; a missing `tsconfig.json` is recorded
 * (via {@link WorkspacePackage.hasTsconfig}), NOT filtered - callers decide.
 */
export async function discoverWorkspacePackages(
  root: string = process.cwd(),
): Promise<WorkspacePackage[]> {
  const rootPkg = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as RawPackageJson;
  const patterns = rootPkg.workspaces ?? [];

  const out: WorkspacePackage[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const glob = new Glob(pattern);
    for await (const match of glob.scan({ cwd: root, onlyFiles: false })) {
      const absDir = path.join(root, match);
      const pkgPath = path.join(absDir, "package.json");
      if (!existsSync(pkgPath)) continue;

      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as RawPackageJson;
      if (!pkg.name || seen.has(pkg.name)) continue;
      seen.add(pkg.name);

      const tsPath = path.join(absDir, "tsconfig.json");
      const hasTsconfig = existsSync(tsPath);
      const tsconfigExtends = hasTsconfig
        ? (readFileSync(tsPath, "utf8").match(/"extends"\s*:\s*"([^"]+)"/)?.[1] ??
          undefined)
        : undefined;

      out.push({
        name: pkg.name,
        absDir,
        relDir: match,
        dependencies: pkg.dependencies ?? {},
        devDependencies: pkg.devDependencies ?? {},
        hasTsconfig,
        tsconfigExtends,
      });
    }
  }
  return out;
}

/**
 * The `@checkstack/*` dependency NAMES of a package. `includeDev: true` unions
 * `devDependencies` (the reference generator wires those too); `false` keeps
 * only runtime `dependencies` (the satellite image ships runtime deps only).
 */
export function checkstackWorkspaceDeps(
  pkg: Pick<WorkspacePackage, "dependencies" | "devDependencies">,
  { includeDev }: { includeDev: boolean },
): string[] {
  const all = includeDev
    ? { ...pkg.dependencies, ...pkg.devDependencies }
    : pkg.dependencies;
  return Object.keys(all).filter((d) => d.startsWith("@checkstack/"));
}
