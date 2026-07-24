#!/usr/bin/env bun
/**
 * Generates TypeScript project references for every workspace package
 * by reading their `dependencies` + `devDependencies` and resolving
 * `@checkstack/*` entries to their workspace paths.
 *
 * Modes:
 *   - default: write changes to disk
 *   - --check: dry-run; exit code 1 if any tsconfig would be modified.
 *     Used in CI to detect when someone added a workspace dep but forgot
 *     to refresh references.
 *
 * Idempotent — safe to re-run after adding new packages or deps.
 *
 * Output:
 *   - Each package's `tsconfig.json` gets a `references` array.
 *   - A root `tsconfig.json` is written with references to every workspace
 *     package, suitable for `tsgo -b` from the repo root.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

import {
  discoverWorkspacePackages,
  checkstackWorkspaceDeps,
} from "./workspace-packages";

const CHECK_ONLY = process.argv.includes("--check");

interface TsConfig {
  extends?: string;
  include?: string[];
  exclude?: string[];
  compilerOptions?: Record<string, unknown>;
  references?: { path: string }[];
}

interface DiscoveredPackage {
  /** absolute path to the package dir */
  absDir: string;
  /** repo-relative path, e.g. "core/backend" */
  relDir: string;
  /** package name, e.g. "@checkstack/backend" */
  name: string;
  /** @checkstack/* deps (names only) */
  workspaceDeps: string[];
}

const ROOT = process.cwd();

async function discover(): Promise<DiscoveredPackage[]> {
  const packages = await discoverWorkspacePackages(ROOT);
  return (
    packages
      // Project references only make sense for packages with a tsconfig, and
      // NOT for ones whose tsconfig is owned by a non-tsgo toolchain (e.g. Astro
      // for the docs site) - those reference virtual modules like `astro:content`
      // that only resolve via that tool, so wiring them into the `tsgo -b`
      // solution would break CI.
      .filter(
        (p) => p.hasTsconfig && !p.tsconfigExtends?.startsWith("astro/"),
      )
      .map((p) => ({
        absDir: p.absDir,
        relDir: p.relDir,
        name: p.name,
        // References mirror both runtime AND dev workspace deps.
        workspaceDeps: checkstackWorkspaceDeps(p, { includeDev: true }),
      }))
  );
}

function readJsonc(file: string): TsConfig {
  // tsconfig.json may have // comments and trailing commas. Strip them
  // before JSON.parse — naive but sufficient for our well-formed configs.
  const raw = readFileSync(file, "utf8");
  const stripped = raw
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/(^|[^:])\/\/.*$/gm, "$1")
    .replaceAll(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped) as TsConfig;
}

function writeJson(file: string, data: unknown): boolean {
  const next = JSON.stringify(data, undefined, 2) + "\n";
  const prev = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (prev === next) return false;
  if (!CHECK_ONLY) writeFileSync(file, next, "utf8");
  return true;
}

/**
 * Detect cycles via DFS and remove the back-edges so the resulting graph
 * is a DAG — required by `tsc -b` / `tsgo -b`. Pruned edges are logged.
 *
 * Why this is acceptable: with `moduleResolution: bundler` and
 * `package.json#main` pointing at source files, TypeScript still resolves
 * cross-package imports at typecheck time even when there is no explicit
 * project reference. The reference is purely a build-orchestration hint.
 * Removing a back-edge means the orchestrator won't pre-build the cyclic
 * dependency, but the dependent project still type-checks correctly via
 * source-file fallback.
 */
function pruneCyclesToDag(
  edges: Map<string, Set<string>>,
): { edges: Map<string, Set<string>>; pruned: { from: string; to: string }[] } {
  const VISITING = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  const pruned: { from: string; to: string }[] = [];

  // DETERMINISM: which back-edge breaks a cycle depends on the DFS visitation
  // order (both the start-node order and the child order). Those otherwise
  // follow package DISCOVERY order, which differs between environments (local
  // vs CI) - so the same graph could prune a DIFFERENT edge in CI than the
  // committed tsconfigs reflect, failing `--check` non-deterministically. Sort
  // BOTH orders lexicographically so the pruned set is identical everywhere.
  const childrenOf = (node: string): Iterator<string> =>
    [...(edges.get(node) ?? new Set<string>())].sort().values();

  // Iterative DFS with explicit stack to avoid blowing the call stack on
  // large graphs (we have ~115 packages but cycles can be deep).
  function visit(start: string) {
    const stack: { node: string; iter: Iterator<string> }[] = [
      { node: start, iter: childrenOf(start) },
    ];
    state.set(start, VISITING);
    while (stack.length > 0) {
      const top = stack.at(-1)!;
      const next = top.iter.next();
      if (next.done) {
        state.set(top.node, DONE);
        stack.pop();
        continue;
      }
      const child = next.value;
      const s = state.get(child);
      if (s === VISITING) {
        // Back-edge → cycle. Drop the edge top.node → child.
        edges.get(top.node)!.delete(child);
        pruned.push({ from: top.node, to: child });
      } else if (s !== DONE) {
        state.set(child, VISITING);
        stack.push({ node: child, iter: childrenOf(child) });
      }
    }
  }

  for (const node of [...edges.keys()].sort()) {
    if (state.get(node) !== DONE) visit(node);
  }
  return { edges, pruned };
}

