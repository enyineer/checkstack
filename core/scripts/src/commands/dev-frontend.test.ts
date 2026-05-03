import { describe, it, expect } from "bun:test";
import path from "node:path";
import { pickFrontendEntry } from "./dev-frontend";

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
});
