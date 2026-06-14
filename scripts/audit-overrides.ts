#!/usr/bin/env bun
/**
 * Security-override lifecycle auditor.
 *
 * Background: a `overrides`/`resolutions` entry that pins a transitive package
 * to a fixed version is a stop-gap. Nothing tells you when it can be removed
 * (every consumer updated, the graph now resolves safe on its own) - so they
 * rot into dead weight or, worse, hold a package below a newer safe release.
 * `security/managed-overrides.json` documents each SECURITY override; this
 * script keeps that file honest and detects when an override is redundant.
 *
 * Modes:
 *   --check
 *       Drift guard (fast; runs in PR CI). Fails if a managed override is
 *       missing/mismatched in package.json `overrides` or `resolutions`, or if
 *       its pinned range floor sits below the recorded `safeFloor`.
 *
 *   --redundant [--json]
 *       Re-resolution audit (heavy; runs in the daily security-maintenance
 *       workflow). For each managed override it spins up a throwaway git
 *       worktree, removes that single override, runs `bun install`, and reads
 *       the resolved version(s) back from the worktree's bun.lock. If the graph
 *       still lands at/above `safeFloor` WITHOUT the override, the override is
 *       redundant and reported (as a removable candidate). `--json` emits a
 *       machine-readable report for the workflow to turn into an auto-PR.
 *
 * The pure helpers (parseManifest/findDrift/extractInstalledVersions/
 * isRedundant) are unit-tested in audit-overrides.test.ts; the worktree +
 * install orchestration is exercised by the scheduled workflow.
 */

import { $ } from "bun";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import semver from "semver";
import { z } from "zod";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "security", "managed-overrides.json");
const PKG_PATH = path.join(ROOT, "package.json");

// Human-only metadata. The pinned VERSION is intentionally NOT here - it lives
// in package.json `overrides`/`resolutions` (single source of truth).
export const ManagedOverrideMetaSchema = z.object({
  safeFloor: z.string().min(1),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  advisory: z.string().min(1),
  reason: z.string().min(1),
  addedAt: z.string().min(1),
  removeWhen: z.string().min(1),
});

export const ManifestSchema = z.object({
  overrides: z.record(z.string().min(1), ManagedOverrideMetaSchema),
});

export type ManagedOverrideMeta = z.infer<typeof ManagedOverrideMetaSchema>;
export type ManagedOverride = ManagedOverrideMeta & { name: string };

export function parseManifest({ raw }: { raw: string }): ManagedOverride[] {
  // `$comment`/`$schema` meta keys are ignored: z.record only validates the
  // `overrides` map. The package name is the map KEY; we fold it back into each
  // entry so callers keep a flat `{ name, ...meta }` shape.
  const parsed: unknown = JSON.parse(raw);
  const { overrides } = ManifestSchema.parse(parsed);
  return Object.entries(overrides).map(([name, meta]) => ({ name, ...meta }));
}

export interface DriftIssue {
  name: string;
  problem: string;
}

/**
 * Each managed override must (a) be present in BOTH package.json `overrides`
 * and `resolutions` (this repo mirrors them), declared identically, and (b)
 * pin a range whose floor is at/above the recorded `safeFloor`. The pinned
 * version is read from package.json - the manifest no longer stores it.
 * Extra package.json overrides NOT in the manifest are intentional pins
 * (react, drizzle, ...) and are ignored here.
 */
export function findDrift({
  manifest,
  overrides,
  resolutions,
}: {
  manifest: ManagedOverride[];
  overrides: Record<string, string>;
  resolutions: Record<string, string>;
}): DriftIssue[] {
  const issues: DriftIssue[] = [];

  for (const entry of manifest) {
    const inOverrides = overrides[entry.name];
    const inResolutions = resolutions[entry.name];

    if (inOverrides === undefined) {
      issues.push({
        name: entry.name,
        problem: `documented in managed-overrides.json but missing from package.json "overrides"`,
      });
    }
    if (inResolutions === undefined) {
      issues.push({
        name: entry.name,
        problem: `documented in managed-overrides.json but missing from package.json "resolutions"`,
      });
    }
    if (
      inOverrides !== undefined &&
      inResolutions !== undefined &&
      inOverrides !== inResolutions
    ) {
      issues.push({
        name: entry.name,
        problem: `"overrides" pins "${inOverrides}" but "resolutions" pins "${inResolutions}" — they must match`,
      });
    }

    // The pinned range (from package.json) must not permit a version below the
    // recorded safe floor.
    if (inOverrides !== undefined) {
      const floor = semver.minVersion(inOverrides);
      if (!floor) {
        issues.push({
          name: entry.name,
          problem: `pinned range "${inOverrides}" is not a parseable semver range`,
        });
      } else if (!semver.valid(entry.safeFloor)) {
        issues.push({
          name: entry.name,
          problem: `safeFloor "${entry.safeFloor}" is not a valid semver version`,
        });
      } else if (semver.lt(floor, entry.safeFloor)) {
        issues.push({
          name: entry.name,
          problem: `pinned range "${inOverrides}" allows ${floor.version}, below safeFloor ${entry.safeFloor}`,
        });
      }
    }
  }

  return issues;
}

