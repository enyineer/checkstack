import { defineConfig } from "vite";
import path from "node:path";

/**
 * Vite config for building the shared "vendor" bundles served via the import
 * map (see index.html). Runtime (installed) plugins externalise this exact
 * set and `import { ... } from "react"` etc.; the browser resolves those bare
 * specifiers to these `/vendor/*.js` files, so host AND plugins share ONE
 * instance of every context-bearing singleton (React, the Router, the React
 * Query client, the framework's plugin registry / oRPC contexts). This is the
 * native import-map micro-frontend pattern: the shared set is externalised
 * from EVERYONE — including the host's own bundle (see vite.config.ts) — and
 * loaded exactly once here.
 *
 * SHARED set (this file builds it; plugins + host externalise it):
 *   react, react-dom, react-dom/client, react/jsx-runtime, react-router-dom,
 *   @tanstack/react-query, @checkstack/frontend-api.
 *
 * NOT shared (host + plugins bundle their own, tree-shaken):
 *   @checkstack/ui (the heavy UI kit incl. Monaco — sharing it whole would
 *   force a ~2 MB eager bundle and defeat per-route tree-shaking; its Theme/
 *   Toast/Performance React contexts stay single-instance via a registered
 *   (globalThis-keyed) context — see core/ui/src/utils/registered-context.ts),
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
// Output file name (→ /vendor/<name>.js) mapped to an explicit ESM WRAPPER
// entry (vendor-entries/*). The wrappers `export *` from each package so the
// emitted bundle carries the package's NAMED exports — pointing lib mode
// straight at a CJS package (react/index.js) produced a default-only facade
// and `import { useState } from "react"` resolved to undefined.
const entry = (name: string) =>
  path.resolve(__dirname, "vendor-entries", `${name}.ts`);

const VENDOR_ENTRIES: Record<string, string> = {
  react: entry("react"),
  "react-dom": entry("react-dom"),
  "react-dom-client": entry("react-dom-client"),
  "react-jsx-runtime": entry("react-jsx-runtime"),
  "react-router-dom": entry("react-router-dom"),
  "react-query": entry("react-query"),
  // First-party framework singleton: owns the plugin registry + the oRPC /
  // API React contexts that plugins consume. Built from TS source; shares the
  // react + react-query chunks (no externals), and bundles its own internal
  // deps (@orpc/*, @checkstack/common — stateless, not part of the shared set).
  "frontend-api": entry("frontend-api"),
};

export default defineConfig({
  // Don't copy public/ contents — the main build handles that
  publicDir: false,
  // The vendored CJS packages (React, ReactDOM, …) guard dev-only code with
  // `process.env.NODE_ENV`. Unlike the app build, a lib build does not replace
  // it, so the bundled code would reference `process` (undefined in the
  // browser → "process is not defined" at load). Replace it at build time so
  // the production branch is inlined and no `process` reference survives.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
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
          // Keep the React runtime in its OWN shared chunk. Without this it
          // gets swept into whichever other manual chunk first pulls it in
          // (e.g. tanstack-query), entangling the singletons. Check first.
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "react-core";
          }
          // @tanstack/react-query is both the `react-query` entry AND a dep of
          // `frontend-api`; force it into one shared chunk so there is a single
          // QueryClient instance (otherwise it is re-bundled into frontend-api).
          if (id.includes("/@tanstack/")) return "tanstack-query";
        },
      },
    },
    minify: false,
    sourcemap: true,
  },
});
