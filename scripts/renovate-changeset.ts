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
 * Accumulation across an unreleased window: the changeset uses a single fixed
 * filename that this script OVERWRITES on every refresh. If the diff base were
 * the current base branch, a still-PENDING refresh (one merged to main whose
 * `changeset-release/main` "Version Packages" PR has not merged yet) would be
 * silently clobbered: main already carries the previous refresh's resolutions,
 * so a fresh diff sees only the small incremental delta and the overwrite drops
 * the ~100 pending entries - in the worst case (empty/dev-only delta) deleting
 * the pending changeset and CANCELLING a needed release. So the caller passes
 * the changeset as it currently exists ON THE BASE BRANCH via `--pending`, and
 * the incremental diff is UNIONED into its dep list (`mergeChangeset`): every
 * still-unreleased bump is preserved and this refresh's changes are chained on
 * top, so the audit body is complete across the whole window. The presence of a
 * pending changeset also keeps the file alive when THIS refresh is a no-op /
 * dev-only, which is what actually closes the release-cancelling hole. The
 * result stays a pure function of (base lock, head lock, pending changeset) so
 * the `--check` drift guard is unaffected; and because the pending file is read
 * from the base branch and NOT from the branch's own prior output, re-running on
 * a Renovate force-push does not double-accumulate. (The frontmatter owners are
 * always the fixed image anchors - see `CHANGESET_IMAGE_ANCHORS` - not the
 * unioned pending owners, so re-anchoring shrinks an over-fanned pending release
 * down to the anchors on the next regeneration.)
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

/**
 * Published packages whose version is STAMPED from `@checkstack/release`, not
 * driven by changesets - a changeset must NEVER reference them (plan §7.3, and
 * enforced by `generate:sdk:check`). They are public, so the `isPublic` filter
 * does not catch them; they must be excluded explicitly. `@checkstack/release`
 * is itself private (already excluded) but is listed for clarity.
 */
export const CHANGESET_STAMPED_PACKAGES = new Set<string>([
  "@checkstack/sdk",
  "@checkstack/release",
]);

/**
 * The public package(s) the changeset bumps purely to TRIGGER the Docker image
 * rebuild. `release.yml` builds the image only when `changesets/action` actually
 * PUBLISHED a public package, so the changeset needs at least one public bump to
 * fire. It does NOT need one per affected package: every workspace publishes RAW
 * SOURCE and resolves its transitive deps from `package.json` ranges at the
 * consumer's install time, so a lock-file refresh changes NO published artifact
 * - only the image, which is built `--frozen-lockfile`. Charging every reachable
 * owner would republish ~100 packages with identical code per refresh for zero
 * consumer benefit; a fixed anchor set representing the deployable (server + web)
 * is the minimal honest trigger. The changed dependencies are still itemised in
 * the changeset BODY as the audit trail - they just land in these anchors'
 * changelogs instead of a hundred. The owner-attribution graph below is retained
 * ONLY as the shippability gate: "does any changed dep reach a PUBLIC PROD
 * package?" (i.e. is the production image affected at all).
 */
export const CHANGESET_IMAGE_ANCHORS = ["@checkstack/backend", "@checkstack/frontend"] as const;

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

