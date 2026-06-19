import { describe, expect, test } from "bun:test";
import {
  collectChangesetPackages,
  computeRangeBumpEdits,
  mergeSecurityEntry,
  parseFixedList,
  pickInMajorFix,
  planAll,
  renderChangeset,
  toManifestSeverity,
  type Declaration,
  type Finding,
  type Plan,
  type SecurityEntry,
} from "./remediate-vulns";

const EMPTY = { directlyDeclared: new Set<string>(), securityOverrides: new Set<string>(), intentionalOverrides: new Set<string>() };

const f = (over: Partial<Finding>): Finding => ({
  id: "CVE-X",
  pkg: "p",
  installed: "1.0.0",
  fixed: "1.0.1",
  sev: "MEDIUM",
  ...over,
});

describe("parseFixedList", () => {
  test("splits a comma list and drops invalid entries", () => {
    expect(parseFixedList("7.6.1, 8.4.1")).toEqual(["7.6.1", "8.4.1"]);
    expect(parseFixedList("3.4.7")).toEqual(["3.4.7"]);
    expect(parseFixedList("")).toEqual([]);
    expect(parseFixedList("not-a-version, 1.2.3")).toEqual(["1.2.3"]);
  });
});

describe("pickInMajorFix", () => {
  test("picks the lowest in-major fix above installed", () => {
    expect(pickInMajorFix({ installed: "7.5.8", fixedVersions: ["7.6.1", "8.4.1"] })).toBe("7.6.1");
  });

  test("returns null when the only fixes are a higher major (no auto major bump)", () => {
    expect(pickInMajorFix({ installed: "7.5.8", fixedVersions: ["8.4.1"] })).toBeNull();
  });

  test("ignores fixes at or below installed", () => {
    expect(pickInMajorFix({ installed: "3.4.7", fixedVersions: ["3.4.6", "3.4.7"] })).toBeNull();
  });

  test("prefers the lowest of several in-major fixes", () => {
    expect(
      pickInMajorFix({ installed: "4.12.23", fixedVersions: ["4.13.0", "4.12.25"] }),
    ).toBe("4.12.25");
  });
});