/**
 * Extract every resolved version of `name` present in a bun text lockfile.
 * bun.lock keys look like `"name@1.2.3"` and `"parent/name@1.2.3"`; we match
 * the exact package name followed by `@<semver>` and ignore npm aliases
 * (`name@npm:other@...`).
 */
export function extractInstalledVersions({
  lockfileText,
  name,
}: {
  lockfileText: string;
  name: string;
}): string[] {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  // Match `"name@1.2.3"` or `"some/scope/name@1.2.3"` (the leaf after the last
  // slash is the package), capturing the version. Excludes `@npm:` aliases.
  const re = new RegExp(
    String.raw`"(?:[^"]*/)?${escaped}@(\d+\.\d+\.\d+[^"]*)"`,
    "g",
  );
  const versions = new Set<string>();
  for (const match of lockfileText.matchAll(re)) {
    const version = match[1];
    if (version && semver.valid(semver.coerce(version) ?? "")) {
      const clean = semver.valid(version) ?? semver.coerce(version)?.version;
      if (clean) versions.add(clean);
    }
  }
  return [...versions];
}

/**
 * An override is redundant when, with it removed, EVERY resolved copy still
 * sits at/above the safe floor (nothing in the graph pulls a vulnerable
 * version on its own). If no copy resolves at all, the package left the graph
 * entirely - also redundant.
 */
export function isRedundant({
  resolvedVersions,
  safeFloor,
}: {
  resolvedVersions: string[];
  safeFloor: string;
}): boolean {
  if (resolvedVersions.length === 0) return true;
  return resolvedVersions.every((v) => semver.gte(v, safeFloor));
}

interface RedundancyResult {
  name: string;
  redundant: boolean;
  resolvedWithout: string[];
  safeFloor: string;
}

