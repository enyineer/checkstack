#!/usr/bin/env bun
/**
 * Auto-remediate FIXABLE vulnerabilities found by the Security Maintenance scan.
 *
 * Reads the combined Trivy findings the workflow's "Build CVE report" step writes
 * (`[{ id, pkg, installed, fixed, sev }]`, where `fixed` may be a comma list like
 * "7.6.1, 8.4.1"). For each affected package it picks the lowest fixed version
 * WITHIN THE INSTALLED MAJOR — never an automatic major bump, which is the
 * `@grpc/proto-loader` trap (forcing protobufjs 8 breaks a consumer pinned to
 * ^7) — that satisfies every advisory for that package, then applies the
 * least-invasive fix:
 *   - a package already pinned by a managed override -> raise the override;
 *   - a direct dependency whose declared range already allows the fix
 *     -> `bun update <pkg>` (just refresh the lockfile);
 *   - otherwise (tight range, or transitive) -> add a documented managed
 *     override forcing the fixed version.
 * Packages whose ONLY fix is a major bump are reported as "manual" and left for
 * a human (a major bump can break consumers in ways unit tests don't catch).
 *
 * Auto-GENERATE, never auto-MERGE: the changes go into a PR that must pass the
 * full CI (typecheck/lint/test/build + the Security gate) before a human merges.
 *
 * Modes:
 *   <vulns.json>              apply remediations, write summaries, refresh lockfile
 *   <vulns.json> --dry-run    plan only; print the plan, change nothing
 */

import { Glob } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import semver from "semver";
import { z } from "zod";

const ROOT = path.resolve(import.meta.dirname, "..");
const PKG_PATH = path.join(ROOT, "package.json");
const MANIFEST_PATH = path.join(ROOT, "security", "managed-overrides.json");
// Stable name so re-runs overwrite the same changeset (the PR branch is recreated
// each run anyway).
const CHANGESET_PATH = path.join(ROOT, ".changeset", "auto-security-remediation.md");
// When a round touches ONLY transitive deps (no publishable package declares
// them), bump this package so a release still ships the image rebuild that
// carries the override fixes.
const FALLBACK_RELEASE_PACKAGE = "@checkstack/backend";

const SEVERITY_RANK: Record<string, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

// The dependency blocks a range can live in. `as const` so members narrow to a
// union (used to index a manifest without a cast).
const DEP_BLOCKS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
type DepBlock = (typeof DEP_BLOCKS)[number];

// A partial view of a package.json. JSON.parse keeps every other field at
// runtime (so write-back is lossless); this just types the bits we touch, so
// `manifest[block]` indexes without a cast.
interface PkgManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
  resolutions?: Record<string, string>;
}

const MANIFEST_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

/** Trivy can emit "UNKNOWN"; the managed-overrides manifest only allows the four
 *  canonical levels, so clamp anything else to MEDIUM (don't under-rate). */
export function toManifestSeverity(sev: string): (typeof MANIFEST_SEVERITIES)[number] {
  for (const s of MANIFEST_SEVERITIES) if (s === sev) return s;
  return "MEDIUM";
}

export interface SecurityEntry {
  safeFloor: string;
  severity: string;
  advisory: string;
  reason: string;
  addedAt: string;
  removeWhen: string;
}

/**
 * Merge a remediation into a `security` manifest entry. For a NEW entry, build a
 * fully-documented one. For an EXISTING (curated) entry, preserve its human
 * fields (severity, advisory, reason) and only RAISE the floor — never lower it,
 * never clobber the curation. Returns the entry plus the floor the override
 * range should use.
 */
export function mergeSecurityEntry({
  existing,
  target,
  severity,
  advisory,
  reason,
  today,
}: {
  existing: SecurityEntry | undefined;
  target: string;
  severity: string;
  advisory: string;
  reason: string;
  today: string;
}): { entry: SecurityEntry; floor: string } {
  if (!existing) {
    const entry: SecurityEntry = {
      safeFloor: target,
      severity: toManifestSeverity(severity),
      advisory,
      reason,
      addedAt: today,
      removeWhen: `No dependency resolves below ${target} without this override.`,
    };
    return { entry, floor: target };
  }
  // Raise the floor to the higher of the two; keep the curated metadata.
  const floor = semver.gt(target, existing.safeFloor) ? target : existing.safeFloor;
  return { entry: { ...existing, safeFloor: floor }, floor };
}

