import { describe, expect, test } from "bun:test";
import {
  applyPrune,
  extractInstalledVersions,
  findDrift,
  isRedundant,
  parseManifest,
  type ManagedOverride,
} from "./audit-overrides";

const baseEntry: ManagedOverride = {
  name: "ws",
  pinned: "^8.21.0",
  safeFloor: "8.21.0",
  severity: "HIGH",
  advisory: "Trivy 2026-06: ws < 8.21.0 (HIGH)",
  reason: "transitive pull of 8.20.1",
  addedAt: "2026-06-15",
  removeWhen: "no consumer resolves below 8.21.0",
};

describe("parseManifest", () => {
  test("parses a valid manifest and ignores meta keys", () => {
    const raw = JSON.stringify({
      $comment: "docs",
      $schema: "./x.json",
      overrides: [baseEntry],
    });
    const result = parseManifest({ raw });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("ws");
  });

  test("throws on a missing required field", () => {
    const raw = JSON.stringify({ overrides: [{ name: "ws", pinned: "^8.21.0" }] });
    expect(() => parseManifest({ raw })).toThrow();
  });

  test("throws on an invalid severity", () => {
    const raw = JSON.stringify({
      overrides: [{ ...baseEntry, severity: "SPICY" }],
    });
    expect(() => parseManifest({ raw })).toThrow();
  });
});

describe("findDrift", () => {
  test("no issues when manifest matches overrides and resolutions", () => {
    const issues = findDrift({
      manifest: [baseEntry],
      overrides: { ws: "^8.21.0" },
      resolutions: { ws: "^8.21.0" },
    });
    expect(issues).toEqual([]);
  });

  test("flags an override missing from package.json overrides", () => {
    const issues = findDrift({
      manifest: [baseEntry],
      overrides: {},
      resolutions: { ws: "^8.21.0" },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.problem).toContain('missing from package.json "overrides"');
  });

  test("flags a mismatched pin between manifest and resolutions", () => {
    const issues = findDrift({
      manifest: [baseEntry],
      overrides: { ws: "^8.21.0" },
      resolutions: { ws: "^8.20.0" },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.problem).toContain("resolutions");
  });

  test("flags a pinned range whose floor is below safeFloor", () => {
    const issues = findDrift({
      manifest: [{ ...baseEntry, pinned: ">=8.0.0" }],
      overrides: { ws: ">=8.0.0" },
      resolutions: { ws: ">=8.0.0" },
    });
    expect(issues.some((i) => i.problem.includes("below safeFloor"))).toBe(true);
  });

  test("ignores extra non-manifest overrides (intentional pins)", () => {
    const issues = findDrift({
      manifest: [baseEntry],
      overrides: { ws: "^8.21.0", react: "19.2.7" },
      resolutions: { ws: "^8.21.0", react: "19.2.7" },
    });
    expect(issues).toEqual([]);
  });
});

describe("extractInstalledVersions", () => {
  test("extracts direct and nested resolved versions, deduped", () => {
    const lock = `
      "ws": ["ws@8.21.0", "", {}, "sha512-aaa"],
      "foo/ws": ["ws@8.21.0", "", {}, "sha512-bbb"],
      "bar/ws": ["ws@8.20.1", "", {}, "sha512-ccc"],
    `;
    const versions = extractInstalledVersions({ lockfileText: lock, name: "ws" }).sort();
    expect(versions).toEqual(["8.20.1", "8.21.0"]);
  });

  test("does not match a different package with the name as a suffix", () => {
    const lock = `"y-ws": ["y-ws@1.0.0", "", {}, "sha512-zzz"],`;
    expect(extractInstalledVersions({ lockfileText: lock, name: "ws" })).toEqual([]);
  });

  test("returns empty when the package is absent", () => {
    expect(
      extractInstalledVersions({ lockfileText: `"left-pad": ["left-pad@1.3.0"]`, name: "ws" }),
    ).toEqual([]);
  });

  test("handles scoped package names", () => {
    const lock = `"@grpc/proto-loader": ["@grpc/proto-loader@0.8.1", "", {}, "sha512-q"],`;
    expect(
      extractInstalledVersions({ lockfileText: lock, name: "@grpc/proto-loader" }),
    ).toEqual(["0.8.1"]);
  });
});

describe("applyPrune", () => {
  test("removes named entries from overrides, resolutions, and manifest only", () => {
    const pkg = {
      overrides: { ws: "^8.21.0", react: "19.2.7" },
      resolutions: { ws: "^8.21.0", react: "19.2.7" },
    };
    const manifest = { overrides: [baseEntry, { ...baseEntry, name: "minimatch" }] };

    const result = applyPrune({ names: ["ws"], pkg, manifest });

    expect(result.pkg.overrides).toEqual({ react: "19.2.7" });
    expect(result.pkg.resolutions).toEqual({ react: "19.2.7" });
    expect(result.manifest.overrides.map((o) => o.name)).toEqual(["minimatch"]);
  });

  test("does not mutate the input objects", () => {
    const pkg = { overrides: { ws: "^8.21.0" }, resolutions: { ws: "^8.21.0" } };
    const manifest = { overrides: [baseEntry] };

    applyPrune({ names: ["ws"], pkg, manifest });

    expect(pkg.overrides.ws).toBe("^8.21.0");
    expect(manifest.overrides).toHaveLength(1);
  });

  test("is a no-op for names that are not present", () => {
    const pkg = { overrides: { ws: "^8.21.0" }, resolutions: { ws: "^8.21.0" } };
    const manifest = { overrides: [baseEntry] };

    const result = applyPrune({ names: ["nonexistent"], pkg, manifest });

    expect(result.pkg.overrides).toEqual({ ws: "^8.21.0" });
    expect(result.manifest.overrides).toHaveLength(1);
  });
});

describe("isRedundant", () => {
  test("redundant when every resolved copy is at/above the floor", () => {
    expect(
      isRedundant({ resolvedVersions: ["8.21.0", "8.22.0"], safeFloor: "8.21.0" }),
    ).toBe(true);
  });

  test("not redundant when any resolved copy is below the floor", () => {
    expect(
      isRedundant({ resolvedVersions: ["8.21.0", "8.20.1"], safeFloor: "8.21.0" }),
    ).toBe(false);
  });

  test("redundant when the package left the graph entirely", () => {
    expect(isRedundant({ resolvedVersions: [], safeFloor: "8.21.0" })).toBe(true);
  });
});
