/**
 * Standalone Monaco worker pre-build for the dev server.
 *
 * `@checkstack/ui`'s `CodeEditor` imports three Monaco language workers via
 * `?worker&url`:
 *
 * - the generic editor worker (`@codingame/monaco-vscode-editor-api`)
 * - the TypeScript/JavaScript language worker
 * - the JSON language worker
 *
 * In the monorepo `@checkstack/ui` is a linked workspace *source* package, so
 * Vite's worker handling processes those imports normally. In a standalone
 * plugin it is a *pre-bundled npm dependency*, and Vite's worker plugin does
 * NOT run during dependency pre-bundling - the optimizer then chokes on the
 * `?worker&url` query and the dev server crashes. Serving `@checkstack/ui` as
 * source instead breaks the CJS->ESM interop of its other deps (`ajv`,
 * `cookie`, ...).
 *
 * This module breaks that deadlock: it pre-builds each worker into a
 * self-contained ES-module bundle (a plain `vite build`, NOT the dep
 * optimizer, so the worker query never reaches it), serves them as static
 * files, and exposes `resolve.alias` entries that redirect each `?worker&url`
 * import to a tiny stub returning the served URL. Because `resolve.alias` runs
 * during pre-bundling, `@checkstack/ui` stays pre-bundled (its CJS deps keep
 * their interop) while the worker imports resolve to the pre-built bundles.
 *
 * The workers are self-contained Monaco language-service code (they do not pull
 * in `@checkstack/ui`'s app dependencies), so building them in isolation is
 * clean.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { Alias, InlineConfig, Plugin } from "vite";

/**
 * Bump when the build config or stub/serve contract below changes, so existing
 * caches from older dev-server versions are invalidated.
 */
const CACHE_FORMAT = "1";

/** URL prefix the pre-built workers are served under. */
const SERVE_PREFIX = "/@checkstack-monaco-worker/";

/**
 * The three worker entry imports `@checkstack/ui`'s `monacoTsService` pulls in.
 * `spec` is the bare specifier exactly as written there (sans the `?worker&url`
 * suffix); `pkg` is the owning package (used to key the cache on its version).
 */
const WORKERS = [
  {
    name: "editor",
    pkg: "@codingame/monaco-vscode-editor-api",
    spec: "@codingame/monaco-vscode-editor-api/esm/vs/editor/editor.worker.js",
  },
  {
    name: "ts",
    pkg: "@codingame/monaco-vscode-standalone-typescript-language-features",
    spec: "@codingame/monaco-vscode-standalone-typescript-language-features/worker",
  },
  {
    name: "json",
    pkg: "@codingame/monaco-vscode-standalone-json-language-features",
    spec: "@codingame/monaco-vscode-standalone-json-language-features/worker",
  },
] as const;

/** Vite's `build` (injected so this module stays decoupled / unit-testable). */
export type ViteBuild = (config: InlineConfig) => Promise<unknown>;

export interface MonacoWorkerSetup {
  /** `resolve.alias` entries redirecting each `?worker&url` import to a stub. */
  aliases: Alias[];
  /** Vite plugin that serves the pre-built worker bundles as static files. */
  plugin: Plugin;
}

const escapeRegExp = (s: string) =>
  s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** `.../foo.worker.js` built bundle path inside a cache dir. */
const workerFile = (dir: string, name: string) =>
  path.join(dir, `${name}.worker.js`);
/** `.../foo.stub.js` redirect stub path inside a cache dir. */
const stubFile = (dir: string, name: string) => path.join(dir, `${name}.stub.js`);
const readyMarker = (dir: string) => path.join(dir, ".ready");

/**
 * Read a package's version via its resolvable `package.json`, or `"?"` when it
 * can't be resolved (still produces a stable, distinct cache key).
 */
function readPkgVersion({
  pkg,
  req,
  paths,
}: {
  pkg: string;
  req: NodeJS.Require;
  paths: string[];
}): string {
  try {
    const pkgJsonPath = req.resolve(`${pkg}/package.json`, { paths });
    const parsed: unknown = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      typeof (parsed as { version: unknown }).version === "string"
    ) {
      return (parsed as { version: string }).version;
    }
  } catch {
    // fall through
  }
  return "?";
}

/**
 * Deterministic cache key over everything that affects the built output: the
 * cache format, the resolved `vscode` alias dir, and each worker package's
 * version. A dependency bump (or a config change via `CACHE_FORMAT`) yields a
 * new key, so stale bundles are never reused.
 */
function computeCacheKey({
  vscodeDir,
  versions,
}: {
  vscodeDir: string;
  versions: string[];
}): string {
  return createHash("sha256")
    .update(JSON.stringify([CACHE_FORMAT, vscodeDir, versions]))
    .digest("hex")
    .slice(0, 16);
}

/** A cache dir is usable only if every worker + stub exists AND `.ready` does. */
function isCacheReady(dir: string): boolean {
  if (!fs.existsSync(readyMarker(dir))) return false;
  return WORKERS.every(
    (w) => fs.existsSync(workerFile(dir, w.name)) && fs.existsSync(stubFile(dir, w.name)),
  );
}

