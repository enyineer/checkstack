import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { loadPlugins } from "./plugin-loader.ts";

// Initialize plugins before rendering
await loadPlugins();

ReactDOM.createRoot(document.querySelector("#root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
