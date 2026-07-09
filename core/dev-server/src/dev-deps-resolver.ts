import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

/**
 * Walks the plugin's `package.json#dependencies` and returns the file paths
 * of every `@checkstack/*` backend plugin module that should be co-loaded
 * by the dev server.
 *
 * Why this exists: the dev server boots `core/backend` with
 * `skipDiscovery: true` and a single manual plugin (the one under
 * development). Real plugins almost always depend on platform plugins
 * (`@checkstack/healthcheck-backend`, `@checkstack/notification-backend`,
 * `@checkstack/catalog-backend`, …) — without those, the host plugin's
 * `init()` calls into unregistered services and the boot deadlocks or
 * crashes.
 *
 * Resolution rules:
 *   1. Recursively walk `dependencies` (and `peerDependencies`) of the
 *      plugin under dev.
 *   2. Only follow packages whose name starts with `@checkstack/`.
 *   3. Only include packages whose `package.json#checkstack.type === "backend"`.
 *      Common-type packages provide types and are pulled in automatically
 *      by the TS importer; frontend-type packages are loaded by the Vite
 *      dev server, not the backend.
 *   4. Skip the plugin under dev itself (its module path is passed
 *      separately as the primary).
 *   5. Auto-include `@checkstack/queue-memory-backend` +
 *      `@checkstack/cache-memory-backend` when no other queue/cache
 *      strategy is in the resolved set, so `coreServices.queueManager` /
 *      `coreServices.cacheManager` have a registered strategy on boot.
 *      These are the cheapest, zero-config providers — fine for dev.
 *
 * Returns absolute paths suitable for a child process to `bun run` /
 * `import()`. Order is *not* topological — the platform's own dependency
 * sorter inside `loadPlugins` handles that.
 */

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  checkstack?: {
    type?: "backend" | "frontend" | "common" | "tooling";
    pluginId?: string;
  };
}

interface ResolvedPlugin {
  name: string;
  packageDir: string;
  /** Path to import (the package.json `main` resolved to absolute). */
  modulePath: string;
}

/**
 * Resolve the set of backend plugins the dev server should load alongside
 * the plugin under development.
 *
 * @param input.pluginDir   The plugin author's repo root (the cwd of the
 *                          dev command).
 * @param input.readFile    Injectable for tests; defaults to
 *                          `fs.readFileSync`.
 * @param input.resolveFrom Injectable for tests; defaults to Node's
 *                          `createRequire(...).resolve(...)`.
 */
export function resolveCorePluginDeps({
  pluginDir,
  readFile = (p) => fs.readFileSync(p, "utf8"),
  resolveFrom,
}: {
  pluginDir: string;
  readFile?: (p: string) => string;
  resolveFrom?: (from: string, request: string) => string | undefined;
}): ResolvedPlugin[] {
  const pluginPkgPath = path.join(pluginDir, "package.json");
  const pluginPkg = JSON.parse(readFile(pluginPkgPath)) as PackageJson;
  const pluginUnderDevName = pluginPkg.name;

  // Default resolver uses createRequire from the plugin's package.json so
  // node_modules lookup matches what `bun run` would do at runtime.
  const defaultResolve =
    resolveFrom ??
    ((from: string, request: string): string | undefined => {
      try {
        const req = createRequire(from);
        return req.resolve(request);
      } catch {
        return undefined;
      }
    });

  const resolved = new Map<string, ResolvedPlugin>();
  const queue: string[] = [];

  const seedFromPkg = (pkg: PackageJson) => {
    for (const block of [pkg.dependencies, pkg.peerDependencies]) {
      if (!block) continue;
      for (const dep of Object.keys(block)) {
        if (!dep.startsWith("@checkstack/")) continue;
        if (dep === pluginUnderDevName) continue;
        queue.push(dep);
      }
    }
  };

  seedFromPkg(pluginPkg);

  while (queue.length > 0) {
    const depName = queue.shift()!;
    if (resolved.has(depName)) continue;

    // Resolve the package's package.json from the plugin dir's perspective.
    const pkgJsonPath = defaultResolve(
      path.join(pluginDir, "package.json"),
      `${depName}/package.json`,
    );
    if (!pkgJsonPath) {
      // Dep declared but not actually installed — surface during boot,
      // not here. The `loadPlugins` import will throw with a clear msg.
      continue;
    }

    const pkg = JSON.parse(readFile(pkgJsonPath)) as PackageJson;

    // Only enqueue further deps once we've decided to (or not to) load
    // this package — but always walk the graph. A common-type package
    // can transitively depend on a backend-type package.
    seedFromPkg(pkg);

    if (pkg.checkstack?.type !== "backend") continue;

    const packageDir = path.dirname(pkgJsonPath);
    const main = readMain(pkg, pkgJsonPath, readFile);
    const modulePath = path.resolve(packageDir, main);

    resolved.set(depName, {
      name: depName,
      packageDir,
      modulePath,
    });
  }

  // Auto-include in-memory queue + cache providers if no provider was
  // already pulled in via the dep graph. These are the dev-mode defaults
  // — operators wire BullMQ / Redis in production.
  ensureProvider({
    needle: "queue-memory-backend",
    siblings: ["queue-bullmq-backend"],
    resolved,
    pluginDir,
    readFile,
    resolveFrom: defaultResolve,
  });
  ensureProvider({
    needle: "cache-memory-backend",
    siblings: ["cache-redis-backend"], // don't force the memory default if Redis is wired
    resolved,
    pluginDir,
    readFile,
    resolveFrom: defaultResolve,
  });

  return [...resolved.values()];
}

function readMain(
  pkg: PackageJson,
  pkgJsonPath: string,
  readFile: (p: string) => string,
): string {
  const raw = JSON.parse(readFile(pkgJsonPath)) as { main?: string };
  return raw.main ?? "src/index.ts";
}

/**
 * If none of `siblings` is already in the resolved set, attempt to add
 * `needle` (a known in-memory dev provider). Silently no-op if `needle`
 * isn't installed — operators may have a different provider wired up.
 */
function ensureProvider({
  needle,
  siblings,
  resolved,
  pluginDir,
  readFile,
  resolveFrom,
}: {
  needle: string;
  siblings: string[];
  resolved: Map<string, ResolvedPlugin>;
  pluginDir: string;
  readFile: (p: string) => string;
  resolveFrom: (from: string, request: string) => string | undefined;
}): void {
  const fqNeedle = `@checkstack/${needle}`;
  if (resolved.has(fqNeedle)) return;
  for (const sibling of siblings) {
    if (resolved.has(`@checkstack/${sibling}`)) return;
  }
  const pkgJsonPath = resolveFrom(
    path.join(pluginDir, "package.json"),
    `${fqNeedle}/package.json`,
  );
  if (!pkgJsonPath) return;
  const pkg = JSON.parse(readFile(pkgJsonPath)) as PackageJson;
  if (pkg.checkstack?.type !== "backend") return;
  const packageDir = path.dirname(pkgJsonPath);
  const main = readMain(pkg, pkgJsonPath, readFile);
  resolved.set(fqNeedle, {
    name: fqNeedle,
    packageDir,
    modulePath: path.resolve(packageDir, main),
  });
}