function buildAliases(cacheDir: string): Alias[] {
  return WORKERS.map((w) => ({
    // Matches the exact `?worker&url` import in monacoTsService, so the worker
    // resolves to the stub (which exports the served URL) during pre-bundling.
    find: new RegExp(`^${escapeRegExp(`${w.spec}?worker&url`)}$`),
    replacement: stubFile(cacheDir, w.name),
  }));
}

function buildServePlugin(cacheDir: string): Plugin {
  return {
    name: "checkstack-dev-monaco-workers",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith(SERVE_PREFIX)) return next();
        const name = url.slice(SERVE_PREFIX.length).replace(/\?.*$/, "");
        const match = WORKERS.find((w) => `${w.name}.worker.js` === name);
        const file = match ? workerFile(cacheDir, match.name) : undefined;
        if (!file || !fs.existsSync(file)) {
          res.statusCode = 404;
          res.end("worker not found");
          return;
        }
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        // Pre-built and content-keyed by the cache dir, so it's immutable.
        res.setHeader("Cache-Control", "no-cache");
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

/**
 * Build the three workers into `destDir` and write their redirect stubs. Each
 * worker is a separate `vite build` in library mode (single ES module, inlined
 * dynamic imports) with the `vscode` alias applied - identical to how the
 * production build bundles them, never touching the dep optimizer.
 */
async function buildWorkersInto({
  destDir,
  entries,
  vscodeDir,
  buildFn,
}: {
  destDir: string;
  entries: { name: string; entry: string }[];
  vscodeDir: string;
  buildFn: ViteBuild;
}): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  for (const { name, entry } of entries) {
    await buildFn({
      configFile: false,
      logLevel: "silent",
      resolve: { alias: { vscode: vscodeDir } },
      worker: { format: "es" },
      build: {
        outDir: destDir,
        emptyOutDir: false,
        target: "esnext",
        minify: true,
        lib: { entry, formats: ["es"], fileName: () => `${name}.worker.js` },
        rollupOptions: { output: { inlineDynamicImports: true } },
        write: true,
      },
    });
    fs.writeFileSync(
      stubFile(destDir, name),
      `export default ${JSON.stringify(`${SERVE_PREFIX}${name}.worker.js`)};\n`,
    );
  }
  fs.writeFileSync(readyMarker(destDir), `${Date.now()}\n`);
}

/**
 * Pre-build (or reuse a cached build of) the Monaco workers and return the Vite
 * wiring (`resolve.alias` redirects + a static-serving plugin).
 *
 * Returns `undefined` on any failure (editor stack unresolvable, build error) -
 * the dev server still starts; the editor just won't get its language workers.
 *
 * Caching is content-addressed and concurrency-safe: builds go to a unique
 * temp dir and are atomically promoted to the keyed cache dir only once
 * complete, so a crashed or racing build never yields a partial cache, and two
 * dev servers building the same versions converge on one result.
 */
export async function prepareMonacoWorkers({
  resolveFrom,
  vscodeDir,
  cacheBaseDir,
  buildFn,
}: {
  resolveFrom: string[];
  vscodeDir: string;
  cacheBaseDir: string;
  buildFn: ViteBuild;
}): Promise<MonacoWorkerSetup | undefined> {
  try {
    const req = createRequire(path.join(cacheBaseDir, "noop.js"));
    const entries = WORKERS.map((w) => ({
      name: w.name,
      entry: req.resolve(w.spec, { paths: resolveFrom }),
    }));
    const versions = WORKERS.map((w) =>
      readPkgVersion({ pkg: w.pkg, req, paths: resolveFrom }),
    );

    const key = computeCacheKey({ vscodeDir, versions });
    const cacheDir = path.join(cacheBaseDir, key);

    if (!isCacheReady(cacheDir)) {
      const tmpDir = `${cacheDir}.tmp-${process.pid}-${createHash("sha256")
        .update(`${Date.now()}:${entries.map((e) => e.entry).join(",")}`)
        .digest("hex")
        .slice(0, 8)}`;
      try {
        await buildWorkersInto({ destDir: tmpDir, entries, vscodeDir, buildFn });
        // Another dev server may have finished the same build while we were
        // working: prefer the existing cache and discard our temp.
        if (isCacheReady(cacheDir)) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } else {
          try {
            fs.renameSync(tmpDir, cacheDir);
          } catch {
            // Lost a promote race (dir now exists) - fine if it's ready.
            fs.rmSync(tmpDir, { recursive: true, force: true });
            if (!isCacheReady(cacheDir)) throw new Error("worker cache promote failed");
          }
        }
      } finally {
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    if (!isCacheReady(cacheDir)) return undefined;
    return { aliases: buildAliases(cacheDir), plugin: buildServePlugin(cacheDir) };
  } catch {
    return undefined;
  }
}

// Exposed for unit tests.
export const __test = {
  WORKERS,
  CACHE_FORMAT,
  SERVE_PREFIX,
  computeCacheKey,
  isCacheReady,
  buildAliases,
  workerFile,
  stubFile,
  readyMarker,
};
