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
import { createRequire } from "node:module";
import type { ViteDevServer } from "vite";

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

  // Resolve the @checkstack/frontend package from the plugin author's
  // node_modules so paths line up with what `bun install` produced. Same
  // strategy the backend dev command uses for @checkstack/backend.
  const req = createRequire(path.join(pluginCwd, "package.json"));
  const frontendPkgJsonPath = req.resolve("@checkstack/frontend/package.json");
  const frontendDir = path.dirname(frontendPkgJsonPath);
  const indexHtmlPath = path.join(frontendDir, "index.html");
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(
      `@checkstack/frontend at ${frontendDir} has no index.html — incompatible version?`,
    );
  }

  // Resolve the plugin under dev's main entry — Vite's alias maps the
  // virtual import `virtual:checkstack-dev-plugin` to this file.
  const pluginPkg = JSON.parse(
    fs.readFileSync(path.join(pluginCwd, "package.json"), "utf8"),
  ) as { main?: string; checkstack?: { type?: string; bundle?: string[] } };
  // Bundle primaries point at their own backend main, but the frontend
  // entry lives in a sibling. Best-effort: if the cwd's checkstack.type
  // is "frontend", use cwd; else look for a sibling -frontend package
  // listed in `checkstack.bundle` and resolve through node_modules.
  const pluginEntry = pickFrontendEntry({
    pluginCwd,
    pluginPkg,
    resolveFrom: (request) => {
      try {
        return req.resolve(request);
      } catch {
        return;
      }
    },
  });
  if (!pluginEntry) {
    throw new Error(
      "Could not determine the plugin's frontend entry. Either run from a `-frontend` package directly, or list a `-frontend` sibling in your primary package's `checkstack.bundle`.",
    );
  }

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
    resolve: {
      alias: {
        "virtual:checkstack-dev-plugin": pluginEntry,
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
 * Resolve the entry file Vite should load for the plugin's frontend.
 *
 *   - For a `-frontend` plugin: the cwd's own `main` field.
 *   - For a bundle primary (e.g. `-backend` with `checkstack.bundle`
 *     listing a `-frontend` sibling): the sibling's `main`, resolved
 *     through node_modules.
 *
 * Pure: all FS lookups go through injected hooks so the test suite can
 * drive every branch without touching disk.
 */
export function pickFrontendEntry({
  pluginCwd,
  pluginPkg,
  resolveFrom,
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
  const siblings = pluginPkg.checkstack?.bundle ?? [];
  for (const sibling of siblings) {
    if (!sibling.endsWith("-frontend")) continue;
    const pkgJsonPath = resolver(`${sibling}/package.json`);
    if (!pkgJsonPath) continue;
    try {
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