async function simulateRemoval({
  entry,
}: {
  entry: ManagedOverride;
}): Promise<RedundancyResult> {
  const worktree = path.join(ROOT, ".audit-overrides-wt", entry.name);
  rmSync(path.join(ROOT, ".audit-overrides-wt"), {
    recursive: true,
    force: true,
  });

  await $`git worktree add --detach --force ${worktree} HEAD`.quiet();
  try {
    const wtPkgPath = path.join(worktree, "package.json");
    const pkg: {
      overrides?: Record<string, string>;
      resolutions?: Record<string, string>;
    } = JSON.parse(readFileSync(wtPkgPath, "utf8"));
    delete pkg.overrides?.[entry.name];
    delete pkg.resolutions?.[entry.name];
    writeFileSync(wtPkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

    // Plain (non-frozen) install so bun RE-RESOLVES the now-unpinned package
    // and rewrites the worktree's bun.lock. `--no-save`/`--frozen-lockfile`
    // would keep the old lockfile and we'd read the pre-removal versions.
    await $`cd ${worktree} && bun install`.quiet().nothrow();

    const lockfileText = readFileSync(path.join(worktree, "bun.lock"), "utf8");
    const resolvedWithout = extractInstalledVersions({
      lockfileText,
      name: entry.name,
    });

    return {
      name: entry.name,
      redundant: isRedundant({ resolvedVersions: resolvedWithout, safeFloor: entry.safeFloor }),
      resolvedWithout,
      safeFloor: entry.safeFloor,
    };
  } finally {
    await $`git worktree remove --force ${worktree}`.quiet().nothrow();
    rmSync(path.join(ROOT, ".audit-overrides-wt"), {
      recursive: true,
      force: true,
    });
  }
}

/**
 * Remove a set of override names from a package.json-shaped object (both
 * `overrides` and `resolutions`) and from the managed-overrides manifest.
 * Pure: returns the new JSON strings; the caller writes them.
 */
export function applyPrune({
  names,
  pkg,
  manifest,
}: {
  names: string[];
  pkg: {
    overrides?: Record<string, string>;
    resolutions?: Record<string, string>;
    [k: string]: unknown;
  };
  manifest: { overrides: Record<string, unknown>; [k: string]: unknown };
}): { pkg: typeof pkg; manifest: typeof manifest } {
  const toRemove = new Set(names);
  const nextPkg = structuredClone(pkg);
  for (const key of ["overrides", "resolutions"] as const) {
    const block = nextPkg[key];
    if (!block) continue;
    for (const name of toRemove) delete block[name];
  }
  const nextManifest = structuredClone(manifest);
  for (const name of toRemove) delete nextManifest.overrides[name];
  return { pkg: nextPkg, manifest: nextManifest };
}

async function runCheck(): Promise<void> {
  const manifest = parseManifest({ raw: readFileSync(MANIFEST_PATH, "utf8") });
  const pkg: {
    overrides?: Record<string, string>;
    resolutions?: Record<string, string>;
  } = JSON.parse(readFileSync(PKG_PATH, "utf8"));

  const issues = findDrift({
    manifest,
    overrides: pkg.overrides ?? {},
    resolutions: pkg.resolutions ?? {},
  });

  if (issues.length > 0) {
    console.error("❌ Managed-override drift detected:\n");
    for (const issue of issues) {
      console.error(`   - ${issue.name}: ${issue.problem}`);
    }
    console.error(
      "\nFix package.json overrides/resolutions or security/managed-overrides.json so they agree.",
    );
    process.exit(1);
  }

  console.log(
    `✓ ${manifest.length} managed security override(s) are documented and consistent.`,
  );
}

async function runRedundant(): Promise<void> {
  const asJson = process.argv.includes("--json");
  const manifest = parseManifest({ raw: readFileSync(MANIFEST_PATH, "utf8") });

  const results: RedundancyResult[] = [];
  for (const entry of manifest) {
    results.push(await simulateRemoval({ entry }));
  }

  const redundant = results.filter((r) => r.redundant);

  if (asJson) {
    console.log(JSON.stringify({ redundant, all: results }, null, 2));
    return;
  }

  if (redundant.length === 0) {
    console.log("✓ All managed overrides are still required.");
    return;
  }

  console.log(`Found ${redundant.length} redundant override(s) (safe to remove):\n`);
  for (const r of redundant) {
    const detail =
      r.resolvedWithout.length === 0
        ? "package no longer in the graph"
        : `graph resolves ${r.resolvedWithout.join(", ")} >= ${r.safeFloor}`;
    console.log(`   - ${r.name}: ${detail}`);
  }
}

async function runPrune(): Promise<void> {
  const manifest = parseManifest({ raw: readFileSync(MANIFEST_PATH, "utf8") });

  const redundantNames: string[] = [];
  for (const entry of manifest) {
    const result = await simulateRemoval({ entry });
    if (result.redundant) redundantNames.push(entry.name);
  }

  if (redundantNames.length === 0) {
    console.log("✓ No redundant overrides to prune.");
    return;
  }

  const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
  const rawManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const { pkg: nextPkg, manifest: nextManifest } = applyPrune({
    names: redundantNames,
    pkg,
    manifest: rawManifest,
  });

  writeFileSync(PKG_PATH, `${JSON.stringify(nextPkg, null, 2)}\n`);
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(nextManifest, null, 2)}\n`);

  console.log(`Pruned ${redundantNames.length} redundant override(s): ${redundantNames.join(", ")}`);
  console.log("Run `bun install` to update the lockfile.");
}

if (import.meta.main) {
  const mode = process.argv[2];
  switch (mode) {
  case "--check": {
    await runCheck();
  
  break;
  }
  case "--redundant": {
    await runRedundant();
  
  break;
  }
  case "--prune": {
    await runPrune();
  
  break;
  }
  default: {
    console.error(
      "Usage: bun run scripts/audit-overrides.ts <--check | --redundant [--json] | --prune>",
    );
    process.exit(1);
  }
  }
}
