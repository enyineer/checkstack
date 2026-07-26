import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { federation } from "@module-federation/vite";

// Builds this CORE plugin as a Module Federation REMOTE so the lean public
// status-page bundle (which loads NO plugins) can `loadRemote` its
// status-widget renderer on demand. The admin app still bundles this plugin
// directly via `import.meta.glob` - this remote build is used ONLY by the
// public bundle. Local dev / the admin app never exercise this file; the host
// serves the built `dist/` under `/assets/plugins/<package>/` at runtime.
//
// The federation config MUST mirror the host's shared set
// (`core/frontend/vite.config.ts`) so the remote reuses the host's singleton
// React / Router / QueryClient / frontend-api instead of bundling its own.
const pkg = JSON.parse(
  readFileSync(new URL("package.json", import.meta.url), "utf8"),
) as { name: string };

// Identifier-safe MF remote name. MUST match how the Checkstack host derives it
// from the package name (`core/frontend/src/mf-remote.ts` `mfRemoteName`).
const remoteName = pkg.name.replace(/^@/, "").replaceAll(/[^a-zA-Z0-9]/g, "_");

export default defineConfig({
  // The host serves this plugin's assets under /assets/plugins/<package>/, so
  // bake that base in to make the federation manifest's chunk URLs resolve.
  base: `/assets/plugins/${pkg.name}/`,
  plugins: [
    react(),
    federation({
      name: remoteName,
      filename: "remoteEntry.js",
      manifest: true,
      // No remote type generation: the host loads this plugin dynamically and
      // never imports its types, and the DTS step otherwise fails and can abort
      // the build before the federation manifest is written.
      dts: false,
      // The host loads `<remoteName>/plugin`. We expose the LEAN public entry
      // (only the status-widget renderer), NOT the full admin `index.tsx`, so
      // the remote never pulls in the manage page's DataTable / react-virtual.
      exposes: { "./plugin": "./src/public-plugin.tsx" },
      // Share ONLY what this lean renderer actually uses as a host SINGLETON:
      // `react` (the component runs on the host's React) and
      // `@checkstack/frontend-api` (the plugin registry / slot symbols MUST be
      // the host's instance, or the host's `useStatusWidgetRenderers` would not
      // see this remote's `defineStatusWidgetRenderer` registration).
      //
      // We deliberately do NOT share react-dom / react-router /
      // react-query here. This is a PURE, prop-only renderer that renders none
      // of them; they appear only as DEAD code transitively re-exported by
      // bundled `*-common` packages / the UI surface. The @module-federation/
      // vite CONSUME shim for an async-shared singleton does not statically
      // re-export named bindings (`useQuery`, `flushSync`, ...), so binding that
      // dead code against a shared shim fails the build. Leaving them UNSHARED
      // lets them bundle their real modules (correct named exports), and
      // rolldown then tree-shakes the dead code out of the emitted remote - so
      // nothing extra actually ships. (The admin app still bundles the full
      // plugin with the real shared singletons; this only affects the remote.)
      shared: {
        react: { singleton: true, requiredVersion: "^19.0.0" },
        "@checkstack/frontend-api": { singleton: true, requiredVersion: false },
        // CONSUME-ONLY (`import: false`): the `@checkstack/ui` barrel this
        // renderer imports transitively re-exports the CodeEditor, so without
        // this the remote would BUNDLE the entire Monaco / `@codingame/*` stack
        // (~11 MB). The host is the sole provider; the widget never renders it,
        // so it is dead code that this keeps out of the remote.
        "@checkstack/ui/code-editor": {
          singleton: true,
          requiredVersion: false,
          import: false,
        },
      },
    }),
  ],
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
    minify: true,
    // A remote has no HTML entry. Without an explicit input, @module-federation/
    // vite falls back to `index.html` (getBuildInput -> root/index.html) and the
    // build errors with UNRESOLVED_ENTRY. Point it at the exposed module so the
    // federation `remoteEntry.js` + `mf-manifest.json` are produced instead.
    rollupOptions: {
      input: "./src/public-plugin.tsx",
    },
  },
});
