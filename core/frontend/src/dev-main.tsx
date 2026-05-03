import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { loadPlugins } from "./plugin-loader.ts";
import { ThemeProvider } from "@checkstack/ui";

/**
 * Dev-shell entry point used by `bunx @checkstack/scripts dev` for
 * frontend (or bundle-primary) plugins. It re-uses the production
 * `loadPlugins` flow but sources the plugin module from a Vite alias
 * `virtual:checkstack-dev-plugin` configured by the dev-server's Vite
 * setup.
 *
 * `loadPlugins` accepts an `overrideModules` map; we pass our single
 * imported plugin under a synthetic path. Phase 2 of `loadPlugins`
 * (remote plugin discovery via `/api/plugins`) still runs against the
 * dev backend on :3000 — but Phase 1 has already registered our plugin,
 * so the duplicate is skipped via `registeredNames`.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — `virtual:checkstack-dev-plugin` is provided by the Vite
// alias the dev-server creates at runtime; TS can't see it.
import * as devPlugin from "virtual:checkstack-dev-plugin";

await loadPlugins({ "virtual:checkstack-dev-plugin": devPlugin });

ReactDOM.createRoot(document.querySelector("#root")!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="checkstack-ui-theme">
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
