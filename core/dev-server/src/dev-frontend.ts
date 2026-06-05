/**
 * Spawns a Vite dev server hosting the Checkstack frontend shell with
 * the plugin under development pre-registered via the
 * `virtual:checkstack-dev-plugin` alias.
 *
 * Reuses `core/frontend`'s `App.tsx`, `dev-main.tsx`, `index.css`, and
 * `loadPlugins()` — same code path as production. Vite proxies `/api`
 * and `/assets/plugins` to the backend dev server (default port 3000)
 * so the SPA can talk to the running plugin.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import type { ViteDevServer } from "vite";
import { buildDevTailwindContent } from "./dev-frontend-css";
import type { MonacoViteConfig } from "@checkstack/frontend/vite-monaco";

/**
 * Directory of THIS module (`@checkstack/dev-server`'s installed location).
 * `@checkstack/frontend`, `vite`, and `@vitejs/plugin-react` are
 * dev-server's own (peer/runtime) dependencies, so under a published
 * `bun install` layout they are reachable from here even though they are
 * NOT reachable from the plugin author's package — the plugin only
 * declares `@checkstack/dev-server`, never `@checkstack/frontend` or Vite
 * directly. See {@link resolveFromCandidates}.
 */
const DEV_SERVER_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve a package request from the FIRST base path under which it is
 * reachable, returning the resolved path or `undefined`.
 *
 * Bun's `createRequire(...).resolve()` throws a value that is NOT an
 * `instanceof Error` for an unresolvable specifier (a `ResolveError`-like
 * object), so a bare `try/catch` that rethrows leaks a non-Error up the
 * stack — which is exactly why the caller's `extractErrorMessage` used to
 * print the useless `"An error occurred"` fallback. We swallow the throw
 * per-candidate here and let the caller decide what to do with a clean
 * `undefined`.
 */
export function resolveFromCandidates({
  request,
  candidateBasePaths,
}: {
  request: string;
  candidateBasePaths: string[];
}): string | undefined {
  for (const base of candidateBasePaths) {
    try {
      return createRequire(path.join(base, "package.json")).resolve(request);
    } catch {
      // not reachable from this base — try the next
    }
  }
  return undefined;
}

// `vite` and `@vitejs/plugin-react` are lazily imported inside
// `startFrontendDevServer` so that consumers of this module which only
// touch `pickFrontendEntry` (notably the unit tests) don't trigger
// Vite's eager module init. Bun's test runner cross-mocks `fs.readFileSync`
// in plugin-discovery.test.ts; Vite's constants.js calls `readFileSync`
// at load time and trips that leaked mock. Lazy-importing keeps the test
// suite isolated.

interface FrontendDevOptions {
  /** Plugin author's cwd (the package whose frontend code we're dev'ing). */
  pluginCwd: string;
  /** HTTP port for the Vite dev server. */
  port: number;
  /** Backend dev server URL — `/api` and `/assets/plugins` are proxied here. */
  backendUrl: string;
}

