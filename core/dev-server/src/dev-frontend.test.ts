import { describe, it, expect } from "bun:test";
import path from "node:path";
import {
  pickFrontendEntry,
  resolveFromCandidates,
  findSiblingPackageDir,
} from "./dev-frontend";

const ROOT = "/plugin-author/repo";

describe("pickFrontendEntry", () => {
  it("returns <cwd>/<main> when the cwd is itself a -frontend plugin", () => {
    const entry = pickFrontendEntry({
      pluginCwd: ROOT,
      pluginPkg: {
        main: "src/index.tsx",
        checkstack: { type: "frontend" },
      },
    });
    expect(entry).toBe(path.resolve(ROOT, "src/index.tsx"));
  });

  it("falls back to src/index.tsx when no main field on a -frontend plugin", () => {
    const entry = pickFrontendEntry({
      pluginCwd: ROOT,
      pluginPkg: { checkstack: { type: "frontend" } },
    });
    expect(entry).toBe(path.resolve(ROOT, "src/index.tsx"));
  });

  it("resolves a -frontend sibling's main when called from a bundle primary", () => {
    const siblingPkgPath =
      "/plugin-author/repo/node_modules/@my-org/widget-frontend/package.json";
    const entry = pickFrontendEntry({
      pluginCwd: ROOT,
      pluginPkg: {
        main: "src/index.ts",
        checkstack: {
          type: "backend",
          bundle: ["@my-org/widget-common", "@my-org/widget-frontend"],
        },
      },
      resolveFrom: (request) =>
        request === "@my-org/widget-frontend/package.json"
          ? siblingPkgPath
          : undefined,
      readFile: () =>
        JSON.stringify({
          name: "@my-org/widget-frontend",
          main: "dist/index.js",
        }),
    });
    expect(entry).toBe(
      "/plugin-author/repo/node_modules/@my-org/widget-frontend/dist/index.js",
    );
  });

  it("skips non-frontend siblings in the bundle list", () => {
    let resolveCalls = 0;
    const entry = pickFrontendEntry({
      pluginCwd: ROOT,
      pluginPkg: {
        checkstack: {
          type: "backend",
          // Only -common siblings — no -frontend
          bundle: ["@my-org/widget-common", "@my-org/widget-other"],
        },
      },
      resolveFrom: () => {
        resolveCalls++;
        return "/never";
      },
    });
    expect(entry).toBeUndefined();
    expect(resolveCalls).toBe(0); // didn't even attempt a resolve
  });

  it("returns undefined when the named -frontend sibling is not installed", () => {
    const entry = pickFrontendEntry({
      pluginCwd: ROOT,
      pluginPkg: {
        checkstack: {
          type: "backend",
          bundle: ["@my-org/widget-frontend"],
        },
      },
      resolveFrom: () => undefined,
    });
    expect(entry).toBeUndefined();
  });

  it("tries the next -frontend sibling when the first is malformed", () => {
    let resolveCalls = 0;
    const fs: Record<string, string> = {
      "/nm/@my-org/first-frontend/package.json": "not-json",
      "/nm/@my-org/second-frontend/package.json": JSON.stringify({
        main: "src/index.tsx",
      }),
    };
    const entry = pickFrontendEntry({
      pluginCwd: ROOT,
      pluginPkg: {
        checkstack: {
          type: "backend",
          bundle: [
            "@my-org/first-frontend",
            "@my-org/second-frontend",
          ],
        },
      },
      resolveFrom: (request) => {
        resolveCalls++;
        if (request === "@my-org/first-frontend/package.json")
          return "/nm/@my-org/first-frontend/package.json";
        if (request === "@my-org/second-frontend/package.json")
          return "/nm/@my-org/second-frontend/package.json";
        return undefined;
      },
      readFile: (p) => {
        const content = fs[p];
        if (content === undefined) throw new Error(`ENOENT: ${p}`);
        return content;
      },
    });
    expect(entry).toBe("/nm/@my-org/second-frontend/src/index.tsx");
    // Exactly one attempt per sibling
    expect(resolveCalls).toBe(2);
  });

  it("returns undefined for a backend plugin with no bundle siblings at all", () => {
    const entry = pickFrontendEntry({
      pluginCwd: ROOT,
      pluginPkg: { checkstack: { type: "backend" } },
    });
    expect(entry).toBeUndefined();
  });

  it("falls back to src/index.tsx for a sibling without a main field", () => {
    const entry = pickFrontendEntry({
      pluginCwd: ROOT,
      pluginPkg: {
        checkstack: {
          type: "backend",
          bundle: ["@my-org/widget-frontend"],
        },
      },
      resolveFrom: () => "/nm/@my-org/widget-frontend/package.json",
      readFile: () => JSON.stringify({ name: "@my-org/widget-frontend" }),
    });
    expect(entry).toBe("/nm/@my-org/widget-frontend/src/index.tsx");
  });

  it("falls back to a filesystem-sibling scan when node_modules resolution misses (standalone workspace)", () => {
    // Mirrors the standalone scaffold: backend at packages/widget-backend,
    // frontend at packages/widget-frontend — the latter only referenced via
    // checkstack.bundle, never installed as a dependency, so require.resolve
    // can never find it. The dev server must still pick it up.
    const pluginCwd = "/ws/packages/widget-backend";
    const entry = pickFrontendEntry({
      pluginCwd,
      pluginPkg: {
        main: "src/index.ts",
        checkstack: {
          type: "backend",
          bundle: ["@scope/widget-common", "@scope/widget-frontend"],
        },
      },
      // node_modules resolution always misses for the workspace sibling.
      resolveFrom: () => undefined,
      findSiblingDir: (name) =>
        name === "@scope/widget-frontend"
          ? "/ws/packages/widget-frontend/package.json"
          : undefined,
      readFile: () => JSON.stringify({ main: "src/index.tsx" }),
    });
    expect(entry).toBe("/ws/packages/widget-frontend/src/index.tsx");
  });

  it("prefers node_modules resolution over the sibling-dir scan", () => {
    let scanned = false;
    const entry = pickFrontendEntry({
      pluginCwd: ROOT,
      pluginPkg: {
        checkstack: { type: "backend", bundle: ["@my-org/widget-frontend"] },
      },
      resolveFrom: () => "/nm/@my-org/widget-frontend/package.json",
      findSiblingDir: () => {
        scanned = true;
        return undefined;
      },
      readFile: () => JSON.stringify({ main: "src/index.tsx" }),
    });
    expect(entry).toBe("/nm/@my-org/widget-frontend/src/index.tsx");
    expect(scanned).toBe(false);
  });
});

