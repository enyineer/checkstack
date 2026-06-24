import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { readBootstrap, type RuntimeConfig } from "@checkstack/frontend-api";
import { isPublicPath } from "./public-path";

/**
 * Boot.
 *
 * The backend inlines a bootstrap blob into the served HTML (see
 * `injectBootstrap` in `@checkstack/backend`), so `config` and the enabled
 * remote-plugin list are read SYNCHRONOUSLY here with zero round-trips. The old
 * boot path fetched `/api/config` (to pick a bundle) and `/api/plugins`
 * serially before first paint; both now come from `readBootstrap()`. When the
 * blob is absent (the Vite dev server serves a static index.html), we fall back
 * to the original `/api/config` fetch.
 *
 * A request is a PUBLIC surface when it is a custom-domain host (`publicHost`
 * set) OR its path matches a backend-advertised public prefix (e.g.
 * `/statuspage/view/:slug`). For public surfaces we load ONLY the minimal
 * public bundle and NEVER the admin app: `./App` and `./plugin-loader`
 * (sidebar, auth, signals, command palette, EVERY plugin and its eager slot
 * components) are behind a dynamic import, so a status page never boots the
 * admin frontend.
 *
 * On the admin origin we render the shell as soon as the local (bundled)
 * plugins are registered, then load remote (installed) plugins in the
 * BACKGROUND - they register reactively, so first paint no longer waits on the
 * plugin network phase.
 */
const root = ReactDOM.createRoot(document.querySelector("#root")!);

async function fetchBootConfig(): Promise<RuntimeConfig | undefined> {
  try {
    const res = await fetch("/api/config", { credentials: "include" });
    if (!res.ok) return undefined;
    // Trusted same-origin backend payload; mirrors RuntimeConfigProvider's cast.
    return (await res.json()) as RuntimeConfig;
  } catch {
    // Network/parse failure: fall through to the admin app, whose
    // RuntimeConfigProvider surfaces a clear config error.
    return undefined;
  }
}

const boot = readBootstrap();
// Prefer the inlined blob; only hit the network when there is none (dev).
const config = boot?.config ?? (await fetchBootConfig());
const pathname = globalThis.location?.pathname ?? "";
const isPublic =
  Boolean(config?.publicHost) ||
  isPublicPath(pathname, config?.publicPathPrefixes);

if (isPublic) {
  // Lean public bundle: never imports the admin app, its plugin loader, or the
  // @checkstack/ui barrel. It provides its own ThemeProvider/DensityProvider.
  const { PublicApp } = await import("./public-app.tsx");
  root.render(
    <React.StrictMode>
      <PublicApp />
    </React.StrictMode>,
  );
} else {
  // Render the shell IMMEDIATELY; App lazy-loads local + remote plugins after
  // first paint (they register reactively). The shell no longer waits on the
  // whole plugin graph: the one shell-critical plugin API (auth) has a safe
  // default registered in App's core registry, so the sidebar renders in a
  // pending state and the real auth plugin overrides it on register. App also
  // provides its own ThemeProvider/DensityProvider, so this entry never pulls
  // the @checkstack/ui barrel into the bundle shared with the public path.
  const { default: App } = await import("./App.tsx");
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// Remove the inline boot splash (see index.html) now that the app has mounted.
// createRoot's initial render commits synchronously, so the app is already in
// the DOM underneath the overlay - removing it reveals the app with no blank
// frame.
document.querySelector("#boot-splash")?.remove();