export async function startFrontendDevServer({
  pluginCwd,
  port,
  backendUrl,
}: FrontendDevOptions): Promise<ViteDevServer> {
  // Lazy-imported here to avoid Vite's eager module init when the dev
  // server isn't actually being launched (e.g. unit tests that only
  // exercise `pickFrontendEntry`).
  const [{ createServer: createViteServer }, reactModule] = await Promise.all([
    import("vite"),
    import("@vitejs/plugin-react"),
  ]);
  const react = reactModule.default;

  // Resolve the @checkstack/frontend package. In the monorepo it is
  // reachable from the plugin's own package; under a PUBLISHED
  // `bun install`, the plugin only depends on @checkstack/dev-server, so
  // @checkstack/frontend (dev-server's peer dep) is reachable from THIS
  // module's install location, not the plugin's. Try the plugin first so a
  // plugin that pins its own @checkstack/frontend wins, then fall back to
  // dev-server's location. (Before this fallback, the resolve threw a
  // non-Error under Bun and the dev server logged "An error occurred" and
  // ran backend-only — #251 bug 2.)
  const frontendPkgJsonPath = resolveFromCandidates({
    request: "@checkstack/frontend/package.json",
    candidateBasePaths: [pluginCwd, DEV_SERVER_MODULE_DIR],
  });
  if (!frontendPkgJsonPath) {
    throw new Error(
      "Could not resolve @checkstack/frontend. It ships as a dependency of @checkstack/dev-server; ensure your plugin's dev dependencies are installed (`bun install`).",
    );
  }
  const frontendDir = path.dirname(frontendPkgJsonPath);
  const indexHtmlPath = path.join(frontendDir, "index.html");
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(
      `@checkstack/frontend at ${frontendDir} has no index.html — incompatible version?`,
    );
  }

  // Resolve the plugin under dev's main entry — Vite's alias maps the
  // virtual import `virtual:checkstack-dev-plugin` to this file.
  // Cast: `JSON.parse` is typed `any`; we read only these optional fields
  // and every consumer treats them as optional, so an unexpected shape
  // narrows to `undefined` rather than crashing.
  const pluginPkg = JSON.parse(
    fs.readFileSync(path.join(pluginCwd, "package.json"), "utf8"),
  ) as { main?: string; checkstack?: { type?: string; bundle?: string[] } };
  // Bundle primaries point at their own backend main, but the frontend
  // entry lives in a sibling. Best-effort: if the cwd's checkstack.type
  // is "frontend", use cwd; else look for a sibling -frontend package
  // listed in `checkstack.bundle`. We resolve the sibling from the plugin
  // first, then from dev-server's location (published layout), and finally
  // fall back to scanning sibling directories — a standalone workspace's
  // own `-frontend` package lives at `packages/<base>-frontend` and is NOT
  // a node_modules entry (nothing depends on it as an npm package; it is
  // only referenced via `checkstack.bundle`), so `require.resolve` can
  // never find it. See {@link findSiblingPackageDir}.
  const pluginEntry = pickFrontendEntry({
    pluginCwd,
    pluginPkg,
    resolveFrom: (request) =>
      resolveFromCandidates({
        request,
        candidateBasePaths: [pluginCwd, DEV_SERVER_MODULE_DIR],
      }),
  });
  if (!pluginEntry) {
    throw new Error(
      "Could not determine the plugin's frontend entry. Either run from a `-frontend` package directly, or list a `-frontend` sibling in your primary package's `checkstack.bundle`.",
    );
  }

  // Build the Tailwind/PostCSS pipeline for the dev shell. `@checkstack/
  // frontend` now ships the Tailwind toolchain as RUNTIME deps and exports
  // a `tailwind-preset` subpath, so we can assemble the pipeline from a
  // published install. The key win over the frontend's own config: we
  // inject the plugin under development's source globs into `content`, so a
  // plugin author's custom utility classes compile in dev. Returns
  // `undefined` (→ Vite default PostCSS) if the toolchain can't be loaded.
  const postcssPlugins = await loadDevPostcssPlugins({
    frontendDir,
    pluginCwd,
    pluginEntry,
  });

  // Monaco / VS Code editor Vite settings (ES-module workers + the `vscode`
  // alias) from @checkstack/frontend's shared helper, so the dev server matches
  // the app's config instead of drifting. Without the `vscode` alias,
  // @checkstack/ui's CodeEditor leaks a runtime `require("vscode")` into the
  // browser. Returns `undefined` when the editor stack isn't resolvable — the
  // dev server still starts; the editor just isn't configured.
  const monaco = await loadMonacoViteConfig({ frontendDir, pluginCwd });

  const server = await createViteServer({
    root: frontendDir,
    configFile: false, // we control the config inline
    server: {
      port,
      strictPort: true,
      proxy: {
        "/api": {
          target: backendUrl,
          changeOrigin: true,
          ws: true,
        },
        "/assets/plugins": { target: backendUrl, changeOrigin: true },
      },
    },
    // Explicit PostCSS chain (Tailwind preset + plugin globs + autoprefixer)
    // when it could be assembled — overrides Vite's auto-discovery of the
    // frontend's own `postcss.config.js`, whose Tailwind `content` globs are
    // relative to the dev cwd and never reach the plugin under development.
    ...(postcssPlugins ? { css: { postcss: { plugins: postcssPlugins } } } : {}),
    // Replace the production `main.tsx` entry with our `dev-main.tsx`
    // shell. Vite will pick this up via `index.html`'s `<script>` tag,
    // because dev-main.tsx imports `virtual:checkstack-dev-plugin`,
    // which is aliased below to the plugin author's actual frontend
    // entry file.
    plugins: [
      react(),
      {
        name: "checkstack-dev-entry",
        // Replace `/src/main.tsx` references in index.html with dev-main.
        transformIndexHtml(html: string) {
          return html.replace("/src/main.tsx", "/src/dev-main.tsx");
        },
      },
    ],
    // ES-module worker format for the Monaco language workers (no-op when the
    // editor stack isn't resolvable).
    ...(monaco ? { worker: monaco.worker } : {}),
    resolve: {
      alias: {
        "virtual:checkstack-dev-plugin": pluginEntry,
        // `vscode` npm-alias → real @codingame package dir (see monacoViteConfig).
        ...monaco?.resolve.alias,
      },
    },
    // Without this, Vite tries to optimize the dev plugin's deps and
    // chokes on workspace-resolved peers. Letting Vite skip pre-bundle
    // for our plugin keeps live-edit fast.
    optimizeDeps: {
      exclude: ["virtual:checkstack-dev-plugin"],
    },
  });

  await server.listen();
  const info = server.config.server;
  console.log(
    `🎨 Frontend dev server: http://${info.host ?? "localhost"}:${info.port ?? port}`,
  );
  return server;
}