/** The load-bearing content of a rendered changeset: its owners and dep bumps. */
export interface PendingChangeset {
  owners: string[];
  changes: DepChange[];
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
    if (CHANGESET_STAMPED_PACKAGES.has(ws.name)) continue;
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

/**
 * Recover the `{ owners, changes }` from a previously-rendered changeset. This
 * is the inverse of `renderChangeset` over the load-bearing fields: frontmatter
 * `"name": patch` lines become owners and `- \`name\` from -> to` body lines
 * become dep changes. Robust to an empty/absent file (`git show` of a path that
 * does not exist on the base branch) - returns an empty pending set.
 */
export function parsePendingChangeset({ raw }: { raw: string }): PendingChangeset {
  const owners: string[] = [];
  const changes: DepChange[] = [];

  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatter) {
    for (const line of frontmatter[1].split("\n")) {
      const owner = line.match(/^"(.+)":\s*patch\s*$/);
      if (owner) owners.push(owner[1]);
    }
  }
  for (const line of raw.split("\n")) {
    const change = line.match(/^- `([^`]+)` (\S+) -> (\S+)\s*$/);
    if (change) changes.push({ name: change[1], from: change[2], to: change[3] });
  }

  return {
    owners: [...new Set(owners)].toSorted(),
    changes: changes.toSorted((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Union a still-pending changeset with this refresh's incremental diff. Owners
 * are the sorted union of both lists. Dep bumps are keyed by name: a dep in BOTH
 * chains the pending `from` to the incremental `to` (the true span across the
 * unreleased window); a dep in only one side is carried as-is. A bump that nets
 * to `from === to` (an incremental rollback of a pending bump) is dropped so the
 * list never shows a no-op `x -> x` line.
 */
export function mergeChangeset({
  pending,
  incremental,
}: {
  pending: PendingChangeset;
  incremental: PendingChangeset;
}): PendingChangeset {
  const owners = [...new Set([...pending.owners, ...incremental.owners])].toSorted();

  const byName = new Map<string, DepChange>();
  for (const change of pending.changes) byName.set(change.name, change);
  for (const change of incremental.changes) {
    const prev = byName.get(change.name);
    byName.set(change.name, { name: change.name, from: prev?.from ?? change.from, to: change.to });
  }

  const changes = [...byName.values()]
    .filter((change) => change.from !== change.to)
    .toSorted((a, b) => a.name.localeCompare(b.name));

  return { owners, changes };
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

/**
 * The changeset content the current lockfiles SHOULD produce - or `null` when no
 * changeset is warranted (no resolution changes, or only private / dev-only
 * owners). Pure over its inputs so both write and `--check` share one source of
 * truth.
 */
export function expectedChangeset({
  base,
  head,
  isPublic,
  pending = null,
  anchors = CHANGESET_IMAGE_ANCHORS,
}: {
  base: ParsedLock;
  head: ParsedLock;
  isPublic: (workspaceName: string) => boolean;
  /** The changeset as it exists on the BASE branch, so a pending (unreleased)
   *  refresh is unioned in rather than clobbered. Omit / null when none exists. */
  pending?: PendingChangeset | null;
  /** Public packages bumped to trigger the image rebuild (see
   *  `CHANGESET_IMAGE_ANCHORS`). Injectable for tests. */
  anchors?: readonly string[];
}): { changes: DepChange[]; owners: string[]; content: string | null } {
  const incrementalChanges = diffPackages({ base, head });
  // Gate only: does this refresh move a dep that reaches a PUBLIC PROD package,
  // i.e. is the production image affected? The owners themselves are discarded -
  // the emitted owner set is the fixed anchor(s), not the reachable closure.
  const incrementalAffectsImage =
    resolveOwners({ head, changes: incrementalChanges, isPublic }).length > 0;

  const pendingSet = pending ?? { owners: [], changes: [] };
  // BODY: union the full lockfile diff across the unreleased window as the audit
  // trail (prod + dev lines, chained, net-zero rollbacks dropped). Owners are
  // ignored here; they are the fixed anchors below.
  const { changes } = mergeChangeset({
    pending: { owners: [], changes: pendingSet.changes },
    incremental: { owners: [], changes: incrementalChanges },
  });

  // A pending changeset is an in-flight, still-unreleased refresh we must never
  // silently cancel, so its mere presence keeps the changeset alive even when
  // THIS refresh is a no-op / dev-only. Combined with the image gate above, this
  // is what closes the release-cancelling hole.
  const pendingIsShippable = pendingSet.owners.length > 0 || pendingSet.changes.length > 0;
  const owners = incrementalAffectsImage || pendingIsShippable ? [...anchors] : [];

  const content = owners.length === 0 ? null : renderChangeset({ owners, changes });
  return { changes, owners, content };
}

/**
 * Verdict of comparing the committed changeset against a fresh generation.
 * `ok: false` is a hard CI failure - the guard that keeps automerge from
 * shipping a lockfile refresh whose changeset is missing, stale, or drifted.
 */
export function checkChangeset({
  expected,
  actual,
}: {
  expected: string | null;
  actual: string | null;
}): { ok: boolean; reason?: string } {
  if (expected === null) {
    return actual === null
      ? { ok: true }
      : { ok: false, reason: "a changeset is committed but none is warranted (no public prod owner changed); it should be removed" };
  }
  if (actual === null) {
    return { ok: false, reason: "no changeset is committed, but this refresh affects public prod packages; the generator must run" };
  }
  return actual.trim() === expected.trim()
    ? { ok: true }
    : { ok: false, reason: "the committed changeset does not match a fresh generation (drift); re-run the generator" };
}

interface Args {
  base: string;
  head: string;
  out: string;
  pending?: string;
  dryRun: boolean;
  check: boolean;
}

function parseArgs({ argv }: { argv: string[] }): Args {
  const read = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const base = read("--base");
  const head = read("--head");
  if (!base || !head) {
    throw new Error("usage: renovate-changeset.ts --base <lock> --head <lock> [--out <md>] [--pending <md>] [--dry-run|--check]");
  }
  return {
    base,
    head,
    out: read("--out") ?? ".changeset/renovate-lock-file-maintenance.md",
    pending: read("--pending"),
    dryRun: argv.includes("--dry-run"),
    check: argv.includes("--check"),
  };
}

/** Read each workspace's `private` flag from disk (bun.lock does not record it). */
async function readIsPublic({ head }: { head: ParsedLock }): Promise<(name: string) => boolean> {
  const privateByName = new Map<string, boolean>();
  for (const ws of head.workspaces) {
    const manifest = path.join(ws.dir, "package.json");
    if (!existsSync(manifest)) continue;
    const parsed = z
      .looseObject({ private: z.boolean().default(false) })
      .parse(JSON.parse(await readFile(manifest, "utf8")));
    privateByName.set(ws.name, parsed.private);
  }
  return (name: string): boolean => privateByName.get(name) === false;
}

async function main(): Promise<void> {
  const args = parseArgs({ argv: Bun.argv.slice(2) });

  const base = parseLock({ raw: await readFile(args.base, "utf8") });
  const head = parseLock({ raw: await readFile(args.head, "utf8") });
  const isPublic = await readIsPublic({ head });

  // The changeset as it currently exists on the base branch. A pending
  // (unreleased) refresh MUST be unioned in, not clobbered - see file header.
  const pending =
    args.pending && existsSync(args.pending)
      ? parsePendingChangeset({ raw: await readFile(args.pending, "utf8") })
      : null;

  const { changes, owners, content } = expectedChangeset({ base, head, isPublic, pending });

  console.log(`${changes.length} resolution change(s), ${owners.length} image anchor(s).`);

  // --check: the CI drift guard. The committed changeset MUST match a fresh
  // generation, or automerge could ship a lockfile refresh that never releases.
  if (args.check) {
    const actual = existsSync(args.out) ? await readFile(args.out, "utf8") : null;
    const verdict = checkChangeset({ expected: content, actual });
    if (!verdict.ok) {
      console.error(`\n❌ changeset check failed: ${verdict.reason}`);
      console.error(`   run: bun run scripts/renovate-changeset.ts --base <base bun.lock> --head bun.lock`);
      process.exitCode = 1;
      return;
    }
    console.log("✓ committed changeset matches a fresh generation.");
    return;
  }

  if (content === null) {
    console.log("Nothing shippable changed (no resolution changes, or only private / dev-only owners); no changeset.");
    if (!args.dryRun && existsSync(args.out)) await rm(args.out);
    return;
  }

  if (args.dryRun) {
    console.log(`\nowners (${owners.length}): ${owners.join(", ")}`);
    console.log(`\n--- ${args.out} ---\n${content}`);
    return;
  }
  await writeFile(args.out, content, "utf8");
  console.log(`wrote ${args.out} (${owners.length} owners)`);
}

if (import.meta.main) {
  await main();
}
