import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { determinePackageStatus, type PackageJson } from "./publish-packages";

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
});