/**
 * The Vite config types `css.postcss` as a `string | (ProcessOptions & {
 * plugins?: PostCSS.AcceptedPlugin[] })`. We pull the plugin element type
 * straight out of that shape so the helper stays free of `any` without
 * depending on the `postcss` types package directly (we only depend on
 * `vite`, which re-exposes them).
 */
type ViteCss = NonNullable<import("vite").UserConfig["css"]>;
type ViteCssPostcssObject = Extract<ViteCss["postcss"], { plugins?: unknown }>;
type PostcssPlugin = NonNullable<ViteCssPostcssObject["plugins"]>[number];

/** The fields we read off `@checkstack/frontend`'s tailwind preset. */
interface TailwindPreset {
  [key: string]: unknown;
}

/**
 * Build the Monaco / VS Code editor Vite settings from `@checkstack/frontend`'s
 * shared `monacoViteConfig` helper — the SAME settings the frontend's own
 * `vite.config.ts` uses, so the dev server and the app never drift.
 *
 * The editor stack (`@typefox/monaco-editor-react`, `@codingame/*`) lives in
 * `@checkstack/ui`'s dependencies, so we resolve from the plugin's installed
 * `@checkstack/ui` location (falling back to the frontend / plugin / dev-server
 * dirs). Returns `undefined` on any failure (e.g. `@checkstack/ui` not
 * installed, or an editor-less plugin) — the dev server still starts; only the
 * in-browser editor's language features are unavailable. Mirrors
 * {@link loadDevPostcssPlugins}: a frontend-tooling hiccup never takes the dev
 * server down.
 */
async function loadMonacoViteConfig({
  frontendDir,
  pluginCwd,
}: {
  frontendDir: string;
  pluginCwd: string;
}): Promise<MonacoViteConfig | undefined> {
  try {
    // Load the helper from the RESOLVED `@checkstack/frontend` (a peer the
    // plugin author installs), mirroring loadDevPostcssPlugins — never a static
    // import, so `@checkstack/frontend` stays a peer dep rather than becoming a
    // hard runtime dependency of the dev server.
    const frontendRequire = createRequire(
      path.join(frontendDir, "package.json"),
    );
    const mod = await import(
      pathToFileURL(frontendRequire.resolve("@checkstack/frontend/vite-monaco"))
        .href
    );
    // Cast: dynamic `import()`'s namespace is untyped. `monacoViteConfig` is the
    // documented export of `@checkstack/frontend/vite-monaco`; a wrong-shaped
    // module is caught by the surrounding try/catch (→ undefined fallback).
    const build = mod.monacoViteConfig as (args: {
      resolveFrom: string[];
    }) => MonacoViteConfig;
    // `@typefox/monaco-editor-react` (and its `vscode` alias) live in
    // `@checkstack/ui`'s deps; resolve from the ui package's dir first.
    const uiPkgJson = resolveFromCandidates({
      request: "@checkstack/ui/package.json",
      candidateBasePaths: [frontendDir, pluginCwd, DEV_SERVER_MODULE_DIR],
    });
    const resolveFrom = [
      ...(uiPkgJson ? [path.dirname(uiPkgJson)] : []),
      frontendDir,
      pluginCwd,
      DEV_SERVER_MODULE_DIR,
    ];
    return build({ resolveFrom });
  } catch {
    return undefined;
  }
}

