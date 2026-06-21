import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { ThemeProvider, DensityProvider } from "@checkstack/ui";

/**
 * Boot.
 *
 * On a custom-domain PUBLIC host, the backend's `/api/config` returns a
 * `publicHost` hint. We then load ONLY the minimal public bundle and NEVER the
 * admin app: `./App` and `./plugin-loader` (sidebar, auth, signals, command
 * palette, EVERY plugin) are behind dynamic imports, so their chunks are never
 * fetched on a public host. On the admin origin we load the full app as before.
 *
 * This is the "separate public bundle": one Vite build, but the admin and
 * public code paths are split into independent chunks at the root, so a public
 * host downloads only the public chunk plus shared vendor.
 */
const root = ReactDOM.createRoot(document.querySelector("#root")!);

async function detectPublicHost(): Promise<
  { kind: string; slug: string } | undefined
> {
  try {
    const res = await fetch("/api/config", { credentials: "include" });
    if (!res.ok) return undefined;
    const cfg = (await res.json()) as {
      publicHost?: { kind: string; slug: string };
    };
    return cfg.publicHost;
  } catch {
    // Network/parse failure: fall through to the admin app, whose
    // RuntimeConfigProvider surfaces a clear config error.
    return undefined;
  }
}

const publicHost = await detectPublicHost();

if (publicHost) {
  const { PublicApp } = await import("./public-app.tsx");
  root.render(
    <React.StrictMode>
      <ThemeProvider defaultTheme="system" storageKey="checkstack-ui-theme">
        <DensityProvider className="contents">
          <PublicApp />
        </DensityProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
} else {
  const [{ default: App }, { loadPlugins }] = await Promise.all([
    import("./App.tsx"),
    import("./plugin-loader.ts"),
  ]);
  await loadPlugins();
  root.render(
    <React.StrictMode>
      <ThemeProvider defaultTheme="system" storageKey="checkstack-ui-theme">
        <DensityProvider className="contents">
          <App />
        </DensityProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
}

// Remove the inline boot splash (see index.html) now that the app has mounted.
// createRoot's initial render commits synchronously, so the app is already in
// the DOM underneath the overlay - removing it reveals the app with no blank
// frame.
document.querySelector("#boot-splash")?.remove();
