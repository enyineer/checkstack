import { describe, expect, it } from "bun:test";
import {
  checkstackWorkspaceDeps,
  discoverWorkspacePackages,
} from "./workspace-packages";

describe("checkstackWorkspaceDeps", () => {
  const pkg = {
    dependencies: {
      "@checkstack/common": "workspace:*",
      zod: "^4.0.0",
      "@checkstack/backend-api": "workspace:*",
    },
    devDependencies: {
      "@checkstack/scripts": "workspace:*",
      typescript: "^5.7.2",
    },
  };

  it("returns only @checkstack/* runtime deps by default", () => {
    expect(checkstackWorkspaceDeps(pkg, { includeDev: false }).toSorted()).toEqual([
      "@checkstack/backend-api",
      "@checkstack/common",
    ]);
  });

  it("unions devDependencies when includeDev is true", () => {
    expect(checkstackWorkspaceDeps(pkg, { includeDev: true }).toSorted()).toEqual([
      "@checkstack/backend-api",
      "@checkstack/common",
      "@checkstack/scripts",
    ]);
  });

  it("handles packages with no deps", () => {
    expect(
      checkstackWorkspaceDeps(
        { dependencies: {}, devDependencies: {} },
        { includeDev: true },
      ),
    ).toEqual([]);
  });
});

describe("discoverWorkspacePackages (against the real workspace)", () => {
  it("discovers the workspace with unique names and populated dep maps", async () => {
    const packages = await discoverWorkspacePackages();

    // A sizeable monorepo, so a trivially-small result signals a broken walk.
    expect(packages.length).toBeGreaterThan(50);
    // Names are deduped.
    expect(new Set(packages.map((p) => p.name)).size).toBe(packages.length);

    const satellite = packages.find((p) => p.name === "@checkstack/satellite");
    expect(satellite).toBeDefined();
    expect(satellite?.relDir).toBe("core/satellite");
    expect(satellite?.hasTsconfig).toBe(true);
    // The telemetry contract whose mis-location caused the ENOENT crash now
    // lives in core/ and is a satellite runtime dependency.
    expect(
      checkstackWorkspaceDeps(satellite!, { includeDev: false }),
    ).toContain("@checkstack/k8s-events-common");
    const k8s = packages.find(
      (p) => p.name === "@checkstack/k8s-events-common",
    );
    expect(k8s?.relDir).toBe("core/k8s-events-common");
  });
});