/**
 * Assemble the dev PostCSS plugin chain — the shared `@checkstack/frontend`
 * Tailwind preset (theme + `tailwindcss-animate`) with a `content` glob set
 * that reaches the plugin author's OWN sources, plus autoprefixer.
 *
 * Returns `undefined` when the chain cannot be built (e.g. an older
 * `@checkstack/frontend` without the preset/toolchain, or `tailwindcss` not
 * resolvable). In that case the caller falls back to Vite's default PostCSS
 * auto-discovery — the dev server still starts. This mirrors the rest of
 * this module: a CSS-pipeline hiccup must never take the dev server down.
 */
async function loadDevPostcssPlugins({
  frontendDir,
  pluginCwd,
  pluginEntry,
}: {
  frontendDir: string;
  pluginCwd: string;
  pluginEntry: string;
}): Promise<PostcssPlugin[] | undefined> {
  try {
    // `tailwindcss` + `autoprefixer` ship as `@checkstack/frontend`'s
    // RUNTIME deps, so they are reachable from the frontend root in any
    // layout (monorepo or published install).
    const frontendRequire = createRequire(
      path.join(frontendDir, "package.json"),
    );
    const tailwindModule = await import(
      pathToFileURL(frontendRequire.resolve("tailwindcss")).href
    );
    const autoprefixerModule = await import(
      pathToFileURL(frontendRequire.resolve("autoprefixer")).href
    );
    // Cast: dynamic `import()` of CJS/ESM packages is typed `any` for the
    // namespace, so `.default` is untyped. `tailwindcss` and `autoprefixer`
    // are the canonical PostCSS-plugin factories; we assert the call
    // signatures we actually use. A wrong-shaped module is caught by the
    // surrounding try/catch (falls back to Vite's default PostCSS).
    const tailwindcss = tailwindModule.default as (
      config: TailwindPreset & { content: string[] },
    ) => PostcssPlugin;
    const autoprefixer = autoprefixerModule.default as () => PostcssPlugin;

    // The shared theme + tailwindcss-animate, exported as a public subpath
    // so we don't reach into frontend internals. It carries no `content`.
    const presetPath = frontendRequire.resolve(
      "@checkstack/frontend/tailwind-preset",
    );
    const presetModule = await import(pathToFileURL(presetPath).href);
    // Cast: the preset is a JS module typed `any`; we spread it into the
    // tailwind config and only add `content`, so the loose shape suffices.
    const preset = (presetModule.default ?? presetModule) as TailwindPreset;

    // Best-effort: include the shared UI library so its source classes (the
    // dev shell renders `@checkstack/ui` components) compile too. Its
    // resolved package dir is `<pkg>/src`.
    const extraSourceDirs: string[] = [];
    const uiPkgJson = resolveFromCandidates({
      request: "@checkstack/ui/package.json",
      candidateBasePaths: [frontendDir, pluginCwd, DEV_SERVER_MODULE_DIR],
    });
    if (uiPkgJson) {
      extraSourceDirs.push(path.join(path.dirname(uiPkgJson), "src"));
    }

    const content = buildDevTailwindContent({
      frontendDir,
      pluginCwd,
      pluginEntry,
      extraSourceDirs,
    });

    return [tailwindcss({ ...preset, content }), autoprefixer()];
  } catch {
    // Any failure → fall back to Vite's default PostCSS discovery.
    return undefined;
  }
}

/**
 * Find the `package.json` of a bundle sibling that lives as a FILESYSTEM
 * sibling of the plugin (not a node_modules entry).
 *
 * A standalone scaffold lays the trio out as `packages/<base>-common`,
 * `packages/<base>-backend`, `packages/<base>-frontend`. The `-frontend`
 * package is referenced only via `checkstack.bundle` — nothing `depends`
 * on it as an npm package — so bun never links it into any
 * `node_modules`, and `require.resolve("@scope/<base>-frontend")` cannot
 * find it from anywhere. We instead scan the directories next to the
 * plugin's own directory for one whose `package.json#name` matches.
 *
 * Pure: every FS touch is injected so the unit suite can drive it without
 * disk.
 */
