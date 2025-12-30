import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { loadPlugins } from "./plugin-loader.ts";
import { ThemeProvider } from "@checkmate/ui";

// Initialize plugins before rendering
await loadPlugins();

ReactDOM.createRoot(document.querySelector("#root")!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="checkmate-ui-theme">
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
