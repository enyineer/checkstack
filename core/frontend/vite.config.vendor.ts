import { defineConfig } from "vite";
import { createRequire } from "node:module";

/**
 * Vite config for building the shared "vendor" bundles served via the import
 * map (see index.html). Runtime (installed) plugins externalise this exact
 * set and `import { ... } from "react"` etc.; the browser resolves those bare
 * specifiers to these `/vendor/*.js` files, so host AND plugins share ONE
 * instance of every context-bearing singleton (React, the Router, the React
 * Query client, the framework's plugin registry/contexts, the UI kit's theme/
 * toast/performance contexts). This is the native import-map micro-frontend
 * pattern: the shared set is externalised from EVERYONE — including the host's
 * own bundle (see vite.config.ts) — and loaded exactly once here.
 *
 * SHARED set (this file builds it; plugins externalise it):
 *   react, react-dom, react-dom/client, react/jsx-runtime, react-router-dom,
 *   @tanstack/react-query.
 * (`@checkstack/frontend-api` and `@checkstack/ui` are added in a later step.)
 *
 * NOT shared (plugins bundle their own — stateless, duplication is cheap):
 *   lucide-react, @checkstack/common, @orpc/* (the last lives inside the
 *   frontend-api bundle).
 *
 * Single instance via shared chunks (NOT cross-externalisation): all entries
 * are built together with NO externals among them, so rolldown emits ONE
 * shared chunk for react (and react-dom) that every entry — react.js,
 * react-dom.js, react-router-dom.js, react-query.js — imports as real ESM.
 * That is the single instance. We must NOT mark react etc. `external` here:
 * React 18 is CJS, and rolldown leaves an externalised CJS `require("react")`
 * as a runtime `__require("react")` call that THROWS in the browser (the
 * import map only rewrites ESM `import`s, never `require`). Bundling-with-
 * shared-chunks sidesteps that entirely. The host and plugins then resolve
 * bare `react` → `/vendor/react.js`, whose code lives in that shared chunk, so
 * everyone shares one instance.
 */
const require = createRequire(import.meta.url);

// Output file name (→ /vendor/<name>.js) mapped to the package entry resolved
// from core/frontend's own dependency tree (never a hardcoded bun-store path).
const VENDOR_ENTRIES: Record<string, string> = {
  react: require.resolve("react"),
  "react-dom": require.resolve("react-dom"),
  "react-dom-client": require.resolve("react-dom/client"),
  "react-jsx-runtime": require.resolve("react/jsx-runtime"),
  "react-router-dom": require.resolve("react-router-dom"),
  "react-query": require.resolve("@tanstack/react-query"),
  // First-party framework singleton: owns the plugin registry + the oRPC /
  // API React contexts that plugins consume. Built from TS source; shares the
  // react + react-query chunks (no externals), and bundles its own internal
  // deps (@orpc/*, @checkstack/common — stateless, not part of the shared set).
  "frontend-api": require.resolve("@checkstack/frontend-api"),
};

export default defineConfig({
  // Don't copy public/ contents — the main build handles that
  publicDir: false,
  build: {
    outDir: "dist/vendor",
    emptyOutDir: true,
    lib: {
      formats: ["es"],
      entry: VENDOR_ENTRIES,
    },
    rollupOptions: {
      // No `external`: see header. Everything is bundled and de-duplicated
      // into shared chunks so each shared package has exactly one instance.
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name]-[hash].js",
        // Force each shared package that is BOTH an entry and an internal
        // dependency of another entry (e.g. @tanstack/react-query is the
        // `react-query` entry AND a dep of `frontend-api`) into one dedicated
        // chunk. Without this, rolldown leaves the package inline in its own
        // entry and re-bundles a SECOND copy into the other entry — two
        // QueryClient instances, broken context. React is split automatically
        // (its entry source is a bare re-export) so it isn't listed here.
        manualChunks(id: string) {
          if (id.includes("/@tanstack/")) return "tanstack-query";
        },
      },
    },
    minify: false,
    sourcemap: true,
  },
});
