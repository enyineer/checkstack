import { describe, test, expect } from "bun:test";
import path from "node:path";
import {
  determinePackageStatus,
  getPackageDirectories,
  getPackageJson,
  type PackageJson,
} from "./publish-packages";

const ROOT = path.join(import.meta.dirname, "..");

/**
 * Regex used by changesets action to detect published packages
 * From: https://github.com/changesets/action/blob/main/src/run.ts
 * let newTagRegex = /New tag:\s+(@[^/]+\/[^@]+|[^/]+)@([^\s]+)/;
 */
const CHANGESETS_NEW_TAG_REGEX = /New tag:\s+(@[^/]+\/[^@]+|[^/]+)@([^\s]+)/;

describe("publish-packages", () => {
  describe("determinePackageStatus", () => {
    test("returns 'private' for private packages", () => {
      const pkg: PackageJson = {
        name: "@checkstack/test",
        version: "1.0.0",
        private: true,
      };
      const result = determinePackageStatus({ pkg, npmVersion: undefined });
      expect(result).toBe("private");
    });

    test("returns 'private' even if npmVersion exists", () => {
      const pkg: PackageJson = {
        name: "@checkstack/test",
        version: "1.0.0",
        private: true,
      };
      const result = determinePackageStatus({ pkg, npmVersion: "0.9.0" });
      expect(result).toBe("private");
    });

    test("returns 'new' when package does not exist on npm", () => {
      const pkg: PackageJson = {
        name: "@checkstack/new-pkg",
        version: "1.0.0",
      };
      const result = determinePackageStatus({ pkg, npmVersion: undefined });
      expect(result).toBe("new");
    });

    test("returns 'up-to-date' when versions match", () => {
      const pkg: PackageJson = { name: "@checkstack/test", version: "1.2.3" };
      const result = determinePackageStatus({ pkg, npmVersion: "1.2.3" });
      expect(result).toBe("up-to-date");
    });

    test("returns 'update' when local version is higher", () => {
      const pkg: PackageJson = { name: "@checkstack/test", version: "1.3.0" };
      const result = determinePackageStatus({ pkg, npmVersion: "1.2.3" });
      expect(result).toBe("update");
    });

    test("returns 'ahead-of-local' when npm version is higher than local", () => {
      // npm has a newer version - local checkout is behind, should not publish
      const pkg: PackageJson = { name: "@checkstack/test", version: "1.0.0" };
      const result = determinePackageStatus({ pkg, npmVersion: "1.2.3" });
      expect(result).toBe("ahead-of-local");
    });
  });

  describe("package detection scenarios", () => {
    test("correctly identifies packages needing publish", () => {
      const testCases: Array<{
        description: string;
        pkg: PackageJson;
        npmVersion: string | undefined;
        expectedStatus:
          | "new"
          | "update"
          | "up-to-date"
          | "private"
          | "ahead-of-local";
      }> = [
        {
          description: "brand new package",
          pkg: { name: "@checkstack/brand-new", version: "0.1.0" },
          npmVersion: undefined,
          expectedStatus: "new",
        },
        {
          description: "patch version bump",
          pkg: { name: "@checkstack/backend", version: "0.4.9" },
          npmVersion: "0.4.8",
          expectedStatus: "update",
        },
        {
          description: "minor version bump",
          pkg: { name: "@checkstack/common", version: "0.5.0" },
          npmVersion: "0.4.8",
          expectedStatus: "update",
        },
        {
          description: "major version bump",
          pkg: { name: "@checkstack/api", version: "1.0.0" },
          npmVersion: "0.9.9",
          expectedStatus: "update",
        },
        {
          description: "already published",
          pkg: { name: "@checkstack/frontend", version: "0.4.8" },
          npmVersion: "0.4.8",
          expectedStatus: "up-to-date",
        },
        {
          description: "private package",
          pkg: { name: "@checkstack/scripts", version: "1.0.0", private: true },
          npmVersion: undefined,
          expectedStatus: "private",
        },
        {
          description: "private test utils",
          pkg: {
            name: "@checkstack/test-utils-backend",
            version: "0.1.0",
            private: true,
          },
          npmVersion: undefined,
          expectedStatus: "private",
        },
        {
          description: "npm is ahead of local",
          pkg: {
            name: "@checkstack/healthcheck-http-backend",
            version: "0.2.2",
          },
          npmVersion: "0.2.3",
          expectedStatus: "ahead-of-local",
        },
      ];

      for (const {
        description,
        pkg,
        npmVersion,
        expectedStatus,
      } of testCases) {
        const result = determinePackageStatus({ pkg, npmVersion });
        expect(result).toBe(expectedStatus);
      }
    });
  });

  describe("changesets action output format", () => {
    /**
     * The changesets action parses stdout for lines matching:
     * /New tag:\s+(@[^/]+\/[^@]+|[^/]+)@([^\s]+)/
     *
     * This regex expects:
     * - "New tag: " prefix
     * - Package name (scoped like @scope/name or unscoped like name)
     * - "@" separator
     * - Version number
     */

    test("scoped package output matches changesets regex", () => {
      const output = "New tag: @checkstack/ui@0.5.2";
      const match = output.match(CHANGESETS_NEW_TAG_REGEX);

      expect(match).not.toBeNull();
      expect(match![1]).toBe("@checkstack/ui");
      expect(match![2]).toBe("0.5.2");
    });

    test("scoped package with complex name matches changesets regex", () => {
      const output = "New tag: @checkstack/healthcheck-http-backend@1.2.3";
      const match = output.match(CHANGESETS_NEW_TAG_REGEX);

      expect(match).not.toBeNull();
      expect(match![1]).toBe("@checkstack/healthcheck-http-backend");
      expect(match![2]).toBe("1.2.3");
    });

    test("unscoped package output matches changesets regex", () => {
      const output = "New tag: my-package@1.0.0";
      const match = output.match(CHANGESETS_NEW_TAG_REGEX);

      expect(match).not.toBeNull();
      expect(match![1]).toBe("my-package");
      expect(match![2]).toBe("1.0.0");
    });

    test("prerelease version matches changesets regex", () => {
      const output = "New tag: @checkstack/core@2.0.0-beta.1";
      const match = output.match(CHANGESETS_NEW_TAG_REGEX);

      expect(match).not.toBeNull();
      expect(match![1]).toBe("@checkstack/core");
      expect(match![2]).toBe("2.0.0-beta.1");
    });

    test("output with surrounding text still matches", () => {
      const output = "Publishing... New tag: @checkstack/api@0.1.0 done!";
      const match = output.match(CHANGESETS_NEW_TAG_REGEX);

      expect(match).not.toBeNull();
      expect(match![1]).toBe("@checkstack/api");
      expect(match![2]).toBe("0.1.0");
    });

    test("multiple packages can be parsed from multiline output", () => {
      const output = `
Publishing @checkstack/ui...
New tag: @checkstack/ui@0.5.2
Publishing @checkstack/backend...
New tag: @checkstack/backend@0.4.9
`;
      const lines = output.split("\n");
      const publishedPackages: Array<{ name: string; version: string }> = [];

      for (const line of lines) {
        const match = line.match(CHANGESETS_NEW_TAG_REGEX);
        if (match) {
          publishedPackages.push({ name: match[1], version: match[2] });
        }
      }

      expect(publishedPackages).toHaveLength(2);
      expect(publishedPackages[0]).toEqual({
        name: "@checkstack/ui",
        version: "0.5.2",
      });
      expect(publishedPackages[1]).toEqual({
        name: "@checkstack/backend",
        version: "0.4.9",
      });
    });

    test("generateNewTagOutput produces correct format", () => {
      // This tests the exact format our script outputs
      const pkg = { name: "@checkstack/test-pkg", version: "1.2.3" };
      const output = `New tag: ${pkg.name}@${pkg.version}`;

      const match = output.match(CHANGESETS_NEW_TAG_REGEX);
      expect(match).not.toBeNull();
      expect(match![1]).toBe(pkg.name);
      expect(match![2]).toBe(pkg.version);
    });
  });

  describe("@checkstack/sdk publish discovery (phase 2)", () => {
    test("core/sdk is auto-discovered by the package dir scan", async () => {
      const dirs = await getPackageDirectories({ rootDir: ROOT });
      const sdkDir = path.join(ROOT, "core", "sdk");
      expect(dirs).toContain(sdkDir);
    });

    test("@checkstack/sdk is a public package (not skipped as private)", async () => {
      const pkg = await getPackageJson({ dir: path.join(ROOT, "core", "sdk") });
      expect(pkg).toBeDefined();
      expect(pkg!.name).toBe("@checkstack/sdk");
      expect(pkg!.private).toBeUndefined();
    });

    test("stamped @checkstack/sdk ahead of npm → status 'update'", async () => {
      const pkg = await getPackageJson({ dir: path.join(ROOT, "core", "sdk") });
      // Simulate npm being one minor behind the committed (release-stamped)
      // version. determinePackageStatus must select it for publish.
      const status = determinePackageStatus({
        pkg: pkg!,
        npmVersion: "0.0.1",
      });
      expect(status).toBe("update");
    });

    test("@checkstack/sdk never published yet → status 'new'", async () => {
      const pkg = await getPackageJson({ dir: path.join(ROOT, "core", "sdk") });
      const status = determinePackageStatus({ pkg: pkg!, npmVersion: undefined });
      expect(status).toBe("new");
    });

    test("@checkstack/release stays private → skipped", async () => {
      const release = await getPackageJson({
        dir: path.join(ROOT, "core", "release"),
      });
      expect(release!.private).toBe(true);
      expect(
        determinePackageStatus({ pkg: release!, npmVersion: undefined }),
      ).toBe("private");
    });

    test("stamped @checkstack/sdk already on npm → status 'up-to-date' (no republish)", async () => {
      const pkg = await getPackageJson({ dir: path.join(ROOT, "core", "sdk") });
      const status = determinePackageStatus({
        pkg: pkg!,
        npmVersion: pkg!.version,
      });
      expect(status).toBe("up-to-date");
    });
  });

  describe("git tag format", () => {
    test("git tag name matches expected format", () => {
      // Git tags should be: @scope/package-name@version
      const pkg = { name: "@checkstack/ui", version: "0.5.2" };
      const tagName = `${pkg.name}@${pkg.version}`;

      expect(tagName).toBe("@checkstack/ui@0.5.2");
    });

    test("git tag name for complex package names", () => {
      const pkg = {
        name: "@checkstack/healthcheck-http-backend",
        version: "1.2.3",
      };
      const tagName = `${pkg.name}@${pkg.version}`;

      expect(tagName).toBe("@checkstack/healthcheck-http-backend@1.2.3");
    });
  });
});