describe("planAll", () => {
  test("directly-declared dep -> range-bump (regardless of whether the range allows it)", () => {
    const plan = planAll({
      ...EMPTY,
      findings: [f({ pkg: "hono", installed: "4.12.23", fixed: "4.12.25", sev: "HIGH" })],
      directlyDeclared: new Set(["hono"]),
    });
    expect(plan.rangeBumps).toHaveLength(1);
    expect(plan.rangeBumps[0]).toMatchObject({ pkg: "hono", action: "range-bump", target: "4.12.25" });
    expect(plan.overrides).toEqual([]);
  });

  test("directly-declared dep with an OUT-OF-RANGE fix is still a range-bump (closes the gap)", () => {
    const plan = planAll({
      ...EMPTY,
      findings: [f({ pkg: "x", installed: "1.2.0", fixed: "1.5.0", sev: "HIGH" })],
      directlyDeclared: new Set(["x"]),
    });
    expect(plan.rangeBumps[0]).toMatchObject({ pkg: "x", action: "range-bump", target: "1.5.0" });
    expect(plan.overrides).toEqual([]);
  });

  test("transitive dep -> override", () => {
    const plan = planAll({
      ...EMPTY,
      findings: [f({ pkg: "undici", installed: "7.24.7", fixed: "7.28.0, 8.5.0", sev: "HIGH" })],
    });
    expect(plan.overrides).toHaveLength(1);
    expect(plan.overrides[0]).toMatchObject({ pkg: "undici", action: "override", target: "7.28.0" });
  });

  test("security-override (transitive) -> override-bump only", () => {
    const plan = planAll({
      ...EMPTY,
      findings: [
        f({ pkg: "dompurify", installed: "3.4.3", fixed: "3.4.6", id: "CVE-A" }),
        f({ pkg: "dompurify", installed: "3.4.3", fixed: "3.4.11", id: "CVE-B" }),
        f({ pkg: "dompurify", installed: "3.4.3", fixed: "3.4.7", id: "CVE-C" }),
      ],
      securityOverrides: new Set(["dompurify"]),
    });
    expect(plan.overrides).toHaveLength(1);
    // target = highest of the per-advisory minimums so all are cleared
    expect(plan.overrides[0]).toMatchObject({ pkg: "dompurify", action: "override-bump", target: "3.4.11" });
    expect(plan.overrides[0]).toHaveProperty("advisory", "CVE-A, CVE-B, CVE-C");
    expect(plan.rangeBumps).toEqual([]);
  });

  test("security-override AND directly-declared -> BOTH override-bump and range-bump", () => {
    const plan = planAll({
      ...EMPTY,
      findings: [f({ pkg: "dual", installed: "1.0.0", fixed: "1.0.5", sev: "HIGH" })],
      directlyDeclared: new Set(["dual"]),
      securityOverrides: new Set(["dual"]),
    });
    expect(plan.overrides[0]).toMatchObject({ pkg: "dual", action: "override-bump" });
    expect(plan.rangeBumps[0]).toMatchObject({ pkg: "dual", action: "range-bump" });
  });

  test("an INTENTIONAL pin (react/drizzle) -> manual, never auto-bumped", () => {
    const plan = planAll({
      ...EMPTY,
      findings: [f({ pkg: "react", installed: "19.2.7", fixed: "19.2.9", sev: "HIGH" })],
      directlyDeclared: new Set(["react"]),
      intentionalOverrides: new Set(["react"]),
    });
    expect(plan.manual).toHaveLength(1);
    expect(plan.manual[0]).toMatchObject({ pkg: "react", action: "manual" });
    expect(plan.rangeBumps).toEqual([]);
    expect(plan.overrides).toEqual([]);
  });

  test("only a major-version fix available -> manual", () => {
    const plan = planAll({
      ...EMPTY,
      findings: [f({ pkg: "protobufjs", installed: "7.5.8", fixed: "8.4.1", sev: "HIGH" })],
    });
    expect(plan.manual).toHaveLength(1);
    expect(plan.manual[0]).toMatchObject({ pkg: "protobufjs", action: "manual" });
    expect(plan.overrides).toEqual([]);
  });

  test("one advisory needing a major bump forces the whole package to manual", () => {
    const plan = planAll({
      ...EMPTY,
      findings: [
        f({ pkg: "p", installed: "7.5.8", fixed: "7.6.1", id: "A" }),
        f({ pkg: "p", installed: "7.5.8", fixed: "8.0.0", id: "B" }),
      ],
      directlyDeclared: new Set(["p"]),
    });
    expect(plan.manual).toHaveLength(1);
    expect(plan.rangeBumps).toEqual([]);
    expect(plan.overrides).toEqual([]);
  });

  test("skips findings with no fix and dedupes per package", () => {
    const plan = planAll({
      ...EMPTY,
      findings: [
        f({ pkg: "openssl", installed: "3.5.6", fixed: "", sev: "CRITICAL" }),
        f({ pkg: "undici", installed: "7.24.7", fixed: "7.28.0", id: "A" }),
        f({ pkg: "undici", installed: "7.24.7", fixed: "7.28.0", id: "B" }),
      ],
    });
    expect(plan.rangeBumps).toEqual([]);
    expect(plan.overrides).toHaveLength(1);
    expect(plan.overrides[0]).toHaveProperty("advisory", "A, B");
  });

  test("takes max severity across a package's advisories", () => {
    const plan = planAll({
      ...EMPTY,
      findings: [
        f({ pkg: "undici", installed: "7.24.7", fixed: "7.28.0", sev: "MEDIUM", id: "A" }),
        f({ pkg: "undici", installed: "7.24.7", fixed: "7.28.0", sev: "HIGH", id: "B" }),
      ],
    });
    expect(plan.overrides[0]).toMatchObject({ severity: "HIGH" });
  });
});

describe("toManifestSeverity", () => {
  test("passes canonical levels through, clamps anything else to MEDIUM", () => {
    expect(toManifestSeverity("CRITICAL")).toBe("CRITICAL");
    expect(toManifestSeverity("LOW")).toBe("LOW");
    expect(toManifestSeverity("UNKNOWN")).toBe("MEDIUM");
    expect(toManifestSeverity("")).toBe("MEDIUM");
  });
});

describe("mergeSecurityEntry", () => {
  const args = { target: "3.4.11", severity: "MEDIUM", advisory: "CVE-NEW", reason: "auto", today: "2026-06-19" };

  test("builds a fully-documented entry when none exists, normalizing severity", () => {
    const { entry, floor } = mergeSecurityEntry({ ...args, severity: "UNKNOWN", existing: undefined });
    expect(floor).toBe("3.4.11");
    expect(entry).toMatchObject({ safeFloor: "3.4.11", severity: "MEDIUM", advisory: "CVE-NEW", addedAt: "2026-06-19" });
  });

  test("preserves curated metadata and RAISES the floor for an existing entry", () => {
    const existing: SecurityEntry = {
      safeFloor: "3.4.6",
      severity: "HIGH",
      advisory: "CURATED",
      reason: "curated reason",
      addedAt: "2026-01-01",
      removeWhen: "when x",
    };
    const { entry, floor } = mergeSecurityEntry({ ...args, existing });
    expect(floor).toBe("3.4.11");
    expect(entry).toEqual({ ...existing, safeFloor: "3.4.11" });
  });

  test("never LOWERS an existing floor", () => {
    const existing: SecurityEntry = {
      safeFloor: "3.4.20",
      severity: "HIGH",
      advisory: "CURATED",
      reason: "r",
      addedAt: "2026-01-01",
      removeWhen: "w",
    };
    const { entry, floor } = mergeSecurityEntry({ ...args, target: "3.4.11", existing });
    expect(floor).toBe("3.4.20");
    expect(entry.safeFloor).toBe("3.4.20");
  });
});