describe("resolveFromCandidates", () => {
  it("returns undefined for an unresolvable request without throwing", () => {
    // The load-bearing behaviour for #251 bug 2: a missing module must NOT
    // surface a (non-Error) throw to the caller. A real bun/node resolve of
    // a guaranteed-absent specifier exercises the actual throw path.
    const result = resolveFromCandidates({
      request: "@checkstack/definitely-not-a-real-package-251/package.json",
      candidateBasePaths: ["/no/such/base", process.cwd()],
    });
    expect(result).toBeUndefined();
  });

  it("resolves a real package from the cwd candidate", () => {
    const result = resolveFromCandidates({
      request: "vite/package.json",
      candidateBasePaths: [import.meta.dir],
    });
    expect(result).toBeDefined();
    expect(result).toContain("vite");
  });
});

describe("findSiblingPackageDir", () => {
  const PLUGIN = "/ws/packages/widget-backend";

  it("finds the sibling package.json by matching its name", () => {
    const found = findSiblingPackageDir({
      pluginCwd: PLUGIN,
      siblingName: "@scope/widget-frontend",
      listDir: (dir) => {
        expect(dir).toBe("/ws/packages");
        return ["widget-backend", "widget-common", "widget-frontend"];
      },
      readFile: (p) =>
        JSON.stringify({
          name: `@scope/${path.basename(path.dirname(p))}`,
        }),
    });
    expect(found).toBe("/ws/packages/widget-frontend/package.json");
  });

  it("returns undefined when no sibling matches", () => {
    const found = findSiblingPackageDir({
      pluginCwd: PLUGIN,
      siblingName: "@scope/widget-frontend",
      listDir: () => ["widget-backend", "widget-common"],
      readFile: (p) =>
        JSON.stringify({ name: `@scope/${path.basename(path.dirname(p))}` }),
    });
    expect(found).toBeUndefined();
  });

  it("skips entries with unreadable or malformed package.json", () => {
    const found = findSiblingPackageDir({
      pluginCwd: PLUGIN,
      siblingName: "@scope/widget-frontend",
      listDir: () => ["broken", "widget-frontend"],
      readFile: (p) => {
        if (p.includes("broken")) throw new Error("ENOENT");
        return JSON.stringify({ name: "@scope/widget-frontend" });
      },
    });
    expect(found).toBe("/ws/packages/widget-frontend/package.json");
  });

  it("returns undefined when the parent directory cannot be listed", () => {
    const found = findSiblingPackageDir({
      pluginCwd: PLUGIN,
      siblingName: "@scope/widget-frontend",
      listDir: () => {
        throw new Error("ENOENT");
      },
    });
    expect(found).toBeUndefined();
  });
});
