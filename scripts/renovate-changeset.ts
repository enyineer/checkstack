#!/usr/bin/env bun
/**
 * Changeset generator for Renovate's lock-file-maintenance PR.
 *
 * Background: `lockFileMaintenance` rewrites ONLY `bun.lock`, never a
 * `package.json` range. That means nothing changes for npm consumers - they
 * resolve `tar` from the `^7.5.16` range in the published package.json and get
 * whatever satisfies it. So a republish is not needed for correctness.
 *
 * The Docker image is the opposite: it is built with `--frozen-lockfile`, so it
 * bakes in exactly the resolutions in `bun.lock`. That image is the artifact
 * carrying a vulnerable transitive dependency, and its tag is stamped from
 * `@checkstack/release`'s version. `release.yml` only builds it when
 * `changesets/action` actually PUBLISHED a public package, and
 * `scripts/inject-release.ts` only bumps `@checkstack/release` when some
 * changeset exists. Net effect: a lockfile-only PR merges to main, publishes
 * nothing, rebuilds nothing, and the fix never ships. Hence this script.
 *
 * Attribution: a changed transitive package is charged to its NEAREST workspace
 * ancestors - the workspace packages that directly declare the external
 * dependency through which it is reached. Walking the full closure instead
 * would charge `brace-expansion` to essentially every package in the monorepo;
 * the nearest-ancestor set is small and semantically right (`fast-uri` arrives
 * via `ajv`, so it lands on the frontend packages that declare `ajv`).
 *
 * Two filters keep the result honest:
 *   - PRIVATE workspace packages are excluded. They never publish, so they
 *     cannot flip `changesets/action`'s `published` output, and naming them
 *     would not trigger the image build.
 *   - `devDependencies`-only edges are excluded. The image is built with
 *     `bun install --production`, so a dev-only resolution change cannot alter
 *     any shipped artifact. When a refresh touches only dev-only deps, this
 *     script writes NO changeset - correctly producing no release.
 *
 * Usage:
 *   bun run scripts/renovate-changeset.ts --base <bun.lock> --head <bun.lock>
 *                                         [--out <changeset.md>] [--dry-run]
 */

import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const DepMapSchema = z.record(z.string(), z.string());

const WorkspaceEntrySchema = z.object({
  name: z.string().optional(),
  dependencies: DepMapSchema.optional(),
  devDependencies: DepMapSchema.optional(),
});

/**
 * A `packages` entry is a positional tuple: `[id, registry, meta, integrity]`.
 * Only `id` ("name@version") and `meta.dependencies` are load-bearing here.
 */
const PackageMetaSchema = z.looseObject({
  dependencies: DepMapSchema.optional(),
  optionalDependencies: DepMapSchema.optional(),
});

const LockSchema = z.object({
  workspaces: z.record(z.string(), WorkspaceEntrySchema),
  packages: z.record(z.string(), z.array(z.unknown())).default({}),
});

export interface LockPackage {
  version: string;
  deps: string[];
}

export interface WorkspaceEntry {
  dir: string;
  name: string;
  prodDeps: string[];
  devDeps: string[];
}

export interface ParsedLock {
  packages: Map<string, LockPackage>;
  workspaces: WorkspaceEntry[];
}

export interface DepChange {
  name: string;
  from: string;
  to: string;
}

const isWorkspaceLink = (range: string): boolean => range.startsWith("workspace:");

/** `@scope/pkg@1.2.3` -> `{ name: "@scope/pkg", version: "1.2.3" }` */
export function splitId({ id }: { id: string }): { name: string; version: string } {
  const at = id.lastIndexOf("@");
  if (at <= 0) return { name: id, version: "" };
  return { name: id.slice(0, at), version: id.slice(at + 1) };
}

/**
 * `bun.lock` is JSONC: it carries trailing commas that `JSON.parse` rejects.
 * Strip only a comma directly preceding a closing brace/bracket.
 */
export function parseLock({ raw }: { raw: string }): ParsedLock {
  const stripped = raw.replaceAll(/,(\s*[}\]])/g, "$1");
  const lock = LockSchema.parse(JSON.parse(stripped));

  const packages = new Map<string, LockPackage>();
  for (const entry of Object.values(lock.packages)) {
    const id = z.string().parse(entry[0]);
    const { name, version } = splitId({ id });
    const metaResult = PackageMetaSchema.safeParse(entry[2] ?? {});
    const meta = metaResult.success ? metaResult.data : {};
    const deps = [
      ...Object.keys(meta.dependencies ?? {}),
      ...Object.keys(meta.optionalDependencies ?? {}),
    ];
    // A name can appear at several nested paths; union their edges.
    const prev = packages.get(name);
    packages.set(name, {
      version: prev?.version ?? version,
      deps: prev ? [...new Set([...prev.deps, ...deps])] : deps,
    });
  }

  const workspaces: WorkspaceEntry[] = [];
  for (const [dir, entry] of Object.entries(lock.workspaces)) {
    if (!dir || !entry.name) continue;
    const external = (deps: Record<string, string> | undefined): string[] =>
      Object.entries(deps ?? {})
        .filter(([, range]) => !isWorkspaceLink(range))
        .map(([name]) => name);
    workspaces.push({
      dir,
      name: entry.name,
      prodDeps: external(entry.dependencies),
      devDeps: external(entry.devDependencies),
    });
  }

  return { packages, workspaces };
}

