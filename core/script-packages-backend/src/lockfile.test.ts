import { describe, expect, test } from "bun:test";
import type { ManifestEntry } from "@checkstack/script-packages-common";
import {
  buildDependencies,
  buildStorePackageJson,
  computeLockfileHash,
  sortManifest,
} from "./lockfile";

const a: ManifestEntry = { name: "a", version: "1.0.0", integrity: "sha-a" };
const b: ManifestEntry = { name: "b", version: "2.0.0", integrity: "sha-b" };

describe("sortManifest", () => {
  test("orders by name then version", () => {
    expect(sortManifest([b, a]).map((e) => e.name)).toEqual(["a", "b"]);
  });
});

describe("computeLockfileHash", () => {
  test("is order-independent", () => {
    expect(computeLockfileHash([a, b])).toBe(computeLockfileHash([b, a]));
  });

  test("changes when an integrity changes (content-addressed)", () => {
    const a2: ManifestEntry = { ...a, integrity: "sha-a-v2" };
    expect(computeLockfileHash([a, b])).not.toBe(computeLockfileHash([a2, b]));
  });

  test("changes when a version changes", () => {
    const a2: ManifestEntry = { ...a, version: "1.0.1" };
    expect(computeLockfileHash([a])).not.toBe(computeLockfileHash([a2]));
  });

  test("empty manifest hashes deterministically", () => {
    expect(computeLockfileHash([])).toBe(computeLockfileHash([]));
  });
});

describe("buildDependencies", () => {
  test("excludes disabled packages and sorts keys", () => {
    const deps = buildDependencies([
      { name: "zeta", version: "1.0.0", enabled: true },
      { name: "alpha", version: "2.0.0", enabled: true },
      { name: "off", version: "3.0.0", enabled: false },
    ]);
    expect(Object.keys(deps)).toEqual(["alpha", "zeta"]);
    expect(deps.alpha).toBe("2.0.0");
    expect(deps.off).toBeUndefined();
  });
});

describe("buildStorePackageJson", () => {
  test("renders a private package with pinned deps", () => {
    const json = JSON.parse(
      buildStorePackageJson([{ name: "lodash", version: "4.17.21", enabled: true }]),
    );
    expect(json.private).toBe(true);
    expect(json.dependencies.lodash).toBe("4.17.21");
  });
});
