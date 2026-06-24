import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { federation } from "@module-federation/vite";
import { visualizer } from "rollup-plugin-visualizer";
// Relative (not the bare `@checkstack/ui/...` specifier): Vite's config loader
// externalizes bare node_modules imports, which would leave this `.ts` file
// un-transpiled at config-load time (ERR_UNKNOWN_FILE_EXTENSION). A relative
// path is bundled into the config instead.
import { monacoViteConfig } from "../ui/src/vite-monaco";

// Monorepo root is 2 levels up from core/frontend
const monorepoRoot = path.resolve(__dirname, "../..");

// The Module Federation share options we actually use. `@module-federation/vite`
// publishes a `shared` type that is NARROWER than the MF runtime it drives: it
// omits `eager` and types `requiredVersion` as `string` only. The runtime (and
// `@module-federation/sdk`'s own `SharedConfig`) supports both `eager: true` and
// `requiredVersion: false`, which we rely on. We author against this accurate
// shape and bridge the plugin's outdated param type with a single cast below.
interface HostShare {
  singleton?: boolean;
  eager?: boolean;
  requiredVersion?: string | false;
}
type FederationSharedOption = NonNullable<
  Parameters<typeof federation>[0]["shared"]
>;

// The Monaco / VS Code editor stack (`@checkstack/ui`'s CodeEditor) needs
// `worker.format: "es"` and a `vscode` resolve alias. Both are produced by this
// shared helper - also consumed by @checkstack/dev-server - so the app's config
// and the standalone-plugin dev config never drift. The editor deps live in
// `core/ui`, so we resolve from there.
const monaco = monacoViteConfig({
  resolveFrom: [path.resolve(__dirname, "../ui")],
});

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  // Backend URL for proxy - always targets local backend in dev
  const backendUrl = "http://localhost:3000";

  // Proxy table shared by `server` (dev) and `preview` (prod-bundle preview).
  const proxy = {
    // Proxy API requests and WebSocket connections to backend.
    // Use regex to ensure /api-docs doesn't match (starts with /api but isn't an API call).
    "^/api/": {
      target: backendUrl,
      ws: true, // Enable WebSocket proxy
    },
    // REST mount served by oRPC's OpenAPIHandler on the backend (see
    // core/backend/src/plugin-manager/api-router.ts).
    "^/rest/": backendUrl,
    // ONLY runtime-plugin assets are proxied. The host's own hashed chunks live
    // at /assets/*.js and must be served locally (by the dev server from src, or
    // by `vite preview` from dist) - proxying all of /assets sends those to the
    // backend, which returns them as text/plain and breaks module loading.
    "/assets/plugins": backendUrl,
    // Platform endpoints (probes etc.) under /.checkstack/*.
    "/.checkstack": backendUrl,
    // In-app user guide served by the backend at /checkstack/* (distinct from
    // /.checkstack above). Requires `bun run --filter @checkstack/docs build`.
    "/checkstack": backendUrl,
  };

  // The shared editor singleton is ONLY wired up for production builds. In dev
  // (`vite serve`) runtime plugins are compiled straight into the host by
  // @checkstack/dev-server, so nothing consumes the share - and worse, an
  // `eager` share forces vite's dep optimizer to crawl the editor's dynamic
  // `?worker&url` Monaco subtree, whose `@codingame/*` worker files are not
  // resolvable as bare specifiers from this app root (see the optimizeDeps note
  // below), which fails dep optimization with UNLOADABLE_DEPENDENCY. In dev the
  // host just bundles @checkstack/ui's editor normally (worker config + vscode
  // alias are applied unconditionally below), exactly as before this change.
  const editorShare: Record<string, HostShare> =
    command === "build"
      ? {
          // The Monaco / VS Code editor (the only shared piece of
          // @checkstack/ui). MUST be `eager`: runtime plugins consume it with
          // `import: false` (no local fallback), and @module-federation/vite's
          // consume-only shim READS `__mf_module_cache__.share[...]` after
          // bootstrap rather than lazily invoking the provider - so the host
          // has to have populated the share scope eagerly or the plugin throws
          // "imported before federation bootstrap finished". Eager is safe: the
          // editor's module scope is light (Monaco lives behind a dynamic import
          // inside CodeEditor.tsx), so this loads the wrapper, NOT Monaco, at
          // startup. `requiredVersion: false` skips negotiation (workspace:*,
          // not a semver range). The deep specifier matches the re-export in
          // core/ui/src/index.ts and the value imports inside @checkstack/ui, so
          // every editor reference dedupes to one singleton.
          "@checkstack/ui/code-editor": {
            singleton: true,
            eager: true,
            requiredVersion: false,
          },
        }
      : {};

  // Authored against the accurate `HostShare` shape (eager + requiredVersion:
  // false). Extracted to a const so it is passed as a VARIABLE (not a fresh
  // object literal), letting the single cast below bridge the plugin's narrower
  // published `shared` type without tripping excess-property checks.
  const shared: Record<string, HostShare> = {
    react: { singleton: true, eager: true, requiredVersion: "^19.0.0" },
    "react-dom": { singleton: true, eager: true, requiredVersion: "^19.0.0" },
    "react-router-dom": {
      singleton: true,
      eager: true,
      requiredVersion: "^7.0.0",
    },
    "@tanstack/react-query": {
      singleton: true,
      eager: true,
      requiredVersion: "^5.0.0",
    },
    // First-party, version-locked to the host: skip version negotiation
    // (its dep range is `workspace:*`, not a semver range).
    "@checkstack/frontend-api": {
      singleton: true,
      eager: true,
      requiredVersion: false,
    },
    ...editorShare,
  };

  return {
    // Tell Vite to look for .env files in monorepo root
    envDir: monorepoRoot,
    plugins: [
      react(),
      // Module Federation 2.0 host. Runtime (installed) frontend plugins are
      // built as MF remotes and registered at runtime (see plugin-loader.ts),
      // so no remotes are declared here. `shared` makes the host the single
      // owner of these singletons; remotes reuse the host's instances via the
      // share scope — this is what lets a separately-built plugin share the
      // host's React / Router / QueryClient / framework contexts (and is why
      // it works where a hand-rolled import-map externalisation could not).
      // @checkstack/ui is intentionally NOT shared wholesale: it is bundled per
      // consumer (tree-shaken) and its few React contexts are unified via a
      // registered (globalThis-keyed) context — see
      // core/ui/src/utils/registered-context.ts. The ONE exception is the
      // CodeEditor (Monaco / VS Code) stack: on a production build it is shared
      // as a singleton so the host owns the single editor instance (and builds
      // its `?worker&url` workers) while runtime plugins reuse it instead of
      // bundling Monaco. See `editorShare` above for why this is build-only.
      federation({
        name: "checkstack_host",
        remotes: {},
        // Cast bridges the plugin's outdated `shared` type (see HostShare).
        shared: shared as FederationSharedOption,
      }),
      // Bundle analysis, opt-in via `VITE_VISUALIZE=true bun run build`. Emits a
      // gzip/brotli-sized treemap to dist/stats.html so chunk composition can be
      // inspected reliably (instead of guessing from chunk names). Off by
      // default so normal builds are unaffected.
      ...(process.env.VITE_VISUALIZE
        ? [
            visualizer({
              filename:
                process.env.VITE_VISUALIZE === "json"
                  ? "dist/stats.json"
                  : "dist/stats.html",
              // `VITE_VISUALIZE=json` emits machine-readable raw data for
              // scripted analysis; anything else emits the interactive treemap.
              template:
                process.env.VITE_VISUALIZE === "json" ? "raw-data" : "treemap",
              gzipSize: true,
              brotliSize: true,
              title: "Checkstack frontend bundle",
            }),
          ]
        : []),
    ],
    // The @typefox/monaco-editor-react + @codingame/monaco-vscode-* stack
    // loads its language services in ES module workers.
    worker: monaco.worker,
    // Shared by the dev server AND `vite preview`, so a production-bundle
    // preview (`bun run --filter @checkstack/frontend preview`) talks to the
    // same local backend - useful for tracing real first-paint behavior on a
    // throttled network, which the unbundled dev server cannot represent.
    server: { proxy },
    preview: { proxy },
    // ============================================================
    // React instance sharing
    // ============================================================
    // - BUNDLED plugins (core/* and plugins/*): `resolve.dedupe` forces one
    //   React copy at build time when all imports are visible.
    // - RUNTIME (installed) plugins: Module Federation's share scope (see the
    //   `federation()` plugin above) hands them the host's React instance at
    //   load time.
    // ============================================================

    // Pre-bundle React deps for faster dev server startup (dev mode only)
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-router-dom",
        // NOTE (migration stage 1): the Monaco / VS Code editor stack
        // (@typefox/monaco-editor-react, monaco-languageclient, @codingame/*)
        // is intentionally NOT listed here. Those packages live in
        // @checkstack/ui's node_modules under bun's isolated store and are not
        // resolvable as bare specifiers from this app root, so listing them
        // errors ("Failed to resolve dependency ... present in
        // optimizeDeps.include"). The `require("vscode")` CJS interop is handled
        // by the `vscode` resolve.alias below.
      ],
    },
    build: {
      // Use esnext to support top-level await and modern ES features
      target: "esnext",
      // Source maps over the Monaco / VS Code (`@codingame/*`) stack roughly
      // DOUBLE the build's time and peak memory and ship ~MBs of `.js.map` into
      // the image - enough to OOM-thrash a CI runner (the Docker build hung
      // here). Off by default; opt in locally with `VITE_SOURCEMAP=true` when
      // you need to debug the production bundle.
      sourcemap: process.env.VITE_SOURCEMAP === "true",
      // Monaco stays off the initial load via the `React.lazy(CodeEditor)`
      // boundary (see CodeEditor.tsx) — verified preserved under Module
      // Federation's automatic code-splitting. We do NOT hand-group chunks:
      // `@module-federation/vite` owns code-splitting and ignores
      // `manualChunks`.
    },
    resolve: {
      // Force all monorepo packages to use the same React copy at build time.
      // Without this, each workspace package can bundle its own React copy,
      // causing "useContext is null" errors from context mismatch.
      dedupe: [
        "react",
        "react-dom",
        "react-router-dom",
        "react/jsx-runtime",
        "@tanstack/react-query",
      ],
      alias: {
        "@": path.resolve(__dirname, "./src"),
        // Alias the `vscode` npm-alias to its real package dir so @codingame's
        // CJS `require("vscode")` resolves under bun's isolated store instead
        // of leaking a runtime require. Resolved by monacoViteConfig above.
        ...monaco.resolve.alias,
      },
    },
  };
});
