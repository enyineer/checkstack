import { describe, it, expect } from "bun:test";
import path from "node:path";
import { resolveCorePluginDeps } from "./dev-deps-resolver";

/**
 * In-memory fixture for a virtual node_modules tree. Maps a fully
 * qualified file path to its file contents (typically package.json
 * stringified JSON).
 */
type Fs = Record<string, string>;

const ROOT = "/plugin-author/repo";
const NM = `${ROOT}/node_modules`;

function makeFs(packages: Record<string, unknown>): Fs {
  const out: Fs = {};
  for (const [name, pkg] of Object.entries(packages)) {
    out[`${NM}/${name}/package.json`] = JSON.stringify(pkg);
  }
  return out;
}

function makeResolver(fs: Fs) {
  return (_from: string, request: string): string | undefined => {
    // Only handle requests of the form `<pkg>/package.json` — that's all
    // resolveCorePluginDeps issues. A real `createRequire` resolves any
    // entry, but we don't need that fidelity here.
    if (!request.endsWith("/package.json")) return undefined;
    const pkgName = request.replace(/\/package\.json$/, "");
    const candidate = `${NM}/${pkgName}/package.json`;
    return fs[candidate] === undefined ? undefined : candidate;
  };
}

function readFileFromFs(fs: Fs) {
  return (p: string): string => {
    const text = fs[p];
    if (text === undefined) throw new Error(`ENOENT: ${p}`);
    return text;
  };
}

