import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { loadPlugins } from "./plugin-loader.ts";
import { ThemeProvider } from "@checkstack/ui";

// Initialize plugins before rendering
await loadPlugins();

ReactDOM.createRoot(document.querySelector("#root")!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="checkstack-ui-theme">
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);

// Remove the inline boot splash (see index.html) now that the app has mounted.
// createRoot's initial render commits synchronously, so the app is already in
// the DOM underneath the overlay - removing it reveals the app with no blank
// frame.
document.querySelector("#boot-splash")?.remove();
