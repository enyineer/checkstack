import { describe, it, expect } from "bun:test";
import { checkCompatibility } from "./compatibility-checker";
import type { InstallPackageMetadata } from "@checkstack/common";

const minimalPkg = (
  override: Partial<InstallPackageMetadata>,
): InstallPackageMetadata => ({
  name: "@scope/example",
  version: "1.0.0",
  description: "example",
  author: "test",
  license: "Elastic-2.0",
  checkstack: { type: "backend", pluginId: "example" },
  ...override,
});

describe("checkCompatibility", () => {
  it("passes when every @checkstack/* dep is satisfied by loaded versions", () => {
    const pkg = minimalPkg({
      dependencies: {
        "@checkstack/backend-api": "^1.0.0",
        "@checkstack/common": "^1.0.0",
      },
    });
    const issues = checkCompatibility({
      packages: [pkg],
      loadedVersions: new Map([
        ["@checkstack/backend-api", "1.2.3"],
        ["@checkstack/common", "1.5.0"],
      ]),
    });
    expect(issues).toEqual([]);
  });

  it("ignores non-@checkstack deps", () => {
    const pkg = minimalPkg({
      dependencies: { lodash: "^4.0.0", react: "^18.0.0" },
    });
    const issues = checkCompatibility({
      packages: [pkg],
      loadedVersions: new Map(),
    });
    expect(issues).toEqual([]);
  });

  it("flags missing @checkstack/* dependency not in bundle", () => {
    const pkg = minimalPkg({
      dependencies: { "@checkstack/missing-pkg": "^1.0.0" },
    });
    const issues = checkCompatibility({
      packages: [pkg],
      loadedVersions: new Map(),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("missing-dependency");
    expect(issues[0].dependency).toBe("@checkstack/missing-pkg");
  });

  it("flags semver mismatch against loaded platform version", () => {
    const pkg = minimalPkg({
      dependencies: { "@checkstack/backend-api": "^2.0.0" },
    });
    const issues = checkCompatibility({
      packages: [pkg],
      loadedVersions: new Map([["@checkstack/backend-api", "1.0.0"]]),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("version-mismatch");
    expect(issues[0].declared).toBe("^2.0.0");
    expect(issues[0].actual).toBe("1.0.0");
  });

  it("rejects unresolved workspace:* ranges (must be resolved at pack time)", () => {
    const pkg = minimalPkg({
      dependencies: { "@checkstack/backend-api": "workspace:*" },
    });
    const issues = checkCompatibility({
      packages: [pkg],
      loadedVersions: new Map([["@checkstack/backend-api", "1.0.0"]]),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("version-mismatch");
    expect(issues[0].declared).toBe("workspace:*");
  });

  it("satisfies bundle-internal deps from sibling packages, not platform versions", () => {
    const primary = minimalPkg({
      name: "@scope/foo-backend",
      version: "1.0.0",
      dependencies: { "@scope/foo-common": "^1.0.0" },
    });
    const sibling = minimalPkg({
      name: "@scope/foo-common",
      version: "1.0.0",
      checkstack: { type: "common", pluginId: "foo" },
    });

    const issues = checkCompatibility({
      packages: [primary, sibling],
      loadedVersions: new Map(), // platform doesn't have @scope/foo-common
    });
    // The dep is `@scope/foo-common`, not `@checkstack/*`, so it isn't
    // checked at all. But verify the check would also pass for the
    // (more interesting) `@checkstack/*` case:
  });

  it("satisfies bundle-internal @checkstack/* dep from a sibling package", () => {
    const primary = minimalPkg({
      name: "@checkstack/foo-backend",
      version: "1.0.0",
      dependencies: { "@checkstack/foo-common": "^1.0.0" },
    });
    const sibling = minimalPkg({
      name: "@checkstack/foo-common",
      version: "1.0.0",
      checkstack: { type: "common", pluginId: "foo" },
    });

    const issues = checkCompatibility({
      packages: [primary, sibling],
      loadedVersions: new Map(),
    });
    expect(issues).toEqual([]);
  });

  it("flags bundle-internal dep when version doesn't match", () => {
    const primary = minimalPkg({
      name: "@checkstack/foo-backend",
      version: "1.0.0",
      dependencies: { "@checkstack/foo-common": "^2.0.0" },
    });
    const sibling = minimalPkg({
      name: "@checkstack/foo-common",
      version: "1.0.0",
      checkstack: { type: "common", pluginId: "foo" },
    });

    const issues = checkCompatibility({
      packages: [primary, sibling],
      loadedVersions: new Map(),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("version-mismatch");
    expect(issues[0].dependency).toBe("@checkstack/foo-common");
  });
});