describe("resolveCorePluginDeps", () => {
  it("returns only the auto-included providers for a plugin with no @checkstack/* backend deps", () => {
    const fs: Fs = {
      [`${ROOT}/package.json`]: JSON.stringify({
        name: "@my-org/widget-backend",
        dependencies: {
          "@checkstack/backend-api": "^1.0.0",
          lodash: "^4.0.0",
        },
        checkstack: { type: "backend", pluginId: "widget" },
      }),
      ...makeFs({
        "@checkstack/backend-api": {
          name: "@checkstack/backend-api",
          checkstack: { type: "common" },
        },
        "@checkstack/queue-memory-backend": {
          name: "@checkstack/queue-memory-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "queue-memory" },
        },
        "@checkstack/cache-memory-backend": {
          name: "@checkstack/cache-memory-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "cache-memory" },
        },
      }),
    };

    const resolved = resolveCorePluginDeps({
      pluginDir: ROOT,
      readFile: readFileFromFs(fs),
      resolveFrom: makeResolver(fs),
    });

    const names = resolved.map((r) => r.name).toSorted();
    expect(names).toEqual([
      "@checkstack/cache-memory-backend",
      "@checkstack/queue-memory-backend",
    ]);
  });

  it("includes a single backend dep declared in dependencies", () => {
    const fs: Fs = {
      [`${ROOT}/package.json`]: JSON.stringify({
        name: "@my-org/healthcheck-rcon-backend",
        dependencies: {
          "@checkstack/healthcheck-backend": "^1.0.0",
        },
        checkstack: { type: "backend", pluginId: "healthcheck-rcon" },
      }),
      ...makeFs({
        "@checkstack/healthcheck-backend": {
          name: "@checkstack/healthcheck-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "healthcheck" },
          dependencies: {},
        },
        "@checkstack/queue-memory-backend": {
          name: "@checkstack/queue-memory-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "queue-memory" },
        },
        "@checkstack/cache-memory-backend": {
          name: "@checkstack/cache-memory-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "cache-memory" },
        },
      }),
    };

    const resolved = resolveCorePluginDeps({
      pluginDir: ROOT,
      readFile: readFileFromFs(fs),
      resolveFrom: makeResolver(fs),
    });

    expect(resolved.map((r) => r.name).toSorted()).toEqual([
      "@checkstack/cache-memory-backend",
      "@checkstack/healthcheck-backend",
      "@checkstack/queue-memory-backend",
    ]);

    const hc = resolved.find((r) => r.name === "@checkstack/healthcheck-backend");
    expect(hc?.modulePath).toBe(
      path.resolve(`${NM}/@checkstack/healthcheck-backend/src/index.ts`),
    );
  });

  it("walks transitive @checkstack/* backend deps", () => {
    // Plugin → notification-discord-backend → notification-backend → catalog-backend
    const fs: Fs = {
      [`${ROOT}/package.json`]: JSON.stringify({
        name: "@my-org/widget-backend",
        dependencies: {
          "@checkstack/notification-discord-backend": "^1.0.0",
        },
        checkstack: { type: "backend", pluginId: "widget" },
      }),
      ...makeFs({
        "@checkstack/notification-discord-backend": {
          name: "@checkstack/notification-discord-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "notification-discord" },
          dependencies: {
            "@checkstack/notification-backend": "^1.0.0",
          },
        },
        "@checkstack/notification-backend": {
          name: "@checkstack/notification-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "notification" },
          dependencies: {
            "@checkstack/catalog-backend": "^1.0.0",
          },
        },
        "@checkstack/catalog-backend": {
          name: "@checkstack/catalog-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "catalog" },
        },
        "@checkstack/queue-memory-backend": {
          name: "@checkstack/queue-memory-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "queue-memory" },
        },
        "@checkstack/cache-memory-backend": {
          name: "@checkstack/cache-memory-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "cache-memory" },
        },
      }),
    };

    const resolved = resolveCorePluginDeps({
      pluginDir: ROOT,
      readFile: readFileFromFs(fs),
      resolveFrom: makeResolver(fs),
    });

    expect(resolved.map((r) => r.name).toSorted()).toEqual([
      "@checkstack/cache-memory-backend",
      "@checkstack/catalog-backend",
      "@checkstack/notification-backend",
      "@checkstack/notification-discord-backend",
      "@checkstack/queue-memory-backend",
    ]);
  });

  it("walks through common-type packages to find transitive backend deps", () => {
    // Plugin → my-shared-common (type: common) → healthcheck-backend
    // (Unusual but possible; common packages can list runtime deps.)
    const fs: Fs = {
      [`${ROOT}/package.json`]: JSON.stringify({
        name: "@my-org/widget-backend",
        dependencies: {
          "@checkstack/widget-common": "^1.0.0",
        },
        checkstack: { type: "backend", pluginId: "widget" },
      }),
      ...makeFs({
        "@checkstack/widget-common": {
          name: "@checkstack/widget-common",
          checkstack: { type: "common" },
          dependencies: {
            "@checkstack/healthcheck-backend": "^1.0.0",
          },
        },
        "@checkstack/healthcheck-backend": {
          name: "@checkstack/healthcheck-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "healthcheck" },
        },
        "@checkstack/queue-memory-backend": {
          name: "@checkstack/queue-memory-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "queue-memory" },
        },
        "@checkstack/cache-memory-backend": {
          name: "@checkstack/cache-memory-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "cache-memory" },
        },
      }),
    };

    const resolved = resolveCorePluginDeps({
      pluginDir: ROOT,
      readFile: readFileFromFs(fs),
      resolveFrom: makeResolver(fs),
    });

    expect(resolved.map((r) => r.name)).toContain(
      "@checkstack/healthcheck-backend",
    );
    // The common pkg itself isn't loaded as a plugin
    expect(resolved.map((r) => r.name)).not.toContain(
      "@checkstack/widget-common",
    );
  });

  it("excludes the plugin under dev itself even when listed transitively", () => {
    const fs: Fs = {
      [`${ROOT}/package.json`]: JSON.stringify({
        name: "@my-org/widget-backend",
        dependencies: {
          "@checkstack/healthcheck-backend": "^1.0.0",
        },
        checkstack: { type: "backend", pluginId: "widget" },
      }),
      ...makeFs({
        "@checkstack/healthcheck-backend": {
          name: "@checkstack/healthcheck-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "healthcheck" },
          // Pretend the platform plugin pulls back into the user's plugin
          // (this would never happen in practice, but the resolver must
          // never try to load the plugin under dev as a sibling).
          dependencies: {
            "@my-org/widget-backend": "^1.0.0",
          },
        },
        "@checkstack/queue-memory-backend": {
          name: "@checkstack/queue-memory-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "queue-memory" },
        },
        "@checkstack/cache-memory-backend": {
          name: "@checkstack/cache-memory-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "cache-memory" },
        },
      }),
    };

    const resolved = resolveCorePluginDeps({
      pluginDir: ROOT,
      readFile: readFileFromFs(fs),
      resolveFrom: makeResolver(fs),
    });
    expect(resolved.map((r) => r.name)).not.toContain("@my-org/widget-backend");
  });

  it("skips queue-memory auto-include when bullmq is already in the dep graph", () => {
    const fs: Fs = {
      [`${ROOT}/package.json`]: JSON.stringify({
        name: "@my-org/widget-backend",
        dependencies: {
          "@checkstack/queue-bullmq-backend": "^1.0.0",
        },
        checkstack: { type: "backend", pluginId: "widget" },
      }),
      ...makeFs({
        "@checkstack/queue-bullmq-backend": {
          name: "@checkstack/queue-bullmq-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "queue-bullmq" },
        },
        "@checkstack/queue-memory-backend": {
          name: "@checkstack/queue-memory-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "queue-memory" },
        },
        "@checkstack/cache-memory-backend": {
          name: "@checkstack/cache-memory-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "cache-memory" },
        },
      }),
    };

    const resolved = resolveCorePluginDeps({
      pluginDir: ROOT,
      readFile: readFileFromFs(fs),
      resolveFrom: makeResolver(fs),
    });
    const names = resolved.map((r) => r.name);
    expect(names).toContain("@checkstack/queue-bullmq-backend");
    expect(names).not.toContain("@checkstack/queue-memory-backend");
  });

  it("does not include @checkstack/* frontend or tooling packages", () => {
    const fs: Fs = {
      [`${ROOT}/package.json`]: JSON.stringify({
        name: "@my-org/widget-backend",
        dependencies: {
          "@checkstack/healthcheck-backend": "^1.0.0",
          "@checkstack/healthcheck-frontend": "^1.0.0",
          "@checkstack/scripts": "^0.1.0",
        },
        checkstack: { type: "backend", pluginId: "widget" },
      }),
      ...makeFs({
        "@checkstack/healthcheck-backend": {
          name: "@checkstack/healthcheck-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "healthcheck" },
        },
        "@checkstack/healthcheck-frontend": {
          name: "@checkstack/healthcheck-frontend",
          main: "src/index.tsx",
          checkstack: { type: "frontend", pluginId: "healthcheck" },
        },
        "@checkstack/scripts": {
          name: "@checkstack/scripts",
          checkstack: { type: "tooling" },
        },
        "@checkstack/queue-memory-backend": {
          name: "@checkstack/queue-memory-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "queue-memory" },
        },
        "@checkstack/cache-memory-backend": {
          name: "@checkstack/cache-memory-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "cache-memory" },
        },
      }),
    };

    const resolved = resolveCorePluginDeps({
      pluginDir: ROOT,
      readFile: readFileFromFs(fs),
      resolveFrom: makeResolver(fs),
    });
    const names = resolved.map((r) => r.name);
    expect(names).toContain("@checkstack/healthcheck-backend");
    expect(names).not.toContain("@checkstack/healthcheck-frontend");
    expect(names).not.toContain("@checkstack/scripts");
  });

  it("silently skips a declared dep that isn't actually installed", () => {
    const fs: Fs = {
      [`${ROOT}/package.json`]: JSON.stringify({
        name: "@my-org/widget-backend",
        dependencies: {
          "@checkstack/missing-backend": "^1.0.0",
        },
        checkstack: { type: "backend", pluginId: "widget" },
      }),
      ...makeFs({
        "@checkstack/queue-memory-backend": {
          name: "@checkstack/queue-memory-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "queue-memory" },
        },
        "@checkstack/cache-memory-backend": {
          name: "@checkstack/cache-memory-backend",
          main: "src/index.ts",
          checkstack: { type: "backend", pluginId: "cache-memory" },
        },
      }),
    };

    const resolved = resolveCorePluginDeps({
      pluginDir: ROOT,
      readFile: readFileFromFs(fs),
      resolveFrom: makeResolver(fs),
    });
    expect(resolved.map((r) => r.name)).not.toContain(
      "@checkstack/missing-backend",
    );
    // Auto-included providers still present — boot needs them.
    expect(resolved.map((r) => r.name).toSorted()).toEqual([
      "@checkstack/cache-memory-backend",
      "@checkstack/queue-memory-backend",
    ]);
  });
});