export const FindingSchema = z.object({
  id: z.string(),
  pkg: z.string(),
  installed: z.string(),
  fixed: z.string(),
  sev: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const VulnsSchema = z.array(FindingSchema);

/** Split Trivy's `FixedVersion` ("7.6.1, 8.4.1") into clean semver strings. */
export function parseFixedList(fixed: string): string[] {
  return fixed
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && semver.valid(v) !== null);
}

/**
 * Lowest fixed version in the SAME major as `installed` and strictly greater
 * than it. Returns null when the only fixes are in a higher major (an auto
 * major bump we refuse to make).
 */
export function pickInMajorFix({
  installed,
  fixedVersions,
}: {
  installed: string;
  fixedVersions: string[];
}): string | null {
  const inst = semver.valid(semver.coerce(installed) ?? "");
  if (!inst) return null;
  const major = semver.major(inst);
  const candidates = fixedVersions
    .filter((v) => semver.valid(v) && semver.major(v) === major && semver.gt(v, inst))
    .toSorted(semver.compare);
  return candidates[0] ?? null;
}

export type Remediation =
  | {
      // range-bump: dep is directly declared in workspace package.json(s) — bump
      //   its declared range so the PUBLISHED package carries the fix and our
      //   lockfile re-resolves (closes the out-of-range gap; keeps syncpack
      //   consistent because every declaration is bumped together).
      // override / override-bump: dep is transitive (or already overridden) —
      //   pin it in the root overrides for our image; npm consumers self-heal.
      pkg: string;
      action: "range-bump" | "override" | "override-bump";
      installed: string;
      target: string;
      severity: string;
      advisory: string;
    }
  | { pkg: string; action: "manual"; installed: string; reason: string; severity: string };

export interface Plan {
  rangeBumps: Remediation[];
  overrides: Remediation[];
  manual: Remediation[];
}

function maxSeverity(severities: string[]): string {
  let best = severities[0] ?? "MEDIUM";
  for (const s of severities) {
    if ((SEVERITY_RANK[s] ?? -1) > (SEVERITY_RANK[best] ?? -1)) best = s;
  }
  return best;
}

/**
 * Group findings by package and decide one remediation per package.
 * - `directlyDeclared`: declared as a dependency of some workspace package, so a
 *   fix belongs in their manifests (range-bump).
 * - `securityOverrides`: already pinned via a MANAGED SECURITY override
 *   (override-bump — raise the floor).
 * - `intentionalOverrides`: pinned deliberately (react singleton, drizzle
 *   alignment). Auto-bumping would fight the intent, so route to MANUAL.
 * A dep can be both a security override AND directly declared — then we do both
 * (raise the override for our image AND bump the published range for consumers).
 */
export function planAll({
  findings,
  directlyDeclared,
  securityOverrides,
  intentionalOverrides,
}: {
  findings: Finding[];
  directlyDeclared: Set<string>;
  securityOverrides: Set<string>;
  intentionalOverrides: Set<string>;
}): Plan {
  const byPkg = new Map<string, Finding[]>();
  for (const f of findings) {
    if (f.fixed.trim().length === 0) continue;
    const list = byPkg.get(f.pkg) ?? [];
    list.push(f);
    byPkg.set(f.pkg, list);
  }

  const plan: Plan = { rangeBumps: [], overrides: [], manual: [] };

  for (const [pkg, group] of [...byPkg.entries()].toSorted()) {
    // Use the lowest installed copy so the fix covers every occurrence.
    const installed = group
      .map((f) => f.installed)
      .toSorted(semver.compare)[0]!;
    const severity = maxSeverity(group.map((f) => f.sev));
    const advisory = [...new Set(group.map((f) => f.id))].toSorted().join(", ");

    // Each advisory needs its own in-major fix; the package target is the
    // highest of those minimums so it clears them all. If ANY advisory has no
    // in-major fix, the package can't be fully fixed without a major bump.
    // A deliberate, non-security pin (react, drizzle, ...) — never auto-bump.
    if (intentionalOverrides.has(pkg)) {
      plan.manual.push({
        pkg,
        action: "manual",
        installed,
        severity,
        reason: "pinned intentionally (not a security override) — bump manually if appropriate",
      });
      continue;
    }

    const perCve = group.map((f) =>
      pickInMajorFix({ installed, fixedVersions: parseFixedList(f.fixed) }),
    );
    if (perCve.includes(null)) {
      plan.manual.push({
        pkg,
        action: "manual",
        installed,
        severity,
        reason: "only a major-version fix is available — bump manually",
      });
      continue;
    }
    const inMajorTargets = perCve.filter((v): v is string => v !== null);
    const target = inMajorTargets.toSorted(semver.compare).at(-1)!;

    const isSecurityOverride = securityOverrides.has(pkg);
    const isDeclared = directlyDeclared.has(pkg);
    if (isSecurityOverride) {
      plan.overrides.push({ pkg, action: "override-bump", installed, target, severity, advisory });
    }
    if (isDeclared) {
      plan.rangeBumps.push({ pkg, action: "range-bump", installed, target, severity, advisory });
    }
    if (!isSecurityOverride && !isDeclared) {
      plan.overrides.push({ pkg, action: "override", installed, target, severity, advisory });
    }
  }

  return plan;
}

export interface Declaration {
  file: string;
  block: DepBlock;
  pkgName: string;
  isPrivate: boolean;
}

export interface RangeEdit {
  file: string;
  block: DepBlock;
  name: string;
  range: string;
}

/**
 * The concrete (file, block, name, range) edits a set of range-bumps implies —
 * one per declaration site so EVERY manifest/block is moved together (the bit
 * that keeps syncpack's unified groups consistent). Pure, so it's unit-tested.
 */
export function computeRangeBumpEdits({
  rangeBumps,
  declarationsByDep,
}: {
  rangeBumps: Remediation[];
  declarationsByDep: Record<string, Declaration[]>;
}): RangeEdit[] {
  const edits: RangeEdit[] = [];
  for (const r of rangeBumps) {
    if (r.action !== "range-bump") continue;
    for (const d of declarationsByDep[r.pkg] ?? []) {
      edits.push({ file: d.file, block: d.block, name: r.pkg, range: `^${r.target}` });
    }
  }
  return edits;
}

/**
 * Publishable packages to bump in the remediation changeset: every publishable
 * workspace package whose manifest we range-bumped (its declared dep changed, so
 * its published artifact carries the fix). If a round is all-overrides (no
 * manifest changed), fall back to a single platform package so a release still
 * ships the image rebuild that carries the override fixes.
 */
export function collectChangesetPackages({
  plan,
  declarationsByDep,
  fallbackPackage,
}: {
  plan: Plan;
  declarationsByDep: Record<string, Declaration[]>;
  fallbackPackage: string;
}): string[] {
  const names = new Set<string>();
  for (const r of plan.rangeBumps) {
    for (const d of declarationsByDep[r.pkg] ?? []) {
      if (!d.isPrivate) names.add(d.pkgName);
    }
  }
  if (names.size === 0 && [...plan.rangeBumps, ...plan.overrides].length > 0) {
    names.add(fallbackPackage);
  }
  return [...names].toSorted();
}

/** A changeset (patch, per the BETA never-major rule) documenting the fixes. */
export function renderChangeset({ packages, plan }: { packages: string[]; plan: Plan }): string {
  const frontmatter = packages.map((p) => `"${p}": patch`).join("\n");
  const bullets = [...plan.rangeBumps, ...plan.overrides]
    .filter((r) => r.action !== "manual")
    .map((r) => `- \`${r.pkg}\` ${r.installed} → ${r.target} (${r.advisory})`);
  return [
    "---",
    frontmatter,
    "---",
    "",
    "Security: auto-remediated fixable vulnerabilities flagged by the daily scan.",
    "",
    ...bullets,
    "",
  ].join("\n");
}

// ---- orchestration (not unit-tested; exercised by the workflow) ----

/**
 * Every place each external dependency is declared across the workspace, over
 * all four dependency blocks — a range-bump must touch ALL of them (especially
 * peerDependencies) to keep syncpack's unified groups consistent.
 */
function readWorkspaceDeclarations(): Record<string, Declaration[]> {
  const byDep: Record<string, Declaration[]> = {};
  const glob = new Glob("{core,plugins}/*/package.json");
  for (const file of [...glob.scanSync(ROOT), "package.json"]) {
    const pkg: PkgManifest & { name?: string; private?: boolean } = JSON.parse(
      readFileSync(path.join(ROOT, file), "utf8"),
    );
    for (const block of DEP_BLOCKS) {
      for (const [name, range] of Object.entries(pkg[block] ?? {})) {
        if (range.startsWith("workspace:")) continue;
        (byDep[name] ??= []).push({
          file,
          block,
          pkgName: pkg.name ?? file,
          isPrivate: pkg.private === true,
        });
      }
    }
  }
  return byDep;
}

function renderSummary(plan: Plan): string {
  const lines: string[] = ["Automated by the daily **Security Maintenance** workflow.", ""];
  if (plan.rangeBumps.length > 0) {
    lines.push("## Direct dependency range bumps", "");
    for (const r of plan.rangeBumps) {
      if (r.action === "manual") continue;
      lines.push(`- **${r.severity}** \`${r.pkg}\` ${r.installed} → ^${r.target} (${r.advisory})`);
    }
    lines.push("");
  }
  if (plan.overrides.length > 0) {
    lines.push("## Managed security overrides", "");
    for (const r of plan.overrides) {
      if (r.action === "manual") continue;
      const verb = r.action === "override-bump" ? "raised to" : "pinned to";
      lines.push(`- **${r.severity}** \`${r.pkg}\` ${r.installed} → ${verb} ^${r.target} (${r.advisory})`);
    }
    lines.push("");
  }
  if (plan.manual.length > 0) {
    lines.push("## Needs manual attention (major-version fix only)", "");
    for (const r of plan.manual) {
      if (r.action !== "manual") continue;
      lines.push(`- **${r.severity}** \`${r.pkg}\` ${r.installed}: ${r.reason}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const vulnsPath = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!vulnsPath) {
    console.error("Usage: bun run scripts/remediate-vulns.ts <vulns.json> [--dry-run]");
    process.exit(1);
  }

  const findings = VulnsSchema.parse(JSON.parse(readFileSync(vulnsPath, "utf8")));
  const pkg: PkgManifest = JSON.parse(readFileSync(PKG_PATH, "utf8"));
  const manifest: {
    security: Record<string, SecurityEntry>;
    intentional?: Record<string, unknown>;
    [k: string]: unknown;
  } = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

  const declarationsByDep = readWorkspaceDeclarations();
  const plan = planAll({
    findings,
    directlyDeclared: new Set(Object.keys(declarationsByDep)),
    securityOverrides: new Set(Object.keys(manifest.security)),
    intentionalOverrides: new Set(Object.keys(manifest.intentional ?? {})),
  });

  const changesetPackages = collectChangesetPackages({
    plan,
    declarationsByDep,
    fallbackPackage: FALLBACK_RELEASE_PACKAGE,
  });

  const summary = renderSummary(plan);
  writeFileSync("/tmp/remediation-summary.md", `${summary}\n`);
  writeFileSync("/tmp/remediation-manual.json", JSON.stringify(plan.manual, null, 2));
  console.log(summary);
  if (changesetPackages.length > 0) {
    console.log(`Changeset (patch) will bump: ${changesetPackages.join(", ")}`);
  }

  if (dryRun) {
    console.log("\n(dry-run: no files changed)");
    return;
  }

  // Edit every affected package.json through one shared cache (root included, so
  // range-bumps and override edits to it never clobber each other). Only files
  // actually modified are written, to avoid spurious reformatting diffs.
  const parsed = new Map<string, PkgManifest>([["package.json", pkg]]);
  const dirtyFiles = new Set<string>();
  const loadJson = (rel: string): PkgManifest => {
    let json = parsed.get(rel);
    if (!json) {
      json = JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));
      parsed.set(rel, json);
    }
    return json;
  };

  // 1. Range-bumps: raise the declared range in EVERY owning manifest/block so
  //    the published package carries the fix and syncpack stays consistent.
  for (const e of computeRangeBumpEdits({ rangeBumps: plan.rangeBumps, declarationsByDep })) {
    (loadJson(e.file)[e.block] ??= {})[e.name] = e.range;
    dirtyFiles.add(e.file);
  }

  // 2. Overrides: pin transitive deps in the root overrides + document them in
  //    the security manifest (preserving any existing curation; never lowering
  //    a floor or overwriting a higher recorded severity).
  const today = new Date().toISOString().slice(0, 10);
  let manifestDirty = false;
  for (const r of plan.overrides) {
    if (r.action === "manual") continue;
    const { entry, floor } = mergeSecurityEntry({
      existing: manifest.security[r.pkg],
      target: r.target,
      severity: r.severity,
      advisory: r.advisory,
      reason: `Auto-remediated by Security Maintenance: ${r.pkg} ${r.installed} had fixable advisories; pinned to the fixed ${semver.major(r.target)}.x line.`,
      today,
    });
    const range = `^${floor}`;
    pkg.overrides ??= {};
    pkg.resolutions ??= {};
    // Already covered at/above this floor — no change, no churn.
    if (pkg.overrides[r.pkg] === range && pkg.resolutions[r.pkg] === range) continue;
    pkg.overrides[r.pkg] = range;
    pkg.resolutions[r.pkg] = range;
    manifest.security[r.pkg] = entry;
    dirtyFiles.add("package.json");
    manifestDirty = true;
  }

  if (dirtyFiles.size === 0) {
    console.log("Nothing to apply (all findings already covered or manual).");
    return;
  }

  for (const rel of dirtyFiles) {
    writeFileSync(path.join(ROOT, rel), `${JSON.stringify(parsed.get(rel), null, 2)}\n`);
  }
  if (manifestDirty) {
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  // A changeset so the release pipeline versions + publishes the affected
  // packages and rebuilds the Docker image — without it the fixes never ship.
  if (changesetPackages.length > 0) {
    writeFileSync(CHANGESET_PATH, renderChangeset({ packages: changesetPackages, plan }));
  }

  // Re-resolve: range-bumps force bumped deps onto the new floor, overrides are
  // materialized. No `bun update` — running it at the root rewrites root
  // package.json (adds the dep) and breaks syncpack's unified groups.
  await Bun.$`bun install`.cwd(ROOT);
}

if (import.meta.main) {
  await main();
}