export function findSiblingPackageDir({
  pluginCwd,
  siblingName,
  listDir = (dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
  readFile = (p) => fs.readFileSync(p, "utf8"),
}: {
  pluginCwd: string;
  siblingName: string;
  /** List the immediate subdirectory names of a directory. */
  listDir?: (dir: string) => string[];
  readFile?: (p: string) => string;
}): string | undefined {
  const parent = path.dirname(pluginCwd);
  let entries: string[];
  try {
    entries = listDir(parent);
  } catch {
    return undefined;
  }
  for (const name of entries) {
    const candidate = path.join(parent, name, "package.json");
    try {
      // Cast: `JSON.parse` is typed `any`; we only compare the optional
      // `name` string. A malformed/unexpected shape simply won't match.
      const pkg = JSON.parse(readFile(candidate)) as { name?: string };
      if (pkg.name === siblingName) return candidate;
    } catch {
      // not a package dir, unreadable, or malformed — skip
    }
  }
  return undefined;
}

/**
 * Resolve the entry file Vite should load for the plugin's frontend.
 *
 *   - For a `-frontend` plugin: the cwd's own `main` field.
 *   - For a bundle primary (e.g. `-backend` with `checkstack.bundle`
 *     listing a `-frontend` sibling): the sibling's `main`. Resolved
 *     through node_modules when the sibling is an installed package, or —
 *     for a standalone workspace where the sibling is only a filesystem
 *     neighbour — by scanning sibling directories (see
 *     {@link findSiblingPackageDir}).
 *
 * Pure: all FS lookups go through injected hooks so the test suite can
 * drive every branch without touching disk.
 */
export function pickFrontendEntry({
  pluginCwd,
  pluginPkg,
  resolveFrom,
  findSiblingDir,
  readFile = (p) => fs.readFileSync(p, "utf8"),
}: {
  pluginCwd: string;
  pluginPkg: {
    main?: string;
    checkstack?: { type?: string; bundle?: string[] };
  };
  /**
   * Optional injection. Defaults to a `createRequire` rooted at the
   * plugin's package.json — same resolution path as `bun run` at
   * runtime.
   */
  resolveFrom?: (request: string) => string | undefined;
  /**
   * Optional injection: locate a bundle sibling that lives as a filesystem
   * neighbour rather than a node_modules entry. Defaults to
   * {@link findSiblingPackageDir} rooted at the plugin's directory.
   */
  findSiblingDir?: (siblingName: string) => string | undefined;
  readFile?: (p: string) => string;
}): string | undefined {
  if (pluginPkg.checkstack?.type === "frontend") {
    return path.resolve(pluginCwd, pluginPkg.main ?? "src/index.tsx");
  }
  // Bundle primary — find a `-frontend` sibling and resolve its entry.
  const resolver =
    resolveFrom ??
    ((request: string): string | undefined => {
      try {
        return createRequire(path.join(pluginCwd, "package.json")).resolve(
          request,
        );
      } catch {
        return undefined;
      }
    });
  const siblingDirFinder =
    findSiblingDir ??
    ((siblingName: string): string | undefined =>
      findSiblingPackageDir({ pluginCwd, siblingName, readFile }));
  const siblings = pluginPkg.checkstack?.bundle ?? [];
  for (const sibling of siblings) {
    if (!sibling.endsWith("-frontend")) continue;
    // node_modules resolution first (monorepo / installed sibling), then a
    // filesystem-neighbour scan (standalone workspace whose -frontend is a
    // sibling package, not a dependency).
    const pkgJsonPath =
      resolver(`${sibling}/package.json`) ?? siblingDirFinder(sibling);
    if (!pkgJsonPath) continue;
    try {
      // Cast: `JSON.parse` is typed `any`; we read only the optional
      // `main` field and default it when absent.
      const pkg = JSON.parse(readFile(pkgJsonPath)) as { main?: string };
      return path.resolve(
        path.dirname(pkgJsonPath),
        pkg.main ?? "src/index.tsx",
      );
    } catch {
      // sibling installed but malformed; try the next
    }
  }
  return undefined;
}