/** External packages whose resolved version differs between the two lockfiles. */
export function diffPackages({ base, head }: { base: ParsedLock; head: ParsedLock }): DepChange[] {
  const changes: DepChange[] = [];
  for (const [name, headPkg] of head.packages) {
    const basePkg = base.packages.get(name);
    if (!basePkg || basePkg.version === headPkg.version) continue;
    changes.push({ name, from: basePkg.version, to: headPkg.version });
  }
  return changes.toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every external package that can reach `target` through external-only edges,
 * `target` included. These are the candidate names a workspace might declare.
 */
export function reachableAncestors({
  lock,
  target,
}: {
  lock: ParsedLock;
  target: string;
}): Set<string> {
  const reverse = new Map<string, Set<string>>();
  for (const [name, pkg] of lock.packages) {
    for (const dep of pkg.deps) {
      const parents = reverse.get(dep) ?? new Set<string>();
      parents.add(name);
      reverse.set(dep, parents);
    }
  }

  const seen = new Set<string>([target]);
  const stack = [target];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const parent of reverse.get(current) ?? []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      stack.push(parent);
    }
  }
  return seen;
}

/**
 * Public workspace packages that reach `target` through a PROD dependency.
 * `isPublic` is injected so the graph logic stays pure and testable.
 */
export function owningWorkspaces({
  lock,
  target,
  isPublic,
}: {
  lock: ParsedLock;
  target: string;
  isPublic: (workspaceName: string) => boolean;
}): string[] {
  const ancestors = reachableAncestors({ lock, target });
  const owners = new Set<string>();
  for (const ws of lock.workspaces) {
    if (!isPublic(ws.name)) continue;
    if (ws.prodDeps.some((dep) => ancestors.has(dep))) owners.add(ws.name);
  }
  return [...owners].toSorted();
}

export function renderChangeset({
  owners,
  changes,
}: {
  owners: string[];
  changes: DepChange[];
}): string {
  const frontmatter = owners.map((name) => `"${name}": patch`).join("\n");
  const lines = changes.map((c) => `- \`${c.name}\` ${c.from} -> ${c.to}`).join("\n");
  return [
    "---",
    frontmatter,
    "---",
    "",
    "Refresh `bun.lock` to the newest versions permitted by the existing semver",
    "ranges (Renovate lock-file maintenance). No `package.json` range changed, so",
    "this only affects the resolutions baked into the production image.",
    "",
    "Updated dependencies:",
    "",
    lines,
    "",
  ].join("\n");
}

/** Owners for the whole change set, unioned across every changed package. */
export function resolveOwners({
  head,
  changes,
  isPublic,
}: {
  head: ParsedLock;
  changes: DepChange[];
  isPublic: (workspaceName: string) => boolean;
}): string[] {
  const owners = new Set<string>();
  for (const change of changes) {
    for (const owner of owningWorkspaces({ lock: head, target: change.name, isPublic })) {
      owners.add(owner);
    }
  }
  return [...owners].toSorted();
}

interface Args {
  base: string;
  head: string;
  out: string;
  dryRun: boolean;
}

function parseArgs({ argv }: { argv: string[] }): Args {
  const read = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const base = read("--base");
  const head = read("--head");
  if (!base || !head) {
    throw new Error("usage: renovate-changeset.ts --base <lock> --head <lock> [--out <md>] [--dry-run]");
  }
  return {
    base,
    head,
    out: read("--out") ?? ".changeset/renovate-lock-file-maintenance.md",
    dryRun: argv.includes("--dry-run"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs({ argv: Bun.argv.slice(2) });

  const base = parseLock({ raw: await readFile(args.base, "utf8") });
  const head = parseLock({ raw: await readFile(args.head, "utf8") });
  const changes = diffPackages({ base, head });

  if (changes.length === 0) {
    console.log("No resolution changes in bun.lock - nothing to do.");
    if (!args.dryRun && existsSync(args.out)) await rm(args.out);
    return;
  }

  // Privacy is read from disk: bun.lock does not record it.
  const privateByName = new Map<string, boolean>();
  for (const ws of head.workspaces) {
    const manifest = path.join(ws.dir, "package.json");
    if (!existsSync(manifest)) continue;
    const parsed = z
      .looseObject({ private: z.boolean().default(false) })
      .parse(JSON.parse(await readFile(manifest, "utf8")));
    privateByName.set(ws.name, parsed.private);
  }
  const isPublic = (name: string): boolean => privateByName.get(name) === false;

  const owners = resolveOwners({ head, changes, isPublic });

  console.log(`${changes.length} resolution change(s):`);
  for (const c of changes) console.log(`  ${c.name} ${c.from} -> ${c.to}`);

  if (owners.length === 0) {
    console.log(
      "\nNo public workspace package reaches any changed dependency through a\n" +
        "prod edge. Nothing shippable changed; writing no changeset.",
    );
    if (!args.dryRun && existsSync(args.out)) await rm(args.out);
    return;
  }

  console.log(`\nowners (${owners.length}): ${owners.join(", ")}`);
  const content = renderChangeset({ owners, changes });

  if (args.dryRun) {
    console.log(`\n--- ${args.out} ---\n${content}`);
    return;
  }
  await writeFile(args.out, content, "utf8");
  console.log(`\nwrote ${args.out}`);
}

if (import.meta.main) {
  await main();
}
