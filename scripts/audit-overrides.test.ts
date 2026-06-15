import { describe, expect, test } from "bun:test";
import {
  applyPrune,
  extractInstalledVersions,
  findDrift,
  isRedundant,
  parseManifest,
  type IntentionalPin,
  type ManagedOverride,
  type ManagedOverrideMeta,
} from "./audit-overrides";

// Human-only metadata as it appears under a name key in the `security` bucket
// (no version - that lives in package.json).
const baseMeta: ManagedOverrideMeta = {
  safeFloor: "8.21.0",
  severity: "HIGH",
  advisory: "Trivy 2026-06: ws < 8.21.0 (HIGH)",
  reason: "transitive pull of 8.20.1",
  addedAt: "2026-06-15",
  removeWhen: "no consumer resolves below 8.21.0",
};

const baseEntry: ManagedOverride = { name: "ws", ...baseMeta };
const reactPin: IntentionalPin = {
  name: "react",
  reason: "single React across MFE",
  addedAt: "2026-06-06",
};

describe("parseManifest", () => {
  test("parses both buckets, folds the name key in, ignores meta keys", () => {
    const raw = JSON.stringify({
      $comment: "docs",
      security: { ws: baseMeta },
      intentional: { react: { reason: reactPin.reason, addedAt: reactPin.addedAt } },
    });
    const result = parseManifest({ raw });
    expect(result.security).toHaveLength(1);
    expect(result.security[0]?.name).toBe("ws");
    expect(result.intentional).toHaveLength(1);
    expect(result.intentional[0]?.name).toBe("react");
  });

  test("throws when a security entry is missing a required field", () => {
    const raw = JSON.stringify({
      security: { ws: { safeFloor: "8.21.0" } },
      intentional: {},
    });
    expect(() => parseManifest({ raw })).toThrow();
  });

  test("throws when an intentional entry is missing a reason", () => {
    const raw = JSON.stringify({
      security: {},
      intentional: { react: { addedAt: "2026-06-06" } },
    });
    expect(() => parseManifest({ raw })).toThrow();
  });

  test("throws on an invalid severity", () => {
    const raw = JSON.stringify({
      security: { ws: { ...baseMeta, severity: "SPICY" } },
      intentional: {},
    });
    expect(() => parseManifest({ raw })).toThrow();
  });
});

describe("findDrift", () => {
  const ok = {
    security: [baseEntry],
    intentional: [reactPin],
    overrides: { ws: "^8.21.0", react: "19.2.7" },
    resolutions: { ws: "^8.21.0", react: "19.2.7" },
  };

  test("no issues when every override is documented and consistent", () => {
    expect(findDrift(ok)).toEqual([]);
  });

  test("flags an override present in package.json but undocumented", () => {
    const issues = findDrift({
      ...ok,
      overrides: { ...ok.overrides, lodash: "^4.17.21" },
      resolutions: { ...ok.resolutions, lodash: "^4.17.21" },
    });
    expect(issues.some((i) => i.name === "lodash" && i.problem.includes("undocumented"))).toBe(
      true,
    );
  });

  test("flags a name documented in BOTH buckets", () => {
    const issues = findDrift({
      ...ok,
      security: [baseEntry],
      intentional: [reactPin, { name: "ws", reason: "x", addedAt: "2026-06-15" }],
    });
    expect(issues.some((i) => i.name === "ws" && i.problem.includes("exactly one"))).toBe(true);
  });

  test("flags a documented override missing from package.json overrides", () => {
    const issues = findDrift({ ...ok, overrides: { react: "19.2.7" } });
    expect(issues.some((i) => i.problem.includes('missing from package.json "overrides"'))).toBe(
      true,
    );
  });

  test("flags overrides and resolutions pinning different ranges", () => {
    const issues = findDrift({
      ...ok,
      resolutions: { ws: "^8.21.1", react: "19.2.7" },
    });
    expect(issues.some((i) => i.problem.includes("they must match"))).toBe(true);
  });

  test("flags a SECURITY pin whose floor is below safeFloor", () => {
    const issues = findDrift({
      ...ok,
      overrides: { ws: ">=8.0.0", react: "19.2.7" },
      resolutions: { ws: ">=8.0.0", react: "19.2.7" },
    });
    expect(issues.some((i) => i.problem.includes("below safeFloor"))).toBe(true);
  });

  test("does NOT apply a floor check to intentional pins (any range is fine)", () => {
    const issues = findDrift({
      security: [],
      intentional: [reactPin],
      overrides: { react: "0.0.1" },
      resolutions: { react: "0.0.1" },
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
  test("removes named entries from package.json and the security bucket only", () => {
    const pkg = {
      overrides: { ws: "^8.21.0", react: "19.2.7" },
      resolutions: { ws: "^8.21.0", react: "19.2.7" },
    };
    const manifest = {
      security: { ws: baseMeta, minimatch: baseMeta },
      intentional: { react: { reason: "x", addedAt: "2026-06-06" } },
    };

    const result = applyPrune({ names: ["ws"], pkg, manifest });

    expect(result.pkg.overrides).toEqual({ react: "19.2.7" });
    expect(result.pkg.resolutions).toEqual({ react: "19.2.7" });
    expect(Object.keys(result.manifest.security)).toEqual(["minimatch"]);
    // Intentional pins are never touched.
    expect(result.manifest.intentional).toEqual({ react: { reason: "x", addedAt: "2026-06-06" } });
  });

  test("does not mutate the input objects", () => {
    const pkg = { overrides: { ws: "^8.21.0" }, resolutions: { ws: "^8.21.0" } };
    const manifest = { security: { ws: baseMeta } };

    applyPrune({ names: ["ws"], pkg, manifest });

    expect(pkg.overrides.ws).toBe("^8.21.0");
    expect(Object.keys(manifest.security)).toEqual(["ws"]);
  });

  test("is a no-op for names that are not present", () => {
    const pkg = { overrides: { ws: "^8.21.0" }, resolutions: { ws: "^8.21.0" } };
    const manifest = { security: { ws: baseMeta } };

    const result = applyPrune({ names: ["nonexistent"], pkg, manifest });

    expect(result.pkg.overrides).toEqual({ ws: "^8.21.0" });
    expect(Object.keys(result.manifest.security)).toEqual(["ws"]);
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
