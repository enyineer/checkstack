import { describe, it, expect } from "bun:test";
import {
  rewriteWorkspaceVersions,
  type RewritablePackageJson,
  type VersionResolver,
} from "./rewrite-workspace-versions";

const constantResolver =
  (version: string): VersionResolver =>
  () =>
    Promise.resolve(version);

describe("rewriteWorkspaceVersions", () => {
  it("rewrites workspace ranges across all dependency sections", async () => {
    const pkg: RewritablePackageJson = {
      name: "@scope/widget-backend",
      dependencies: {
        "@checkstack/common": "workspace:*",
        "@orpc/server": "^1.13.2",
      },
      devDependencies: {
        "@checkstack/scripts": "workspace:^",
      },
      peerDependencies: {
        "@checkstack/backend": "workspace:*",
      },
    };

    const result = await rewriteWorkspaceVersions({
      pkg,
      resolveVersion: constantResolver("^1.2.3"),
    });

    expect(result.rewritten).toBe(true);
    expect(result.unresolved).toEqual([]);
    expect(pkg.dependencies).toEqual({
      "@checkstack/common": "^1.2.3",
      "@orpc/server": "^1.13.2",
    });
    expect(pkg.devDependencies).toEqual({ "@checkstack/scripts": "^1.2.3" });
    expect(pkg.peerDependencies).toEqual({ "@checkstack/backend": "^1.2.3" });
  });

  it("leaves non-workspace ranges untouched and reports rewritten=false", async () => {
    const pkg: RewritablePackageJson = {
      name: "@scope/widget-backend",
      dependencies: {
        "@checkstack/common": "^0.12.0",
        "drizzle-orm": "^0.45.1",
      },
    };

    const result = await rewriteWorkspaceVersions({
      pkg,
      resolveVersion: constantResolver("^9.9.9"),
    });

    expect(result.rewritten).toBe(false);
    expect(pkg.dependencies).toEqual({
      "@checkstack/common": "^0.12.0",
      "drizzle-orm": "^0.45.1",
    });
  });

  it("records unresolved deps and does not mutate them", async () => {
    const pkg: RewritablePackageJson = {
      dependencies: {
        "@checkstack/common": "workspace:*",
        "@checkstack/missing": "workspace:*",
      },
    };
    const resolver: VersionResolver = ({ packageName }) =>
      Promise.resolve(
        packageName === "@checkstack/common" ? "^1.0.0" : undefined,
      );

    const result = await rewriteWorkspaceVersions({
      pkg,
      resolveVersion: resolver,
    });

    expect(result.rewritten).toBe(true);
    expect(result.unresolved).toEqual(["@checkstack/missing"]);
    expect(pkg.dependencies?.["@checkstack/common"]).toBe("^1.0.0");
    expect(pkg.dependencies?.["@checkstack/missing"]).toBe("workspace:*");
  });

  it("passes the original workspace range to the resolver", async () => {
    const seen: string[] = [];
    const pkg: RewritablePackageJson = {
      dependencies: { "@checkstack/common": "workspace:^1.0.0" },
    };
    await rewriteWorkspaceVersions({
      pkg,
      resolveVersion: ({ workspaceRange }) => {
        seen.push(workspaceRange);
        return Promise.resolve("^1.0.0");
      },
    });
    expect(seen).toEqual(["workspace:^1.0.0"]);
  });
});
