import { describe, expect, it } from "bun:test";
import {
  computeKeepSet,
  computeSatellitePrune,
  isDynamicSatellitePlugin,
  satelliteKeepRoots,
  type PrunePackage,
} from "./satellite-prune.logic";

// A small but representative workspace: the satellite, its static deps
// (including a telemetry contract), two dynamically-loaded backends with their
// own -common siblings, and unrelated packages the image should shed.
const packages: PrunePackage[] = [
  {
    name: "@checkstack/satellite",
    relDir: "core/satellite",
    deps: [
      "@checkstack/backend-api",
      "@checkstack/healthcheck-execution",
      "@checkstack/k8s-events-common",
    ],
  },
  { name: "@checkstack/backend-api", relDir: "core/backend-api", deps: ["@checkstack/common"] },
  {
    name: "@checkstack/healthcheck-execution",
    relDir: "core/healthcheck-execution",
    deps: ["@checkstack/backend-api"],
  },
  {
    name: "@checkstack/k8s-events-common",
    relDir: "core/k8s-events-common",
    deps: ["@checkstack/common", "@checkstack/telemetry-common"],
  },
  { name: "@checkstack/telemetry-common", relDir: "core/telemetry-common", deps: ["@checkstack/common"] },
  { name: "@checkstack/common", relDir: "core/common", deps: [] },
  // Dynamically-loaded backends (NOT satellite deps) + their -common siblings
  // and a SHARED plugin contract only they depend on.
  {
    name: "@checkstack/healthcheck-http-backend",
    relDir: "plugins/healthcheck-http-backend",
    deps: ["@checkstack/healthcheck-http-common", "@checkstack/shared-probe-common"],
  },
  {
    name: "@checkstack/healthcheck-http-common",
    relDir: "plugins/healthcheck-http-common",
    deps: [],
  },
  {
    name: "@checkstack/collector-hardware-backend",
    relDir: "plugins/collector-hardware-backend",
    deps: [],
  },
  {
    name: "@checkstack/shared-probe-common",
    relDir: "plugins/shared-probe-common",
    deps: [],
  },
  // Unrelated packages the satellite must NOT keep.
  { name: "@checkstack/incident-backend", relDir: "plugins/incident-backend", deps: [] },
  { name: "@checkstack/scripts", relDir: "core/scripts", deps: [] },
  { name: "@checkstack/docs", relDir: "docs", deps: [] },
];

describe("isDynamicSatellitePlugin", () => {
  it("matches the runtime scanner: healthcheck-*/collector-* backends under plugins/", () => {
    expect(isDynamicSatellitePlugin("plugins/healthcheck-http-backend")).toBe(true);
    expect(isDynamicSatellitePlugin("plugins/collector-hardware-backend")).toBe(true);
  });
  it("does not match -common, non-plugin dirs, or core packages", () => {
    expect(isDynamicSatellitePlugin("plugins/healthcheck-http-common")).toBe(false);
    expect(isDynamicSatellitePlugin("plugins/incident-backend")).toBe(false);
    expect(isDynamicSatellitePlugin("core/satellite")).toBe(false);
    expect(isDynamicSatellitePlugin("plugins/a/b")).toBe(false);
  });
});

describe("satelliteKeepRoots", () => {
  it("roots the closure at the satellite AND every dynamically-loaded backend", () => {
    const roots = satelliteKeepRoots({
      packages,
      satelliteName: "@checkstack/satellite",
    });
    expect(roots).toContain("@checkstack/satellite");
    expect(roots).toContain("@checkstack/healthcheck-http-backend");
    expect(roots).toContain("@checkstack/collector-hardware-backend");
    // A -common sibling is NOT a root (it is reached via the backend's deps).
    expect(roots).not.toContain("@checkstack/healthcheck-http-common");
  });
});

describe("computeKeepSet", () => {
  it("walks transitive runtime deps and ignores external names", () => {
    const keep = computeKeepSet({
      packages,
      rootNames: ["@checkstack/satellite"],
    });
    expect([...keep].sort()).toEqual([
      "@checkstack/backend-api",
      "@checkstack/common",
      "@checkstack/healthcheck-execution",
      "@checkstack/k8s-events-common",
      "@checkstack/satellite",
      "@checkstack/telemetry-common",
    ]);
  });
});

describe("computeSatellitePrune", () => {
  const { keep, removeDirs } = computeSatellitePrune({
    packages,
    satelliteName: "@checkstack/satellite",
  });

  it("keeps the satellite's static telemetry contract (the reported ENOENT crash)", () => {
    // k8s-events-common is a static satellite dep; deleting it crash-loops the
    // agent. It MUST survive.
    expect(keep.has("@checkstack/k8s-events-common")).toBe(true);
    expect(removeDirs).not.toContain("core/k8s-events-common");
  });

  it("NEVER prunes the dynamically-loaded backends (they are roots, not deps)", () => {
    expect(keep.has("@checkstack/healthcheck-http-backend")).toBe(true);
    expect(keep.has("@checkstack/collector-hardware-backend")).toBe(true);
    expect(removeDirs).not.toContain("plugins/healthcheck-http-backend");
    expect(removeDirs).not.toContain("plugins/collector-hardware-backend");
  });

  it("keeps a shared plugin contract a backend depends on (the latent name-pattern bug)", () => {
    // `shared-probe-common` is neither healthcheck-* nor collector-*, so the old
    // name-pattern prune would delete it and crash the http backend. The closure
    // keeps it because the backend depends on it.
    expect(keep.has("@checkstack/shared-probe-common")).toBe(true);
    expect(removeDirs).not.toContain("plugins/shared-probe-common");
  });

  it("removes unrelated core/plugins packages, but never touches docs", () => {
    expect(removeDirs).toContain("plugins/incident-backend");
    expect(removeDirs).toContain("core/scripts");
    // `docs` is outside core/ and plugins/, so it is never a prune candidate.
    expect(removeDirs).not.toContain("docs");
  });
});
