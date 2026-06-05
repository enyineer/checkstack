import { describe, it, expect } from "bun:test";
import path from "node:path";
import { buildDevTailwindContent } from "./dev-frontend-css";

const FRONTEND = "/nm/@checkstack/frontend";
const SRC_GLOB = "**/*.{js,ts,jsx,tsx}";

describe("buildDevTailwindContent", () => {
  it("always covers the dev shell (frontend index.html + src)", () => {
    const globs = buildDevTailwindContent({
      frontendDir: FRONTEND,
      pluginCwd: "/ws/packages/widget-backend",
      pluginEntry: "/ws/packages/widget-frontend/src/index.tsx",
    });
    expect(globs).toContain(path.join(FRONTEND, "index.html"));
    expect(globs).toContain(path.join(FRONTEND, "src", SRC_GLOB));
  });

  it("includes the plugin's own sources (so custom classes compile)", () => {
    const pluginCwd = "/ws/packages/widget-backend";
    const pluginEntry = "/ws/packages/widget-frontend/src/index.tsx";
    const globs = buildDevTailwindContent({
      frontendDir: FRONTEND,
      pluginCwd,
      pluginEntry,
    });
    // The directory the entry lives in (a -frontend sibling) is scanned, so
    // an author's custom utility classes in those .tsx files compile.
    expect(globs).toContain(
      path.join("/ws/packages/widget-frontend/src", SRC_GLOB),
    );
    // The dev cwd's own src is also scanned (covers the type === "frontend"
    // case where cwd IS the frontend package).
    expect(globs).toContain(path.join(pluginCwd, "src", SRC_GLOB));
  });

  it("scans the cwd's own src when the plugin IS a -frontend package", () => {
    const cwd = "/ws/packages/widget-frontend";
    const globs = buildDevTailwindContent({
      frontendDir: FRONTEND,
      pluginCwd: cwd,
      pluginEntry: path.join(cwd, "src/index.tsx"),
    });
    expect(globs).toContain(path.join(cwd, "src", SRC_GLOB));
  });

  it("appends extra source dirs (e.g. @checkstack/ui) when provided", () => {
    const globs = buildDevTailwindContent({
      frontendDir: FRONTEND,
      pluginCwd: "/ws/p/widget-backend",
      pluginEntry: "/ws/p/widget-frontend/src/index.tsx",
      extraSourceDirs: ["/nm/@checkstack/ui/src", "/nm/@checkstack/foo/src"],
    });
    expect(globs).toContain(path.join("/nm/@checkstack/ui/src", SRC_GLOB));
    expect(globs).toContain(path.join("/nm/@checkstack/foo/src", SRC_GLOB));
  });

  it("de-duplicates overlapping globs (cwd === entry package)", () => {
    const cwd = "/ws/packages/widget-frontend";
    const globs = buildDevTailwindContent({
      frontendDir: FRONTEND,
      pluginCwd: cwd,
      // entry directly under cwd/src → entry dir scan and cwd/src scan coincide
      pluginEntry: path.join(cwd, "src/index.tsx"),
    });
    const cwdSrcGlob = path.join(cwd, "src", SRC_GLOB);
    expect(globs.filter((g) => g === cwdSrcGlob)).toHaveLength(1);
    // No duplicates anywhere.
    expect(new Set(globs).size).toBe(globs.length);
  });
});