describe("computeRangeBumpEdits", () => {
  test("emits one edit per declaration site (across files and blocks)", () => {
    const edits = computeRangeBumpEdits({
      rangeBumps: [
        { pkg: "hono", action: "range-bump", installed: "4.12.23", target: "4.12.25", severity: "HIGH", advisory: "X" },
      ],
      declarationsByDep: {
        hono: [
          { file: "core/backend/package.json", block: "dependencies", pkgName: "@checkstack/backend", isPrivate: false },
          { file: "core/backend-api/package.json", block: "peerDependencies", pkgName: "@checkstack/backend-api", isPrivate: false },
        ],
      },
    });
    expect(edits).toEqual([
      { file: "core/backend/package.json", block: "dependencies", name: "hono", range: "^4.12.25" },
      { file: "core/backend-api/package.json", block: "peerDependencies", name: "hono", range: "^4.12.25" },
    ]);
  });
});

const planWith = (over: Partial<Plan>): Plan => ({
  rangeBumps: [],
  overrides: [],
  manual: [],
  ...over,
});

const decl = (pkgName: string, isPrivate = false): Declaration => ({
  file: "core/x/package.json",
  block: "dependencies",
  pkgName,
  isPrivate,
});

describe("collectChangesetPackages", () => {
  test("bumps the publishable packages a range-bump edited (not transitive overrides)", () => {
    const plan = planWith({
      rangeBumps: [
        { pkg: "hono", action: "range-bump", installed: "4.12.23", target: "4.12.25", severity: "HIGH", advisory: "X" },
      ],
      overrides: [
        { pkg: "undici", action: "override", installed: "7.24.7", target: "7.28.0", severity: "HIGH", advisory: "Y" },
      ],
    });
    const pkgs = collectChangesetPackages({
      plan,
      declarationsByDep: {
        hono: [decl("@checkstack/backend"), decl("@checkstack/auth-backend")],
        undici: [],
      },
      fallbackPackage: "@checkstack/backend",
    });
    expect(pkgs).toEqual(["@checkstack/auth-backend", "@checkstack/backend"]);
  });

  test("excludes private packages from the changeset", () => {
    const plan = planWith({
      rangeBumps: [
        { pkg: "hono", action: "range-bump", installed: "4.12.23", target: "4.12.25", severity: "HIGH", advisory: "X" },
      ],
    });
    const pkgs = collectChangesetPackages({
      plan,
      declarationsByDep: { hono: [decl("@checkstack/e2e", true), decl("@checkstack/backend")] },
      fallbackPackage: "@checkstack/backend",
    });
    expect(pkgs).toEqual(["@checkstack/backend"]);
  });

  test("falls back to the platform package when only transitive overrides changed", () => {
    const plan = planWith({
      overrides: [
        { pkg: "protobufjs", action: "override", installed: "7.5.8", target: "7.6.3", severity: "HIGH", advisory: "Z" },
      ],
    });
    const pkgs = collectChangesetPackages({
      plan,
      declarationsByDep: { protobufjs: [] },
      fallbackPackage: "@checkstack/backend",
    });
    expect(pkgs).toEqual(["@checkstack/backend"]);
  });

  test("returns nothing when there is nothing to remediate", () => {
    expect(
      collectChangesetPackages({
        plan: planWith({ manual: [{ pkg: "x", action: "manual", installed: "8.0.0", severity: "HIGH", reason: "major only" }] }),
        declarationsByDep: {},
        fallbackPackage: "@checkstack/backend",
      }),
    ).toEqual([]);
  });
});

describe("renderChangeset", () => {
  test("emits patch frontmatter + a bullet per applied fix", () => {
    const plan = planWith({
      rangeBumps: [
        { pkg: "hono", action: "range-bump", installed: "4.12.23", target: "4.12.25", severity: "HIGH", advisory: "CVE-1" },
      ],
    });
    const md = renderChangeset({ packages: ["@checkstack/backend"], plan });
    expect(md).toContain('"@checkstack/backend": patch');
    expect(md).toContain("- `hono` 4.12.23 → 4.12.25 (CVE-1)");
    expect(md.startsWith("---\n")).toBe(true);
  });
});
