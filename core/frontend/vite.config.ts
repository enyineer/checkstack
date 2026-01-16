import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Monorepo root is 2 levels up from core/frontend
const monorepoRoot = path.resolve(__dirname, "../..");

// https://vitejs.dev/config/
export default defineConfig(() => {
  // Backend URL for proxy - always targets local backend in dev
  const backendUrl = "http://localhost:3000";
  return {
    // Tell Vite to look for .env files in monorepo root
    envDir: monorepoRoot,
    plugins: [react()],
    server: {
      proxy: {
        // Proxy API requests and WebSocket connections to backend
        // Use regex to ensure /api-docs doesn't match (it starts with /api but isn't an API call)
        "^/api/": {
          target: backendUrl,
          ws: true, // Enable WebSocket proxy
        },
        "/assets": backendUrl,
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
      include: ["react", "react-dom", "react-router-dom"],
    },
    build: {
      // Use esnext to support top-level await and modern ES features
      target: "esnext",
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
      },
    },
  };
});
