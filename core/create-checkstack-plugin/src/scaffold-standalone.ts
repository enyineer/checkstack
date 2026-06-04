import path from "node:path";
import {
  scaffoldPlugin,
  scaffoldStandaloneRoot,
  type VersionResolver,
  type ScaffoldIo,
} from "@checkstack/scripts/scaffold";

/**
 * Compose the full standalone plugin workspace: the root workspace files
 * plus the `common` + `backend` + `frontend` trio under `packages/`.
 *
 * This is the monorepo-decoupled orchestration the `create-checkstack-plugin`
 * CLI runs (the CLI itself only adds prompts + `git init` on top). It is a
 * thin composition over the `@checkstack/scripts` engine seams so it can be
 * unit-tested against a tmpdir with an injected resolver and IO.
 */

/** The three package types the standalone default emits, in dependency order. */
export const STANDALONE_PLUGIN_TYPES = [
  "common",
  "backend",
  "frontend",
] as const;

export type StandalonePluginType = (typeof STANDALONE_PLUGIN_TYPES)[number];

export interface ScaffoldStandaloneWorkspaceOptions {
  /** Repo root directory to create (the workspace root). */
  rootDir: string;
  /** Bare base name, e.g. `widget`. */
  baseName: string;
  description: string;
  /** npm scope without `@` (e.g. `acme`); empty string for unscoped. */
  packageScope: string;
  /**
   * Resolves concrete versions for the rendered `workspace:*` ranges.
   * `@checkstack/*` deps resolve from the registry; local trio siblings are
   * kept as `workspace:*` by the resolver.
   */
  resolveVersion: VersionResolver;
  io?: Partial<ScaffoldIo>;
}

export interface ScaffoldStandaloneWorkspaceResult {
  rootDir: string;
  packagesDir: string;
  /** Absolute paths of every file written (root + trio). */
  createdFiles: string[];
}

/**
 * Build the set of local sibling package names (scope-aware) so the version
 * resolver knows which `workspace:*` ranges to leave untouched.
 */
export function localSiblingNames({
  baseName,
  packageScope,
}: {
  baseName: string;
  packageScope: string;
}): Set<string> {
  const prefix = packageScope ? `@${packageScope}/` : "";
  return new Set(
    STANDALONE_PLUGIN_TYPES.map((type) => `${prefix}${baseName}-${type}`),
  );
}

export async function scaffoldStandaloneWorkspace({
  rootDir,
  baseName,
  description,
  packageScope,
  resolveVersion,
  io,
}: ScaffoldStandaloneWorkspaceOptions): Promise<ScaffoldStandaloneWorkspaceResult> {
  const createdFiles: string[] = [];

  const root = scaffoldStandaloneRoot({
    rootDir,
    baseName,
    description,
    packageScope,
    io,
  });
  createdFiles.push(...root.createdFiles);

  const packagesDir = path.join(rootDir, "packages");

  for (const pluginType of STANDALONE_PLUGIN_TYPES) {
    const result = await scaffoldPlugin({
      mode: { kind: "standalone", targetDir: packagesDir },
      baseName,
      description,
      pluginType,
      packageScope,
      resolveVersion,
      io,
    });
    createdFiles.push(...result.createdFiles);
  }

  return { rootDir, packagesDir, createdFiles };
}