async function main() {
  const packages = await discover();
  const byName = new Map(packages.map((p) => [p.name, p]));

  // Skip config-only packages with no source to typecheck.
  const SKIP_NAMES = new Set([
    "@checkstack/tsconfig",
    "@checkstack/scripts",
  ]);

  // 1. Build the dependency graph (pkg.name → set of dep pkg.name).
  const edges = new Map<string, Set<string>>();
  for (const pkg of packages) {
    if (SKIP_NAMES.has(pkg.name)) continue;
    const out = new Set<string>();
    for (const depName of pkg.workspaceDeps) {
      if (SKIP_NAMES.has(depName)) continue;
      if (!byName.has(depName)) continue;
      const depPkg = byName.get(depName)!;
      if (!existsSync(path.join(depPkg.absDir, "tsconfig.json"))) continue;
      out.add(depName);
    }
    edges.set(pkg.name, out);
  }

  // 2. Prune back-edges to make it a DAG.
  const { pruned } = pruneCyclesToDag(edges);
  if (pruned.length > 0) {
    console.log(
      `⚠️  Pruned ${pruned.length} back-edges to break dep cycles ` +
        "(packages still typecheck via source-file fallback):",
    );
    for (const { from, to } of pruned) {
      console.log(`   - ${from} → ${to}`);
    }
  }

  // 3. Write each package's tsconfig with the (now-acyclic) references.
  let updatedPackages = 0;
  const driftedFiles: string[] = [];
  const compilable: DiscoveredPackage[] = [];

  for (const pkg of packages) {
    if (SKIP_NAMES.has(pkg.name)) continue;

    const tsPath = path.join(pkg.absDir, "tsconfig.json");
    const ts = readJsonc(tsPath);

    const depNames = [...(edges.get(pkg.name) ?? [])];
    const refs = depNames
      .map((depName) => ({
        path: path.relative(pkg.absDir, byName.get(depName)!.absDir),
      }))
      .toSorted((a, b) => a.path.localeCompare(b.path));

    ts.references = refs.length > 0 ? refs : undefined;
    if (ts.references === undefined) delete ts.references;

    if (writeJson(tsPath, ts)) {
      driftedFiles.push(path.relative(ROOT, tsPath));
    }
    updatedPackages++;
    compilable.push(pkg);
  }

  // Write root solution tsconfig.json — references every compilable
  // package, no own files. `tsgo -b` against this builds the full graph.
  const rootRefs = compilable
    .map((p) => ({ path: `./${p.relDir}` }))
    .toSorted((a, b) => a.path.localeCompare(b.path));

  const rootTsConfig: TsConfig = {
    // Solution-style: no files of our own, just references.
    compilerOptions: {
      noEmit: true,
      composite: false,
    },
    files: [] as never,
    include: [] as never,
    references: rootRefs,
  } as unknown as TsConfig;
  if (writeJson(path.join(ROOT, "tsconfig.json"), rootTsConfig)) {
    driftedFiles.push("tsconfig.json");
  }

  if (CHECK_ONLY) {
    if (driftedFiles.length === 0) {
      console.log("✓ tsconfig references are up to date.");
      return;
    }
    console.error(
      `❌ ${driftedFiles.length} tsconfig file(s) are out of sync with package.json deps:`,
    );
    for (const file of driftedFiles) console.error(`   - ${file}`);
    console.error(
      "\nRun `bun run typecheck:references:generate` and commit the changes.",
    );
    process.exit(1);
  }

  console.log(
    `✓ Updated references in ${updatedPackages} packages, root tsconfig.json with ${rootRefs.length} references.` +
      (driftedFiles.length > 0
        ? ` Modified ${driftedFiles.length} file(s).`
        : " No changes."),
  );
}

await main();
