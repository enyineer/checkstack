import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { monacoViteConfig } from "@checkstack/ui/src/vite-monaco";

// Monorepo root is 2 levels up from core/frontend
const monorepoRoot = path.resolve(__dirname, "../..");

// The Monaco / VS Code editor stack (`@checkstack/ui`'s CodeEditor) needs
// `worker.format: "es"` and a `vscode` resolve alias. Both are produced by this
// shared helper - also consumed by @checkstack/dev-server - so the app's config
// and the standalone-plugin dev config never drift. The editor deps live in
// `core/ui`, so we resolve from there.
const monaco = monacoViteConfig({
  resolveFrom: [path.resolve(__dirname, "../ui")],
});

// https://vitejs.dev/config/
export default defineConfig(() => {
  // Backend URL for proxy - always targets local backend in dev
  const backendUrl = "http://localhost:3000";
  return {
    // Tell Vite to look for .env files in monorepo root
    envDir: monorepoRoot,
    plugins: [react()],
    // The @typefox/monaco-editor-react + @codingame/monaco-vscode-* stack
    // loads its language services in ES module workers.
    worker: monaco.worker,
    server: {
      proxy: {
        // Proxy API requests and WebSocket connections to backend
        // Use regex to ensure /api-docs doesn't match (it starts with /api but isn't an API call)
        "^/api/": {
          target: backendUrl,
          ws: true, // Enable WebSocket proxy
        },
        // REST mount served by oRPC's OpenAPIHandler on the backend (see
        // core/backend/src/plugin-manager/api-router.ts). Proxied so external
        // REST clients pointing at the Vite dev port still resolve.
        "^/rest/": backendUrl,
        "/assets": backendUrl,
        // Platform endpoints (probes etc.) under /.checkstack/* — proxied
        // here for dev convenience so e.g.
        // `curl http://localhost:5173/.checkstack/ready` works.
        "/.checkstack": backendUrl,
        // In-app user guide: the backend serves the Astro docs build at
        // /checkstack/* (distinct from /.checkstack above). Proxy it so the
        // dev SPA shows the same docs. Requires the docs to be built once:
        // `bun run --filter @checkstack/docs build`.
        "/checkstack": backendUrl,
      },
    },
    // ============================================================
    // React Instance Sharing Strategy
    // ============================================================
    // This config works with two complementary mechanisms:
    //
    // 1. BUNDLED PLUGINS (core/* and plugins/*):
    //    - resolve.dedupe forces Rollup to use single React copy
    //    - Works at build time when all imports are visible
    //
    // 2. RUNTIME PLUGINS (loaded dynamically via import()):
    //    - Import Maps in index.html resolve "react" → /vendor/react.js
    //    - Vendor bundles built by vite.config.vendor.ts
    //    - dedupe can't help here since plugins load AFTER build
    //
    // Both mechanisms ensure all code uses the same React instance.
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
      // Generate sourcemaps for production debugging
      sourcemap: true,
      // Don't wipe dist/ — the vendor build (build:vendor) writes to dist/vendor/
      // before this build runs, and we need to preserve those files
      emptyOutDir: false,
      rollupOptions: {
        output: {
          // Split heavy / stable vendor code into dedicated chunks so the
          // initial (login) load stays small and chunks cache independently.
          // This complements the `React.lazy(CodeEditor)` split: it does not by
          // itself keep Monaco off the login page (that's the lazy boundary in
          // CodeEditor.tsx), but it guarantees the whole `@codingame/*` /
          // monaco stack lands in ONE chunk that is only fetched when an editor
          // mounts, rather than smeared across many shared chunks.
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return;
            }
            // NB: do NOT try to hand-group lucide icon modules here. The same
            // per-icon modules are reached BOTH statically (`import { Plus }
            // from "lucide-react"` across the app, which must stay eager) and
            // dynamically (DynamicIcon's lazy icon registry). A manualChunk
            // keys off module id only, so it can't tell the two apart and ends
            // up pulling the whole icon set into the eager graph. The lazy
            // boundary for the data-driven icon set lives in DynamicIcon /
            // iconRegistry instead (see core/ui).
            // NOTE: we deliberately do NOT hand-group the Monaco / VS Code
            // editor stack here. Rollup's natural code-splitting already
            // isolates it: every `@codingame/*` / `@typefox/*` /
            // monaco-languageclient module is reachable only through the lazy
            // `CodeEditor` / `validateScripts` boundaries (see CodeEditor.tsx),
            // so it lands in dynamically-imported chunks that the initial
            // (login) load never fetches. A manual `monaco` chunk is actively
            // harmful: a tiny `@codingame/*` module is pulled in EAGERLY as a
            // transitive dep of non-editor code, and folding it into one big
            // chunk with the lazy editor body makes the entire ~10 MB chunk a
            // static dependency of the entry, re-shipping Monaco to the login
            // page. Leaving it to natural splitting keeps the heavy editor body
            // lazy while that tiny eager stub stays inlined where it belongs.

            // The React runtime: one stable chunk shared across the whole app.
            // `dedupe` above already guarantees a single copy; this only
            // controls which output file it lands in.
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/react-router") ||
              id.includes("/scheduler/")
            ) {
              return "react-vendor";
            }
            return;
          },
        },
      },
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
